export const ACS_DATASET = "https://api.census.gov/data/2024/acs/acs5/profile";
export const CBP_DATASET = "https://api.census.gov/data/2023/cbp";
export const NAICS_DATASET = "https://api.census.gov/data/2023/cbp/variables/NAICS2017.json";

export const ACS_YEAR = 2024;
export const CBP_YEAR = 2023;
export const SOURCE = "U.S. Census Bureau";

export const ACS_DATASET_NAME = "2024 ACS 5-Year Data Profiles";
export const ACS_DISPLAY_DATASET = "2024 ACS 5-Year Estimates";
export const CBP_DATASET_NAME = "2023 County Business Patterns";

export const MESSAGES = {
  emptyLocations: "No locations are available for this selection.",
  emptyData: "No data is available for this selection.",
  unavailable: "Market Intelligence is temporarily unavailable. Please try again.",
  businessUnavailable: "Business data is not available from this Census dataset at this geography.",
  metricUnavailable: "This metric is not available for the selected geography."
};

export const PAYROLL_NOTE = "Annual payroll is reported by County Business Patterns in thousands of dollars and shown here in dollars.";

const ACS_METRICS = {
  population: {
    variable: "DP05_0001E",
    censusLabel: "Total population",
    title: "Population",
    unit: "count",
    definition: "Total population reported by the U.S. Census Bureau."
  },
  households: {
    variable: "DP02_0001E",
    censusLabel: "Total households",
    title: "Households",
    unit: "count",
    definition: "Total households."
  },
  "median-household-income": {
    variable: "DP03_0062E",
    censusLabel: "Median household income in the past 12 months, inflation-adjusted dollars",
    title: "Median Household Income",
    unit: "USD",
    definition: "Median household income in inflation-adjusted dollars."
  },
  employment: {
    variable: "DP03_0004E",
    censusLabel: "Population 16 years and over in labor force who are employed",
    title: "Employment",
    unit: "count",
    definition: "Employed civilian population age 16 and over."
  },
  poverty: {
    variable: "DP03_0128PE",
    censusLabel: "Percent of people whose income in the past 12 months is below the poverty level",
    title: "Poverty",
    unit: "percent",
    definition: "Percent of people whose income in the past 12 months was below the poverty level."
  },
  education: {
    variable: "DP02_0068PE",
    censusLabel: "Percent of population age 25 years and over with a bachelor's degree or higher",
    title: "Education",
    unit: "percent",
    definition: "Percent of the population age 25 and over with a bachelor's degree or higher."
  }
};

const CBP_METRICS = {
  businesses: {
    variable: "ESTAB",
    title: "Business Establishments",
    statement: "Number of business establishments with paid employees.",
    unit: "count",
    definition: "Business establishments with paid employees.",
    naics: "00"
  },
  industry: {
    variable: "NAICS2017",
    title: "Industry",
    unit: "count",
    definition: "Business establishments, employment, and payroll reported for the selected industry."
  },
  payroll: {
    variable: "PAYANN",
    title: "Annual Payroll",
    statement: "Annual payroll",
    unit: "USD",
    definition: "Annual payroll reported by County Business Patterns.",
    naics: "00"
  }
};

export const METRICS = { ...ACS_METRICS, ...CBP_METRICS };

export const ACS_GEOGRAPHIES = new Set(["us", "state", "county", "place", "county-subdivision"]);
export const CBP_GEOGRAPHIES = new Set(["us", "state", "county"]);

export function metricConfig(metric) {
  return METRICS[metric] || null;
}

export function isAcsMetric(metric) {
  return Object.prototype.hasOwnProperty.call(ACS_METRICS, metric);
}

export function isCbpMetric(metric) {
  return Object.prototype.hasOwnProperty.call(CBP_METRICS, metric);
}

export function cbpSupported(geographyType) {
  return CBP_GEOGRAPHIES.has(geographyType);
}

export function payrollDollars(payann) {
  if (typeof payann === "string" && /^[DSNXGHJ]$/i.test(payann.trim())) return null;
  const number = typeof payann === "number" ? payann : Number(String(payann ?? "").trim());
  if (!Number.isFinite(number)) return null;
  return number * 1000;
}
