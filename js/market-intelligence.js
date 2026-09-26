import {
  COPY,
  createDataLoader,
  createFlightMap,
  dataQueryString,
  detailChoices,
  effectiveQuery,
  geographyLoads,
  initialSelection,
  loadingPlan,
  reduceSelection,
  sectorChoices
} from "./market-intelligence-state.js";

document.querySelector("#market-intelligence").addEventListener("submit", (event) => {
  event.preventDefault();
});

const stateSelect = document.querySelector("#mi-state");
const countySelect = document.querySelector("#mi-county");
const placeSelect = document.querySelector("#mi-place");
const subdivisionSelect = document.querySelector("#mi-subdivision");
const metricSelect = document.querySelector("#mi-metric");
const industryFields = document.querySelector("#mi-industry-fields");
const sectorSelect = document.querySelector("#mi-sector");
const detailSelect = document.querySelector("#mi-detail");
const statusNode = document.querySelector("#mi-status");
const resultNode = document.querySelector("#mi-result");
const retryButton = document.querySelector("#mi-retry");

const flights = createFlightMap();
const dataLoader = createDataLoader((query, signal) => requestData(query, signal));
let selection = initialSelection();
let industries = [];
let industriesLoaded = false;
const statusStack = [];

stateSelect.addEventListener("change", () => {
  selection = reduceSelection(selection, { type: "state", code: stateSelect.value });
  resetSelect(countySelect, "Select a county");
  resetSelect(placeSelect, "Select a city/place");
  resetSelect(subdivisionSelect, "Select a township/county subdivision");
  countySelect.disabled = !selection.stateCode;
  placeSelect.disabled = true;
  subdivisionSelect.disabled = true;
  clearResult();
  if (selection.stateCode) loadGeographies();
  loadMarketData();
});

countySelect.addEventListener("change", () => {
  selection = reduceSelection(selection, { type: "county", code: countySelect.value });
  resetSelect(placeSelect, "Select a city/place");
  resetSelect(subdivisionSelect, "Select a township/county subdivision");
  placeSelect.disabled = !selection.countyCode;
  subdivisionSelect.disabled = !selection.countyCode;
  clearResult();
  if (selection.countyCode) loadGeographies();
  loadMarketData();
});

placeSelect.addEventListener("change", () => {
  selection = reduceSelection(selection, { type: "place", code: placeSelect.value });
  if (selection.placeCode) subdivisionSelect.value = "";
  clearResult();
  loadMarketData();
});

subdivisionSelect.addEventListener("change", () => {
  selection = reduceSelection(selection, { type: "subdivision", code: subdivisionSelect.value });
  if (selection.subdivisionCode) placeSelect.value = "";
  clearResult();
  loadMarketData();
});

metricSelect.addEventListener("change", () => {
  selection = reduceSelection(selection, { type: "metric", metric: metricSelect.value });
  clearResult();
  if (selection.metric === "industry") {
    loadIndustries().then(() => loadMarketData());
    return;
  }
  industryFields.hidden = true;
  loadMarketData();
});

sectorSelect.addEventListener("change", () => {
  fillDetails(sectorSelect.value);
  selection = reduceSelection(selection, { type: "naics", naics: sectorSelect.value || "00" });
  clearResult();
  loadMarketData();
});

detailSelect.addEventListener("change", () => {
  const naics = detailSelect.value || sectorSelect.value || "00";
  selection = reduceSelection(selection, { type: "naics", naics });
  clearResult();
  loadMarketData();
});

retryButton.addEventListener("click", () => {
  clearResult();
  if (selection.metric === "industry" && !industriesLoaded) {
    loadIndustries().then(() => loadMarketData());
    return;
  }
  loadMarketData();
});

loadStates();
loadMarketData();

function loadStates() {
  begin("states");
  stateSelect.disabled = true;
  flights.run("states", () => getJson("/api/market-intelligence/geographies?level=states"))
    .then((body) => {
      fillGeography(stateSelect, "Select a state", body.geographies || [], "");
      if (!(body.geographies || []).length) showStatus(body.message || COPY.emptyLocations);
    })
    .catch(() => showStatus(COPY.unavailable))
    .finally(() => {
      stateSelect.disabled = false;
      end("states");
    });
}

