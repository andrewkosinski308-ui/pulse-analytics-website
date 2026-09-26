import { MESSAGES } from "./metrics.js";
import { CensusError, errorResult } from "./errors.js";
import { parseDataQuery, parseGeographyQuery, parseIndustryQuery, parseNaicsQuery } from "./validate.js";
import { browseNaics, resolveDatasetNaics, selectNaics } from "./naics.js";
import {
  buildDataRequest,
  buildGeographyRequest,
  buildNaicsRequest,
  normalizeAcsData,
  normalizeCbpData,
  normalizeGeographies,
  normalizeNaics
} from "./census.js";
import { isAcsMetric, isCbpMetric, cbpSupported } from "./metrics.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 80;
const cache = new Map();
const inflight = new Map();
let naicsCache = null;

export function resetMarketIntelligenceCache() {
  cache.clear();
  inflight.clear();
  naicsCache = null;
}

export async function handleMarketIntelligenceRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method !== "GET") return fail("MARKET_DATA_UNAVAILABLE", {}, 404);
  try {
    if (url.pathname === "/api/market-intelligence/geographies") {
      return await geographies(url, env, fetchImpl);
    }
    if (url.pathname === "/api/market-intelligence/data") {
      return await data(url, env, fetchImpl);
    }
    if (url.pathname === "/api/market-intelligence/industries") {
      return await industries(url, env, fetchImpl);
    }
    if (url.pathname === "/api/market-intelligence/naics") {
      return await naics(url, env, fetchImpl);
    }
    return fail("MARKET_DATA_UNAVAILABLE", {}, 404);
  } catch (error) {
    return fail(error instanceof CensusError ? error.code : "CENSUS_UPSTREAM_UNAVAILABLE");
  }
}

async function geographies(url, env, fetchImpl) {
  const query = parseGeographyQuery(url);
  if (!query.ok) return fail(query.error);
  if (!censusKey(env)) return fail("MARKET_DATA_UNAVAILABLE");
  const cacheId = cacheIdFor(url);
  const cached = readCache(cacheId);
  if (cached) return json(cached, 200, 300);
  const payload = await singleFlight(cacheId, async () => {
    const requestUrl = buildGeographyRequest(query, censusKey(env)).url;
    const table = await fetchCensus(requestUrl, fetchImpl);
    const items = normalizeGeographies(query.level, query, table);
    const body = { geographies: items };
    if (!items.length) body.message = MESSAGES.emptyLocations;
    return body;
  });
  writeCache(cacheId, payload);
  return json(payload, 200, 300);
}

async function data(url, env, fetchImpl) {
  const query = parseDataQuery(url);
  if (!query.ok) return fail(query.error);
  if (isCbpMetric(query.metric) && !cbpSupported(query.geographyType)) {
    return fail("UNSUPPORTED_GEOGRAPHY");
  }
  if (!censusKey(env)) return fail("MARKET_DATA_UNAVAILABLE");
  const cacheId = cacheIdFor(url);
  const cached = readCache(cacheId);
  if (cached) return json(cached, 200, 300);
  const payload = await singleFlight(cacheId, () => loadData(query, censusKey(env), fetchImpl));
  if (payload?.error) return fail(payload.error, payload.extra, payload.status, payload.message);
  writeCache(cacheId, payload);
  return json(payload, 200, 300);
}

async function industries(url, env, fetchImpl) {
  const query = parseIndustryQuery(url);
  if (!query.ok) return fail(query.error);
  if (!censusKey(env)) return fail("MARKET_DATA_UNAVAILABLE");
  const list = await loadNaics(censusKey(env), fetchImpl);
  return json({
    source: "U.S. Census Bureau",
    dataset: "2023 County Business Patterns",
    year: 2023,
    naics_version: "2017",
    industries: list.industries
  }, 200, 300);
}

async function naics(url, env, fetchImpl) {
  const query = parseNaicsQuery(url);
  if (!query.ok) return fail(query.error);
  if (!censusKey(env)) return fail("MARKET_DATA_METADATA_UNAVAILABLE");
  const list = await loadNaics(censusKey(env), fetchImpl);
  if (query.code) {
    const selected = selectNaics(list.industries, query.code);
    if (!selected) return fail("INVALID_NAICS_CODE");
    return json(selected, 200, 300);
  }
  if (query.parent && !list.labels.has(query.parent)) return fail("INVALID_NAICS_CODE");
  return json(browseNaics(list.industries, query), 200, 300);
}

