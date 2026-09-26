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

const FIPS = {
  us: /^1$/,
  state: /^\d{2}$/,
  county: /^\d{3}$/,
  place: /^\d{5}$/,
  "county-subdivision": /^\d{5}$/
};

export function parseGeographyQuery(url) {
  const level = read(url, "level", 24);
  if (level.error) return invalid("invalid_geography");
  if (!LEVELS.has(level.value)) return invalid("invalid_geography");
  if (!exactKeys(url, LEVEL_KEYS[level.value])) return invalid("invalid_request");

  const state = read(url, "state", 2);
  const county = read(url, "county", 3);
  if (state.error || county.error) return invalid("invalid_geography");

  if (level.value === "counties" || level.value === "places" || level.value === "county-subdivisions") {
    if (!FIPS.state.test(state.value)) return invalid("invalid_geography");
  }
  if (level.value === "county-subdivisions" && !FIPS.county.test(county.value)) {
    return invalid("invalid_geography");
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
  if (geographyType.error || !GEOGRAPHY_TYPES.has(geographyType.value)) return invalid("invalid_geography");
  if (metric.error || !METRIC_NAMES.has(metric.value)) return invalid("invalid_metric");
  if (state.error || county.error || geographyCode.error) return invalid("invalid_geography");
  if (!exactKeys(url, dataKeys(geographyType.value, metric.value))) return invalid("invalid_request");
  if (!FIPS[geographyType.value].test(geographyCode.value)) return invalid("invalid_geography");

  if (needsState(geographyType.value) && !FIPS.state.test(state.value)) return invalid("invalid_geography");
  if (geographyType.value === "county-subdivision" && !FIPS.county.test(county.value)) {
    return invalid("invalid_geography");
  }
  if (metric.value === "industry") {
    if (naics.error || !/^(00|\d{2}|\d{2}-\d{2}|\d{3,6})$/.test(naics.value)) return invalid("invalid_naics");
  }

  return {
    ok: true,
    geographyType: geographyType.value,
    geographyCode: geographyCode.value,
    metric: metric.value,
    state: state.value,
    county: county.value,
    naics: naics.value
  };
}

export function parseIndustryQuery(url) {
  if ([...url.searchParams.keys()].length) return invalid("invalid_request");
  return { ok: true };
}

function dataKeys(geographyType, metric) {
  const keys = DATA_KEYS[geographyType].slice();
  if (metric === "industry") keys.push("naics");
  return keys;
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
