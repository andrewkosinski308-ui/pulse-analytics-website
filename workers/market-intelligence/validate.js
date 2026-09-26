const LEVELS = new Set(["us", "states", "counties", "places", "county-subdivisions"]);
const GEOGRAPHY_TYPES = new Set(["us", "state", "county", "place", "county-subdivision"]);
const METRIC_NAMES = new Set([
  "population",
  "households",
  "median-household-income",
  "employment",
  "poverty",
  "education",
  "businesses",
  "industry",
  "payroll"
]);

const LEVEL_KEYS = {
  us: ["level"],
  states: ["level"],
  counties: ["level", "state"],
  places: ["level", "state"],
  "county-subdivisions": ["level", "state", "county"]
};

const DATA_KEYS = {
  us: ["geography_type", "geography_code", "metric"],
  state: ["geography_type", "geography_code", "metric"],
  county: ["geography_type", "geography_code", "state", "metric"],
  place: ["geography_type", "geography_code", "state", "metric"],
  "county-subdivision": ["geography_type", "geography_code", "state", "county", "metric"]
};

const NAICS_LEVELS = new Set(["sector", "subsector", "industry-group", "naics-industry", "national-industry"]);
const NAICS_VERSIONS = new Set(["2017", "2022"]);
const NAICS_CODE = /^(00|\d{2}|\d{2}-\d{2}|\d{3,6})$/;

const FIPS = {
  us: /^1$/,
  state: /^\d{2}$/,
  county: /^\d{3}$/,
  place: /^\d{5}$/,
  "county-subdivision": /^\d{5}$/
};

export function parseGeographyQuery(url) {
  const level = read(url, "level", 24);
  if (level.error) return invalid("INVALID_GEOGRAPHY");
  if (!LEVELS.has(level.value)) return invalid("INVALID_GEOGRAPHY");
  if (!exactKeys(url, LEVEL_KEYS[level.value])) return invalid("INVALID_GEOGRAPHY");

  const state = read(url, "state", 2);
  const county = read(url, "county", 3);
  if (state.error || county.error) return invalid("INVALID_GEOGRAPHY");

  if (level.value === "counties" || level.value === "places" || level.value === "county-subdivisions") {
    if (!FIPS.state.test(state.value)) return invalid("INVALID_GEOGRAPHY");
  }
  if (level.value === "county-subdivisions" && !FIPS.county.test(county.value)) {
    return invalid("INVALID_GEOGRAPHY");
  }

  return {
    ok: true,
    level: level.value,
    state: state.value,
    county: county.value
  };
}

export function parseDataQuery(url) {
  const geographyType = read(url, "geography_type", 32);
  const geographyCode = read(url, "geography_code", 16);
  const metric = read(url, "metric", 40);
  const state = read(url, "state", 8);
  const county = read(url, "county", 8);
  const naics = read(url, "naics", 64);
  const naicsCode = read(url, "naics_code", 64);
  const naicsVersion = read(url, "naics_version", 8);
  if (geographyType.error || !GEOGRAPHY_TYPES.has(geographyType.value)) return invalid("INVALID_GEOGRAPHY");
  if (metric.error || !METRIC_NAMES.has(metric.value)) return invalid("INVALID_METRIC");
  if (naics.error || naicsCode.error) return invalid("INVALID_NAICS_CODE");
  if (state.error || county.error || geographyCode.error) return invalid("INVALID_GEOGRAPHY");
  if (!exactKeys(url, dataKeys(geographyType.value, metric.value))) return invalid("INVALID_METRIC");
  if (!FIPS[geographyType.value].test(geographyCode.value)) return invalid("INVALID_GEOGRAPHY");

  if (needsState(geographyType.value) && !FIPS.state.test(state.value)) return invalid("INVALID_GEOGRAPHY");
  if (geographyType.value === "county-subdivision" && !FIPS.county.test(county.value)) {
    return invalid("INVALID_GEOGRAPHY");
  }
  if (naicsVersion.error) return invalid("DATASET_VINTAGE_UNAVAILABLE");
  if (naicsVersion.value && !NAICS_VERSIONS.has(naicsVersion.value)) return invalid("DATASET_VINTAGE_UNAVAILABLE");
  const selectedNaics = naicsCode.value || naics.value;
  if (naics.value && naicsCode.value && naics.value !== naicsCode.value) return invalid("INVALID_NAICS_CODE");
  const business = metric.value === "businesses" || metric.value === "industry" || metric.value === "payroll";
  if (business && selectedNaics && !NAICS_CODE.test(selectedNaics)) return invalid("INVALID_NAICS_CODE");
  if (metric.value === "industry" && !selectedNaics) return invalid("NAICS_CODE_REQUIRED");

  return {
    ok: true,
    geographyType: geographyType.value,
    geographyCode: geographyCode.value,
    metric: metric.value,
    state: state.value,
    county: county.value,
    naics: selectedNaics,
    naicsVersion: naicsVersion.value
  };
}

export function parseNaicsQuery(url) {
  const allowed = ["dataset", "parent", "level", "code"];
  if (![...url.searchParams.keys()].every((key) => allowed.includes(key))) return invalid("INVALID_NAICS_CODE");
  const dataset = read(url, "dataset", 32);
  const parent = read(url, "parent", 16);
  const code = read(url, "code", 16);
  const level = read(url, "level", 32);
  if (dataset.error || !dataset.value || dataset.value !== "cbp") return invalid("DATASET_VINTAGE_UNAVAILABLE");
  if (parent.error || code.error || level.error) return invalid("INVALID_NAICS_CODE");
  if (parent.value && code.value) return invalid("INVALID_NAICS_CODE");
  if (parent.value && !NAICS_CODE.test(parent.value)) return invalid("INVALID_NAICS_CODE");
  if (code.value && !NAICS_CODE.test(code.value)) return invalid("INVALID_NAICS_CODE");
  if (level.value && !NAICS_LEVELS.has(level.value)) return invalid("INVALID_NAICS_CODE");
  return { ok: true, dataset: dataset.value, parent: parent.value, code: code.value, level: level.value };
}

export function parseIndustryQuery(url) {
  if ([...url.searchParams.keys()].length) return invalid("INVALID_METRIC");
  return { ok: true };
}

function dataKeys(geographyType) {
  return DATA_KEYS[geographyType].concat(["naics", "naics_code", "naics_version"]);
}

function needsState(geographyType) {
  return geographyType === "county" || geographyType === "place" || geographyType === "county-subdivision";
}

function exactKeys(url, allowed) {
  const permit = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!permit.has(key)) return false;
  }
  return true;
}

function read(url, key, max) {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) return { error: true, value: "" };
  const value = values[0] ?? "";
  if (value.length > max) return { error: true, value: "" };
  return { error: false, value };
}

function invalid(error) {
  return { ok: false, error };
}