function loadGeographies() {
  const loads = geographyLoads(selection);
  for (const load of loads) {
    const params = new URLSearchParams({ level: load.level, state: load.state });
    if (load.county) params.set("county", load.county);
    const key = params.toString();
    const select = load.kind === "counties" ? countySelect : load.kind === "places" ? placeSelect : subdivisionSelect;
    const placeholder = load.kind === "counties"
      ? "Select a county"
      : load.kind === "places"
        ? "Select a city/place"
        : "Select a township/county subdivision";
    begin(load.kind);
    select.disabled = true;
    flights.run(key, () => getJson(`/api/market-intelligence/geographies?${key}`))
      .then((body) => {
        if (load.state !== selection.stateCode) return;
        if (load.county && load.county !== selection.countyCode) return;
        fillGeography(select, placeholder, body.geographies || [], select.value);
        if (!(body.geographies || []).length && resultNode.hidden) {
          showStatus(body.message || COPY.emptyLocations);
        }
      })
      .catch(() => {
        if (load.state === selection.stateCode) showStatus(COPY.unavailable);
      })
      .finally(() => {
        if (load.state === selection.stateCode && (!load.county || load.county === selection.countyCode)) {
          select.disabled = false;
        }
        end(load.kind);
      });
  }
}

function loadIndustries() {
  industryFields.hidden = false;
  if (industriesLoaded) {
    fillSectors();
    return Promise.resolve();
  }
  begin("industries");
  sectorSelect.disabled = true;
  detailSelect.disabled = true;
  return flights.run("industries", () => getJson("/api/market-intelligence/industries"))
    .then((body) => {
      industries = Array.isArray(body.industries) ? body.industries : [];
      industriesLoaded = industries.length > 0;
      fillSectors();
      if (!industriesLoaded) showStatus(COPY.unavailable);
    })
    .catch(() => showStatus(COPY.unavailable))
    .finally(() => {
      sectorSelect.disabled = false;
      detailSelect.disabled = sectorSelect.value === "00" || !sectorSelect.value;
      end("industries");
    });
}

function loadMarketData() {
  const query = effectiveQuery(selection);
  begin("data");
  metricSelect.disabled = true;
  const ticket = dataLoader.load(query);
  ticket.promise
    .then((body) => {
      if (!ticket.isCurrent()) return;
      renderBody(body);
    })
    .catch((error) => {
      if (error?.name === "AbortError" || !ticket.isCurrent()) return;
      showStatus(COPY.unavailable);
      retryButton.hidden = false;
    })
    .finally(() => {
      if (ticket.isCurrent()) {
        metricSelect.disabled = false;
        end("data");
      }
    });
}

function requestData(query, signal) {
  return getJson(`/api/market-intelligence/data?${dataQueryString(query)}`, signal);
}

function fillSectors() {
  const current = selection.naics || "00";
  const sectors = sectorChoices(industries);
  sectorSelect.replaceChildren();
  sectorSelect.append(option("00", "All Industries"));
  for (const item of sectors) sectorSelect.append(option(item.naics, item.selector_label || item.label));
  const sector = sectors.some((item) => item.naics === current) ? current : ancestorSector(current);
  sectorSelect.value = sector || "00";
  fillDetails(sectorSelect.value, current);
}

function fillDetails(sectorNaics, selected = "") {
  const details = detailChoices(industries, sectorNaics);
  detailSelect.replaceChildren();
  detailSelect.append(option("", "Entire sector"));
  for (const item of details) detailSelect.append(option(item.naics, item.selector_label || item.label));
  detailSelect.hidden = !details.length;
  detailSelect.disabled = !details.length;
  if (detailSelect.parentElement) detailSelect.parentElement.hidden = !details.length;
  if (selected && selected !== sectorNaics && details.some((item) => item.naics === selected)) {
    detailSelect.value = selected;
    selection = reduceSelection(selection, { type: "naics", naics: selected });
  } else {
    detailSelect.value = "";
    selection = reduceSelection(selection, { type: "naics", naics: sectorNaics || "00" });
  }
}

function ancestorSector(naics) {
  const match = industries.find((item) => item.naics === naics);
  let parent = match?.parent;
  const seen = new Set();
  while (parent && !seen.has(parent)) {
    if (parent === "00") return naics.length === 2 || naics.includes("-") ? naics : "";
    const item = industries.find((entry) => entry.naics === parent);
    if (item?.parent === "00") return item.naics;
    seen.add(parent);
    parent = item?.parent;
  }
  return "00";
}

