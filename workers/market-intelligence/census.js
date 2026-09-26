import {
  ACS_DATASET,
  ACS_DATASET_NAME,
  ACS_DISPLAY_DATASET,
  ACS_YEAR,
  CBP_DATASET,
  CBP_DATASET_NAME,
  CBP_YEAR,
  NAICS_DATASET,
  PAYROLL_NOTE,
  SOURCE,
  isAcsMetric,
  metricConfig,
  payrollDollars
} from "./metrics.js";
import { CBP_NAICS, datasetNaicsVersion } from "./naics.js";
import { parseBusinessMeasure, payrollFromMeasure } from "./suppression.js";

const CBP_GET = "NAME,NAICS2017,NAICS2017_LABEL,ESTAB,ESTAB_F,EMP,EMP_F,EMP_N_F,PAYANN,PAYANN_F,PAYANN_N_F,PAYQTR1,PAYQTR1_F";
const NAICS_CODE = /^(00|\d{2}|\d{2}-\d{2}|\d{3,6})$/;
const RANGE_PARENT = {
  31: "31-33",
  32: "31-33",
  33: "31-33",
  44: "44-45",
  45: "44-45",
  48: "48-49",
  49: "48-49"
};

export function buildGeographyRequest(query, key) {
  const params = [["get", "NAME"], ...geographyClauses(query.level, query)];
  return buildRequest(ACS_DATASET, params, key);
}

export function buildDataRequest(query, key) {
  const metric = metricConfig(query.metric);
  if (isAcsMetric(query.metric)) {
    const params = [["get", `NAME,${metric.variable}`], ...dataClauses(query)];
    return buildRequest(ACS_DATASET, params, key);
  }
  const naics = query.naics || "00";
  const params = [
    ["get", CBP_GET],
    ...dataClauses(query),
    ["NAICS2017", naics],
    ["LFO", "001"],
    ["EMPSZES", "001"]
  ];
  return buildRequest(CBP_DATASET, params, key);
}

export function buildNaicsRequest(key) {
  return buildRequest(NAICS_DATASET, [], key);
}

export function normalizeGeographies(level, query, table) {
  const type = {
    us: "us",
    states: "state",
    counties: "county",
    places: "place",
    "county-subdivisions": "county-subdivision"
  }[level];
  const rows = tableRows(table);
  const geographies = [];
  for (const row of rows) {
    if (!parentMatches(level, query, row)) continue;
    const name = cleanName(row.NAME);
    const code = geographyCode(type, row);
    if (!name || !code) continue;
    const item = { name, geography_type: type, geography_code: code };
    if (row.state) item.state_code = pad(row.state, 2);
    if (row.county) item.county_code = pad(row.county, 3);
    geographies.push(item);
  }
  geographies.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return geographies;
}

export function normalizeAcsData(query, table) {
  const metric = metricConfig(query.metric);
  const located = locateRow(query, table);
  if (located.relationship) return { kind: "relationship" };
  const row = located.row;
  if (!row) return { kind: "empty" };
  const parsed = parseNumber(row[metric.variable]);
  if (parsed.missing) return { kind: parsed.unavailable ? "unavailable" : "empty" };
  const geography = geographyIdentity(query, row);
  if (!geography) return { kind: "rejected" };
  return {
    kind: "value",
    body: {
      metric: query.metric,
      label: metric.title,
      census_label: metric.censusLabel,
      value: parsed.number,
      formatted_value: formatByUnit(metric.unit, parsed.number),
      unit: metric.unit,
      definition: metric.definition,
      geography,
      dataset: ACS_DATASET_NAME,
      display_dataset: ACS_DISPLAY_DATASET,
      year: ACS_YEAR,
      reference_year: ACS_YEAR,
      source: SOURCE,
      source_url: buildDataRequest(query, "").sourceUrl,
      variable: metric.variable,
      measure: metric.variable,
      retrieved_at: new Date().toISOString()
    }
  };
}

export function normalizeCbpData(query, table, naicsLabels) {
  const metric = metricConfig(query.metric);
  const located = locateRow(query, table);
  if (located.relationship) return { kind: "relationship" };
  const row = located.row;
  if (!row) return { kind: "empty" };
  const geography = geographyIdentity(query, row);
  if (!geography) return { kind: "rejected" };
  const requestedNaics = query.naics || "00";
  if (String(row.NAICS2017 || "") !== requestedNaics) return { kind: "empty" };

  if (query.metric === "industry") {
    return normalizeIndustry(query, row, geography, naicsLabels);
  }

  const measure = businessMeasure(row, metric.variable);
  if (measure.missing) return { kind: "empty" };
  const censusTitle = naicsTitle(query, row, naicsLabels);
  const body = {
    ...cbpIdentity(query, censusTitle),
    metric: query.metric,
    label: metric.title,
    unit: metric.unit,
    definition: metric.definition,
    geography,
    dataset: CBP_DATASET_NAME,
    display_dataset: CBP_DATASET_NAME,
    year: CBP_YEAR,
    reference_year: CBP_YEAR,
    data_year: CBP_YEAR,
    source: SOURCE,
    source_url: buildDataRequest(query, "").sourceUrl,
    variable: metric.variable,
    measure: metric.variable,
    retrieved_at: new Date().toISOString()
  };
  if (metric.statement) body.statement = metric.statement;
  if (measure.available === false) {
    body.available = false;
    body.suppression_code = measure.suppression_code;
    body.display_value = measure.display_value;
    body.formatted_value = measure.display_value;
    return { kind: "value", body };
  }
  const value = query.metric === "payroll" ? payrollFromMeasure(measure) : measure.value;
  if (value == null) return { kind: "empty" };
  body.available = true;
  body.value = value;
  body.formatted_value = formatByUnit(metric.unit, value);
  if (measure.noise_code) body.noise_code = measure.noise_code;
  if (query.metric === "payroll") {
    body.source_value = measure.value;
    body.source_unit = "thousands of dollars";
    body.unit_note = PAYROLL_NOTE;
  }
  return { kind: "value", body };
}

