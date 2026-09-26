import {
  COPY,
  createDataLoader,
  createFlightMap,
  dataQueryString,
  effectiveQuery,
  geographyLoads,
  initialSelection,
  isBusinessMetric,
  loadingPlan,
  messageForError,
  openBreadcrumb,
  reduceSelection
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
const naicsSelected = document.querySelector("#mi-naics-selected");
const naicsCrumbs = document.querySelector("#mi-naics-crumbs");
const naicsList = document.querySelector("#mi-naics-list");
const naicsAll = document.querySelector("#mi-naics-all");
const statusNode = document.querySelector("#mi-status");
const resultNode = document.querySelector("#mi-result");
const retryButton = document.querySelector("#mi-retry");

const flights = createFlightMap();
const dataLoader = createDataLoader((query, signal) => requestData(query, signal));
let selection = initialSelection();
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
  syncIndustryBrowser();
  loadMarketData();
});

naicsAll.addEventListener("click", () => {
  chooseNaics("00");
});

retryButton.addEventListener("click", () => {
  clearResult();
  if (isBusinessMetric(selection.metric) && !naicsList.childElementCount) loadNaicsLevel("");
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

function syncIndustryBrowser() {
  const business = isBusinessMetric(selection.metric);
  industryFields.hidden = !business;
  if (!business) return;
  renderNaicsState();
  if (!naicsList.childElementCount) loadNaicsLevel(selection.breadcrumb.at(-1)?.code && selection.naicsCode !== "00"
    ? parentBrowseCode()
    : "");
}

function parentBrowseCode() {
  const crumbs = selection.breadcrumb;
  if (crumbs.length > 1) return crumbs.at(-2).code;
  return "";
}

function loadNaicsLevel(parent) {
  const params = new URLSearchParams({ dataset: "cbp" });
  if (parent) params.set("parent", parent);
  const key = params.toString();
  begin("industries");
  naicsAll.disabled = true;
  return flights.run(key, () => getJson(`/api/market-intelligence/naics?${key}`))
    .then((body) => {
      if (body?.error?.code) {
        showStatus(messageForError(body));
        return;
      }
      renderNaicsItems(body.items || []);
      if (!(body.items || []).length && !parent) showStatus(COPY.emptyData);
    })
    .catch(() => showStatus(COPY.unavailable))
    .finally(() => {
      naicsAll.disabled = false;
      end("industries");
      if (!statusStack.length && resultNode.hidden && selection.metric === "industry" && !selection.naicsCode) {
        statusNode.textContent = COPY.selectIndustry;
      }
    });
}

function chooseNaics(code) {
  begin("industries");
  naicsAll.disabled = true;
  const key = `naics-code:${code}`;
  return flights.run(key, () => getJson(`/api/market-intelligence/naics?dataset=cbp&code=${encodeURIComponent(code)}`))
    .then((body) => {
      if (body?.error?.code || !body?.code) {
        showStatus(messageForError(body || {}));
        return;
      }
      selection = reduceSelection(selection, {
        type: "naics",
        code: body.code,
        title: body.title,
        version: body.naics_version,
        dataset: body.dataset,
        breadcrumb: body.breadcrumb
      });
      renderNaicsState();
      clearResult();
      if (body.has_children) return loadNaicsLevel(body.code).then(() => loadMarketData());
      loadMarketData();
    })
    .catch(() => showStatus(COPY.unavailable))
    .finally(() => {
      naicsAll.disabled = false;
      end("industries");
    });
}

function renderNaicsState() {
  naicsSelected.textContent = selection.naicsCode
    ? `${selection.naicsCode} — ${selection.naicsTitle}`
    : "Browse industries to select a NAICS code.";
  naicsCrumbs.replaceChildren();
  selection.breadcrumb.forEach((crumb, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mi-naics-button";
    button.textContent = `${crumb.code} — ${crumb.title}`;
    button.addEventListener("click", () => {
      const opened = openBreadcrumb(selection.breadcrumb, index);
      if (!opened) return;
      selection = reduceSelection(selection, {
        type: "naics",
        code: opened.code,
        title: opened.title,
        version: selection.naicsVersion,
        dataset: selection.naicsDataset,
        breadcrumb: opened.breadcrumb
      });
      renderNaicsState();
      clearResult();
      loadNaicsLevel(opened.code);
      loadMarketData();
    });
    naicsCrumbs.append(button);
  });
}

function renderNaicsItems(items) {
  naicsList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "mi-note";
    empty.textContent = "No industries are available for this selection.";
    naicsList.append(empty);
    return;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mi-naics-button";
    button.textContent = `${item.title} (${item.code})`;
    button.addEventListener("click", () => chooseNaics(item.code));
    naicsList.append(button);
  }
}

function loadMarketData() {
  const query = effectiveQuery(selection);
  if (!query) {
    showStatus(COPY.selectIndustry);
    return;
  }
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

function renderBody(body) {
  if (body?.error?.code) {
    showStatus(messageForError(body));
    retryButton.hidden = messageForError(body) !== COPY.unavailable;
    return;
  }
  if (body?.industry || body?.formatted_value != null || body?.available === false) {
    renderResult(body);
    return;
  }
  showStatus(body?.message || COPY.emptyData);
  retryButton.hidden = true;
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
    addIndustryLine(list, "Establishments", body.industry.establishments, body.industry.formatted_establishments);
    addIndustryLine(list, "Employees", body.industry.employees, body.industry.formatted_employees);
    addIndustryLine(list, "Annual payroll", body.industry.annual_payroll, body.industry.formatted_annual_payroll);
    card.append(list);
    const noise = [body.industry.establishments_noise_code, body.industry.employees_noise_code, body.industry.annual_payroll_noise_code]
      .filter(Boolean)
      .join(", ");
    if (noise) addText(card, "p", `Census noise indicator: ${noise}.`, "mi-note");
    if (body.industry.unit_note) addText(card, "p", body.industry.unit_note, "mi-note");
  } else {
    addText(card, "p", body.formatted_value, "mi-value");
  }
  if (body.noise_code) addText(card, "p", `Census noise indicator: ${body.noise_code}.`, "mi-note");
  if (body.unit_note) addText(card, "p", body.unit_note, "mi-note");
  addText(card, "p", body.geography?.name || "", "mi-geography");
  addText(card, "p", body.display_dataset || body.dataset || "", "mi-meta");
  const facts = document.createElement("dl");
  facts.className = "mi-facts";
  addFact(facts, "Geography", body.geography?.name || "");
  addFact(facts, "Reference year", body.reference_year ?? body.year ?? "");
  if (body.data_year) addFact(facts, "Data year", body.data_year);
  if (body.naics_code) addFact(facts, "NAICS", `${body.naics_code} — ${body.naics_title || ""}`.trim());
  if (body.naics_version) addFact(facts, "NAICS vintage", body.naics_version);
  if (body.requested_naics_code) addFact(facts, "Requested NAICS", body.requested_naics_code);
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

function addIndustryLine(list, label, raw, formatted) {
  if (raw && typeof raw === "object" && raw.display_value) {
    addItem(list, `${label}: ${raw.display_value}`);
    return;
  }
  if (formatted != null) addItem(list, `${label}: ${formatted}`);
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
    if (!body || typeof body !== "object") {
      return { error: { code: "CENSUS_UPSTREAM_UNAVAILABLE", message: COPY.unavailable } };
    }
    return body;
  });
}
