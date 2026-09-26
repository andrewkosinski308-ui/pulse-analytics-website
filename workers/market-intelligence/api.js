import {
  CBP_DATASET_NAME,
  CBP_YEAR,
  MESSAGES,
  SOURCE,
  cbpSupported,
  isAcsMetric,
  isCbpMetric
} from "./metrics.js";
import { parseDataQuery, parseGeographyQuery, parseIndustryQuery } from "./validate.js";
import {
  buildDataRequest,
  buildGeographyRequest,
  buildNaicsRequest,
  normalizeAcsData,
  normalizeCbpData,
  normalizeGeographies,
  normalizeNaics
} from "./census.js";

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
  if (request.method !== "GET") return json({ error: "not_found" }, 404);
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
    return json({ error: "not_found" }, 404);
  } catch {
    return unavailable();
  }
}

async function geographies(url, env, fetchImpl) {
  const query = parseGeographyQuery(url);
  if (!query.ok) return json({ error: query.error }, 400);
  const key = censusKey(env);
  if (!key) return unavailable();
  const cacheId = cacheIdFor(url);
  const cached = readCache(cacheId);
  if (cached) return json(cached, 200, 300);
  const payload = await singleFlight(cacheId, async () => {
    const requestUrl = buildGeographyRequest(query, key).url;
    const table = await fetchCensus(requestUrl, fetchImpl);
    const geographies = normalizeGeographies(query.level, query, table);
    const body = { geographies };
    if (!geographies.length) body.message = MESSAGES.emptyLocations;
    return body;
  });
  writeCache(cacheId, payload);
  return json(payload, 200, 300);
}

async function data(url, env, fetchImpl) {
  const query = parseDataQuery(url);
  if (!query.ok) return json({ error: query.error }, 400);
  if (isCbpMetric(query.metric) && !cbpSupported(query.geographyType)) {
    return json({ message: MESSAGES.businessUnavailable }, 200);
  }
  const key = censusKey(env);
  if (!key) return unavailable();
  const cacheId = cacheIdFor(url);
  const cached = readCache(cacheId);
  if (cached) return json(cached, 200, 300);
  const payload = await singleFlight(cacheId, () => loadData(query, key, fetchImpl));
  if (payload?.error) return json({ error: payload.error }, payload.status || 400);
  writeCache(cacheId, payload);
  return json(payload, 200, 300);
}

async function industries(url, env, fetchImpl) {
  const query = parseIndustryQuery(url);
  if (!query.ok) return json({ error: query.error }, 400);
  const key = censusKey(env);
  if (!key) return unavailable();
  const list = await loadNaics(key, fetchImpl);
  return json({
    source: SOURCE,
    dataset: CBP_DATASET_NAME,
    year: CBP_YEAR,
    industries: list.industries
  }, 200, 300);
}

async function loadData(query, key, fetchImpl) {
  let labels = new Map();
  if (query.metric === "industry") {
    const list = await loadNaics(key, fetchImpl);
    if (!list.labels.has(query.naics)) {
      return { error: "invalid_naics", status: 400 };
    }
    labels = list.labels;
  }
  const requestUrl = buildDataRequest(query, key).url;
  const table = await fetchCensus(requestUrl, fetchImpl);
  const normalized = isAcsMetric(query.metric)
    ? normalizeAcsData(query, table)
    : normalizeCbpData(query, table, labels);
  if (normalized.kind === "rejected") return { error: "invalid_geography", status: 400 };
  if (normalized.kind === "unavailable") return { message: MESSAGES.metricUnavailable };
  if (normalized.kind === "empty") return { message: MESSAGES.emptyData };
  return normalized.body;
}

async function loadNaics(key, fetchImpl) {
  if (naicsCache && Date.now() - naicsCache.at < CACHE_TTL_MS) return naicsCache;
  const pending = singleFlight("naics", async () => {
    const payload = await fetchJson(buildNaicsRequest(key).url, fetchImpl);
    const industries = normalizeNaics(payload);
    if (!industries.some((item) => item.naics === "00")) throw new Error("census");
    const labels = new Map(industries.map((item) => [item.naics, item.label]));
    naicsCache = { at: Date.now(), industries, labels };
    return naicsCache;
  });
  return pending;
}

async function fetchCensus(url, fetchImpl) {
  const payload = await fetchJson(url, fetchImpl);
  if (!Array.isArray(payload)) throw new Error("census");
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
    throw new Error("census");
  }
  if (response.status === 204) return [];
  if (!response.ok) throw new Error("census");
  const text = await response.text();
  if (!text || text.length > 5000000) throw new Error("census");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("census");
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
  if (value?.error) return;
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

function unavailable() {
  return json({ error: "unavailable", message: MESSAGES.unavailable }, 503);
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