export function normalizeNaics(payload) {
  const values = payload?.values?.item || payload?.values || {};
  const allowed = new Map();
  for (const [code, label] of Object.entries(values)) {
    if (!NAICS_CODE.test(code)) continue;
    const name = cleanName(label);
    if (!name) continue;
    allowed.set(code, name);
  }
  const industries = [...allowed.entries()].map(([naics, label]) => ({
    naics,
    label,
    selector_label: naics === "00" ? "All Industries" : label,
    parent: parentOf(naics, allowed)
  }));
  industries.sort((a, b) => {
    if (a.naics === "00") return -1;
    if (b.naics === "00") return 1;
    return a.naics.localeCompare(b.naics, "en");
  });
  return industries;
}

export function tableRows(table) {
  if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0])) return [];
  const header = table[0].map((cell) => String(cell));
  if (header.some((cell) => cell.toLowerCase() === "error")) return [];
  return table.slice(1).filter(Array.isArray).map((row) => {
    const item = {};
    header.forEach((key, index) => {
      item[key] = row[index];
    });
    return item;
  });
}

function normalizeIndustry(query, row, geography, naicsLabels) {
  const establishments = businessMeasure(row, "ESTAB");
  const employees = businessMeasure(row, "EMP");
  const payroll = businessMeasure(row, "PAYANN");
  if (establishments.missing && employees.missing && payroll.missing) return { kind: "empty" };
  const censusLabel = naicsTitle(query, row, naicsLabels);
  const industry = {
    name: query.naics === "00" ? "All Industries" : censusLabel,
    census_label: censusLabel,
    naics: query.naics,
    naics_version: datasetNaicsVersion()
  };
  assignMeasure(industry, "establishments", establishments, false);
  assignMeasure(industry, "employees", employees, false);
  assignMeasure(industry, "annual_payroll", payroll, true);
  const payrollDollarsValue = payrollFromMeasure(payroll);
  if (payrollDollarsValue != null) {
    industry.source_payann = payroll.value;
    industry.unit_note = PAYROLL_NOTE;
  }
  return {
    kind: "value",
    body: {
      ...cbpIdentity(query, censusLabel),
      metric: "industry",
      label: "Industry",
      available: establishments.available !== false,
      value: establishments.available === true ? establishments.value : null,
      formatted_value: establishments.available === true
        ? formatCount(establishments.value)
        : establishments.display_value || null,
      unit: "count",
      definition: metricConfig("industry").definition,
      industry,
      geography,
      dataset: CBP_DATASET_NAME,
      display_dataset: CBP_DATASET_NAME,
      year: CBP_YEAR,
      reference_year: CBP_YEAR,
      data_year: CBP_YEAR,
      source: SOURCE,
      source_url: buildDataRequest(query, "").sourceUrl,
      variable: "NAICS2017",
      measure: "ESTAB,EMP,PAYANN",
      retrieved_at: new Date().toISOString()
    }
  };
}

function assignMeasure(target, key, measure, payroll) {
  if (measure.missing) return;
  if (measure.available === false) {
    target[key] = {
      available: false,
      suppression_code: measure.suppression_code,
      display_value: measure.display_value
    };
    return;
  }
  const value = payroll ? payrollDollars(measure.value) : measure.value;
  if (value == null) return;
  target[key] = value;
  target[`formatted_${key}`] = payroll ? formatCurrency(value) : formatCount(value);
  if (measure.noise_code) target[`${key}_noise_code`] = measure.noise_code;
}

function businessMeasure(row, variable) {
  return parseBusinessMeasure(row[variable], row[`${variable}_F`], row[`${variable}_N_F`]);
}

function naicsTitle(query, row, naicsLabels) {
  return cleanName(row.NAICS2017_LABEL) || naicsLabels.get(query.naics) || "";
}

function cbpIdentity(query, title) {
  const identity = {
    naics_code: query.naics || "00",
    naics_title: title,
    naics_version: datasetNaicsVersion(),
    dataset_id: CBP_NAICS.dataset
  };
  if (query.requestedNaics) {
    identity.requested_naics_code = query.requestedNaics;
    identity.requested_naics_version = query.requestedNaicsVersion || "2022";
  }
  return identity;
}