async function loadData(query, key, fetchImpl) {
  const prepared = { ...query };
  if (isCbpMetric(query.metric)) {
    if (!prepared.naics && query.metric !== "industry") prepared.naics = "00";
    if (prepared.naics && prepared.naics !== "00") {
      const list = await loadNaics(key, fetchImpl);
      const resolved = resolveDatasetNaics(prepared.naics, prepared.naicsVersion, list.labels);
      if (!resolved.ok) {
        return { error: resolved.error, extra: vintageExtra(resolved) };
      }
      prepared.naics = resolved.code;
      if (resolved.translated) {
        prepared.requestedNaics = resolved.requested;
        prepared.requestedNaicsVersion = resolved.requestedVersion;
      }
    } else if (prepared.naics === "00" && !query.naics && query.metric === "industry") {
      return { error: "NAICS_CODE_REQUIRED" };
    }
  }
  const requestUrl = buildDataRequest(prepared, key).url;
  const table = await fetchCensus(requestUrl, fetchImpl);
  const labels = isCbpMetric(prepared.metric) ? await cachedLabels() : new Map();
  const normalized = isAcsMetric(prepared.metric)
    ? normalizeAcsData(prepared, table)
    : normalizeCbpData(prepared, table, labels);
  if (normalized.kind === "rejected") return { error: "INVALID_GEOGRAPHY" };
  if (normalized.kind === "relationship") return { error: "INVALID_GEOGRAPHY_RELATIONSHIP" };
  if (normalized.kind === "unavailable") return { error: "NO_DATA", status: 200, message: MESSAGES.metricUnavailable };
  if (normalized.kind === "empty") return { error: "NO_DATA", status: 200 };
  return normalized.body;
}

function cachedLabels() {
  return naicsCache?.labels || new Map();
}

async function loadNaics(key, fetchImpl) {
  if (naicsCache && Date.now() - naicsCache.at < CACHE_TTL_MS) return naicsCache;
  return singleFlight("naics", async () => {
    let payload;
    try {
      payload = await fetchJson(buildNaicsRequest(key).url, fetchImpl);
    } catch (error) {
      if (error instanceof CensusError && error.code === "CENSUS_RATE_LIMITED") throw error;
      throw new CensusError("MARKET_DATA_METADATA_UNAVAILABLE");
    }
    const industries = normalizeNaics(payload);
    if (!industries.some((item) => item.naics === "00")) {
      throw new CensusError("MARKET_DATA_METADATA_UNAVAILABLE");
    }
    const labels = new Map(industries.map((item) => [item.naics, item.label]));
    naicsCache = { at: Date.now(), industries, labels };
    return naicsCache;
  });
}

async function fetchCensus(url, fetchImpl) {
  const payload = await fetchJson(url, fetchImpl);
  if (!Array.isArray(payload)) throw new CensusError("CENSUS_UPSTREAM_UNAVAILABLE");
  return payload;
}

async function fetchJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new CensusError("CENSUS_UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 204) return [];
  if (response.status === 429) throw new CensusError("CENSUS_RATE_LIMITED");
  if (!response.ok) throw new CensusError("CENSUS_UPSTREAM_UNAVAILABLE");
  const text = await response.text();
  if (!text || text.length > 5000000) throw new CensusError("CENSUS_UPSTREAM_UNAVAILABLE");
  try {
    return JSON.parse(text);
  } catch {
    throw new CensusError("CENSUS_UPSTREAM_UNAVAILABLE");
  }
}

function censusKey(env) {
  const key = String(env?.CENSUS_API_KEY || "").trim();
  if (!key || key.length > 200) return "";
  return key;
}

function cacheIdFor(url) {
  const keys = [...url.searchParams.keys()].sort();
  return `${url.pathname}?${keys.map((key) => `${key}=${url.searchParams.get(key)}`).join("&")}`;
}

function readCache(id) {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return hit.value;
}

function writeCache(id, value) {
  if (!value || value.error) return;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(id, { at: Date.now(), value });
}

function singleFlight(id, fn) {
  if (inflight.has(id)) return inflight.get(id);
  const promise = Promise.resolve().then(fn).finally(() => {
    if (inflight.get(id) === promise) inflight.delete(id);
  });
  inflight.set(id, promise);
  return promise;
}

function vintageExtra(resolved) {
  if (!resolved.source_vintage) return {};
  return {
    source_vintage: resolved.source_vintage,
    dataset_vintage: resolved.dataset_vintage
  };
}

function fail(code, extra = {}, status, message) {
  const result = errorResult(code, extra || {});
  if (message) result.body.error.message = message;
  if (status) result.status = status;
  return json(result.body, result.status);
}

function json(body, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}
