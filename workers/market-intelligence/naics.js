import crosswalk from "./naics-crosswalk.js";

const VINTAGE_ORDER = ["2012", "2017", "2022"];
const KNOWN_2017 = new Set(crosswalk.codes2017);
const AMBIGUOUS = new Set(crosswalk.ambiguous);

export const CBP_NAICS = {
  dataset: "2023-cbp",
  dataYear: 2023,
  supportedVersions: ["2017"]
};

export function preferredNaicsVintage(supported) {
  const versions = (supported || []).filter((version) => VINTAGE_ORDER.includes(version));
  return versions.sort((a, b) => VINTAGE_ORDER.indexOf(a) - VINTAGE_ORDER.indexOf(b)).at(-1) || "";
}

export function datasetNaicsVersion(dataset = CBP_NAICS) {
  return preferredNaicsVintage(dataset.supportedVersions);
}

export function naicsLevel(code) {
  if (code === "00") return "total";
  if (/^\d{2}$/.test(code) || /^\d{2}-\d{2}$/.test(code)) return "sector";
  if (/^\d{3}$/.test(code)) return "subsector";
  if (/^\d{4}$/.test(code)) return "industry-group";
  if (/^\d{5}$/.test(code)) return "naics-industry";
  if (/^\d{6}$/.test(code)) return "national-industry";
  return "";
}

export function resolveDatasetNaics(requested, version, datasetCodes) {
  const code = String(requested || "");
  const inDataset = datasetCodes.has(code);
  const askCrosswalk = version === "2022" || (!version && !inDataset);
  if (askCrosswalk && AMBIGUOUS.has(code)) {
    return {
      ok: false,
      error: "AMBIGUOUS_NAICS_CROSSWALK",
      source_vintage: "2022",
      dataset_vintage: "2017"
    };
  }
  if (askCrosswalk && crosswalk.exact[code]) {
    const target = crosswalk.exact[code];
    if (!datasetCodes.has(target)) return { ok: false, error: "NAICS_NOT_AVAILABLE_FOR_DATASET" };
    return {
      ok: true,
      code: target,
      version: "2017",
      translated: true,
      requested: code,
      requestedVersion: "2022"
    };
  }
  if (inDataset && version !== "2022") {
    return { ok: true, code, version: datasetNaicsVersion(), translated: false };
  }
  if (inDataset && version === "2022") {
    return { ok: true, code, version: datasetNaicsVersion(), translated: false };
  }
  if (KNOWN_2017.has(code)) return { ok: false, error: "NAICS_NOT_AVAILABLE_FOR_DATASET" };
  return { ok: false, error: "INVALID_NAICS_CODE" };
}

export function browseNaics(industries, query) {
  const nodes = industries.filter((item) => item.naics !== "00" && item.label);
  const childCodes = new Set(nodes.map((item) => item.parent).filter((parent) => parent && parent !== "00"));
  const items = nodes
    .filter((item) => {
      const parent = item.parent && item.parent !== "00" ? item.parent : "";
      if (query.parent) return parent === query.parent;
      return parent === "";
    })
    .filter((item) => !query.level || naicsLevel(item.naics) === query.level)
    .map((item) => naicsItem(item, childCodes.has(item.naics)))
    .sort((a, b) => a.code.localeCompare(b.code, "en"));
  const levels = [...new Set(items.map((item) => item.level))];
  return {
    dataset: CBP_NAICS.dataset,
    data_year: CBP_NAICS.dataYear,
    naics_version: datasetNaicsVersion(),
    level: query.level || (levels.length === 1 ? levels[0] : query.parent ? "" : "sector"),
    items
  };
}

export function selectNaics(industries, code) {
  const byCode = new Map(industries.map((item) => [item.naics, item]));
  const item = byCode.get(code);
  if (!item || !item.label) return null;
  const childCodes = new Set(industries.map((entry) => entry.parent).filter(Boolean));
  const trail = code === "00"
    ? [{ code: "00", title: item.label }]
    : breadcrumb(byCode, item.naics);
  return {
    dataset: CBP_NAICS.dataset,
    data_year: CBP_NAICS.dataYear,
    naics_version: datasetNaicsVersion(),
    code: item.naics,
    title: item.label,
    level: naicsLevel(item.naics),
    has_children: childCodes.has(item.naics),
    breadcrumb: trail
  };
}

function breadcrumb(byCode, code) {
  const chain = [];
  const seen = new Set();
  let current = code;
  while (current && current !== "00" && !seen.has(current)) {
    const item = byCode.get(current);
    if (!item || !item.label) break;
    chain.push({ code: item.naics, title: item.label });
    seen.add(current);
    current = item.parent;
  }
  return chain.reverse();
}

function naicsItem(item, hasChildren) {
  return {
    code: item.naics,
    title: item.label,
    level: naicsLevel(item.naics),
    has_children: hasChildren
  };
}