function geographyClauses(level, query) {
  if (level === "us") return [["for", "us:*"]];
  if (level === "states") return [["for", "state:*"]];
  if (level === "counties") return [["for", "county:*"], ["in", `state:${query.state}`]];
  if (level === "places") return [["for", "place:*"], ["in", `state:${query.state}`]];
  return [
    ["for", "county subdivision:*"],
    ["in", `state:${query.state}`],
    ["in", `county:${query.county}`]
  ];
}

function dataClauses(query) {
  if (query.geographyType === "us") return [["for", "us:1"]];
  if (query.geographyType === "state") return [["for", `state:${query.geographyCode}`]];
  if (query.geographyType === "county") {
    return [["for", `county:${query.geographyCode}`], ["in", `state:${query.state}`]];
  }
  if (query.geographyType === "place") {
    return [["for", `place:${query.geographyCode}`], ["in", `state:${query.state}`]];
  }
  return [
    ["for", `county subdivision:${query.geographyCode}`],
    ["in", `state:${query.state}`],
    ["in", `county:${query.county}`]
  ];
}

function buildRequest(base, params, key) {
  const source = params.map(([name, value]) => `${encodeCensus(name)}=${encodeCensus(value)}`).join("&");
  const sourceUrl = source ? `${base}?${source}` : base;
  const url = key ? `${sourceUrl}${source ? "&" : "?"}key=${encodeCensus(key)}` : sourceUrl;
  return { url, sourceUrl };
}

function encodeCensus(value) {
  return encodeURIComponent(value).replace(/%3A/g, ":").replace(/%2A/g, "*");
}

function locateRow(query, table) {
  const rows = tableRows(table);
  const level = dataLevel(query.geographyType);
  const matched = rows.find((row) => parentMatches(level, query, row) && codeMatches(query, row));
  if (matched) return { row: matched };
  const related = rows.find((row) => codeMatches(query, row) && !parentMatches(level, query, row));
  if (related) return { relationship: true };
  return { row: null };
}

function dataLevel(geographyType) {
  if (geographyType === "state") return "states";
  if (geographyType === "county") return "counties";
  if (geographyType === "place") return "places";
  if (geographyType === "county-subdivision") return "county-subdivisions";
  return "us";
}

function parentMatches(level, query, row) {
  if (level === "counties" || level === "places" || level === "county-subdivisions") {
    if (pad(row.state, 2) !== query.state) return false;
  }
  if (level === "county-subdivisions" && pad(row.county, 3) !== query.county) return false;
  return true;
}

function codeMatches(query, row) {
  return geographyCode(query.geographyType, row) === query.geographyCode;
}

function geographyCode(type, row) {
  if (type === "us") return String(row.us ?? "") === "1" ? "1" : "";
  if (type === "state") return pad(row.state, 2);
  if (type === "county") return pad(row.county, 3);
  if (type === "place") return pad(row.place, 5);
  if (type === "county-subdivision") return pad(row["county subdivision"], 5);
  return "";
}

function geographyIdentity(query, row) {
  const name = cleanName(row.NAME);
  const code = geographyCode(query.geographyType, row);
  if (!name || code !== query.geographyCode) return null;
  const geography = {
    type: query.geographyType,
    name,
    geography_code: code
  };
  if (query.geographyType !== "us") {
    const stateCode = query.geographyType === "state" ? code : pad(row.state, 2);
    if (stateCode) geography.state_code = stateCode;
  }
  if (query.geographyType === "county" || query.geographyType === "county-subdivision") {
    geography.county_code = query.geographyType === "county" ? code : pad(row.county, 3);
  }
  if (query.geographyType === "place") geography.place_code = code;
  if (query.geographyType === "county-subdivision") geography.subdivision_code = code;
  return geography;
}

function parentOf(code, allowed) {
  if (code === "00") return null;
  if (/^\d{2}$/.test(code) || /^\d{2}-\d{2}$/.test(code)) return allowed.has("00") ? "00" : null;
  let candidate = code.slice(0, -1);
  while (candidate.length >= 3) {
    if (allowed.has(candidate)) return candidate;
    candidate = candidate.slice(0, -1);
  }
  if (allowed.has(candidate)) return candidate;
  const range = RANGE_PARENT[candidate];
  if (range && allowed.has(range)) return range;
  return allowed.has("00") ? "00" : null;
}

function parseNumber(value) {
  if (value == null) return { missing: true, unavailable: true };
  const text = String(value).trim().replace(/%$/, "");
  if (!text || text === "null") return { missing: true, unavailable: true };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { missing: true, unavailable: true };
  const number = Number(text);
  if (!Number.isFinite(number)) return { missing: true, unavailable: true };
  if (number <= -100000000) return { missing: true, unavailable: true };
  return { missing: false, number };
}

function formatByUnit(unit, number) {
  if (unit === "USD") return formatCurrency(number);
  if (unit === "percent") return formatPercent(number);
  return formatCount(number);
}

function formatCount(number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 1
  }).format(number);
}

function formatCurrency(number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
}

function formatPercent(number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number)}%`;
}

function pad(value, size) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return "";
  return text.padStart(size, "0");
}

function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