function renderBody(body) {
  if (body?.industry || body?.formatted_value != null) {
    renderResult(body);
    return;
  }
  showStatus(body?.message || COPY.emptyData);
  retryButton.hidden = body?.message !== COPY.unavailable;
}

function renderResult(body) {
  statusNode.textContent = "";
  retryButton.hidden = true;
  resultNode.replaceChildren();
  resultNode.hidden = false;
  const card = document.createElement("article");
  card.className = "mi-card";
  addText(card, "h2", body.label || "Market data");
  if (body.statement) addText(card, "p", body.statement, "mi-statement");
  if (body.industry) {
    addText(card, "p", body.industry.name || body.industry.census_label || "Industry", "mi-value");
    if (body.industry.census_label && body.industry.census_label !== body.industry.name) {
      addText(card, "p", body.industry.census_label, "mi-meta");
    }
    addText(card, "p", `NAICS ${body.industry.naics}`, "mi-meta");
    const list = document.createElement("ul");
    list.className = "mi-industry-list";
    if (body.industry.formatted_establishments != null) {
      addItem(list, `Establishments: ${body.industry.formatted_establishments}`);
    }
    if (body.industry.formatted_employees != null) {
      addItem(list, `Employees: ${body.industry.formatted_employees}`);
    }
    if (body.industry.formatted_annual_payroll != null) {
      addItem(list, `Annual payroll: ${body.industry.formatted_annual_payroll}`);
    }
    card.append(list);
    if (body.industry.unit_note) addText(card, "p", body.industry.unit_note, "mi-note");
  } else {
    addText(card, "p", body.formatted_value, "mi-value");
  }
  if (body.unit_note) addText(card, "p", body.unit_note, "mi-note");
  addText(card, "p", body.geography?.name || "", "mi-geography");
  addText(card, "p", body.display_dataset || body.dataset || "", "mi-meta");
  const facts = document.createElement("dl");
  facts.className = "mi-facts";
  addFact(facts, "Geography", body.geography?.name || "");
  addFact(facts, "Reference year", body.reference_year ?? body.year ?? "");
  addFact(facts, "Dataset", body.display_dataset || body.dataset || "");
  addFact(facts, "Source", body.source || "U.S. Census Bureau");
  card.append(facts);
  if (body.definition) {
    const meaning = document.createElement("div");
    meaning.className = "mi-meaning";
    addText(meaning, "h3", "What this means");
    addText(meaning, "p", body.definition);
    card.append(meaning);
  }
  resultNode.append(card);
}

function fillGeography(select, placeholder, items, selected) {
  select.replaceChildren();
  select.append(option("", placeholder));
  for (const item of items) select.append(option(item.geography_code, item.name));
  select.value = items.some((item) => item.geography_code === selected) ? selected : "";
}

function resetSelect(select, placeholder) {
  select.replaceChildren(option("", placeholder));
  select.value = "";
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function addText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text == null ? "" : String(text);
  parent.append(node);
  return node;
}

function addItem(list, text) {
  const item = document.createElement("li");
  item.textContent = text;
  list.append(item);
}

function addFact(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value == null ? "" : String(value);
  list.append(term, detail);
}

function begin(kind) {
  const plan = loadingPlan(kind);
  const existing = statusStack.indexOf(kind);
  if (existing >= 0) statusStack.splice(existing, 1);
  statusStack.push(kind);
  showStatus(plan.message, true);
  for (const id of plan.disable) {
    const node = document.getElementById(id);
    if (node) node.disabled = true;
  }
}

function end(kind) {
  const index = statusStack.lastIndexOf(kind);
  if (index >= 0) statusStack.splice(index, 1);
  if (!statusStack.length && !resultNode.hidden) statusNode.textContent = "";
}

function showStatus(message, loading = false) {
  resultNode.hidden = true;
  resultNode.replaceChildren();
  statusNode.textContent = message;
  retryButton.hidden = loading || message !== COPY.unavailable;
}

function clearResult() {
  resultNode.hidden = true;
  resultNode.replaceChildren();
  statusNode.textContent = "";
  retryButton.hidden = true;
}

function getJson(path, signal) {
  return fetch(path, { headers: { Accept: "application/json" }, signal }).then(async (response) => {
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (response.status === 400) {
      return body?.message ? body : { message: COPY.metricUnavailable };
    }
    if (!response.ok) return { message: body?.message || COPY.unavailable };
    return body || {};
  });
}
