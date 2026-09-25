import { createCatalog } from "./catalog.js";
import { adapterFor } from "./registry.js";
import { parseListQuery, parseOpenAlexId, parseSlug } from "./validate.js";

const STATUSES = {
  invalid_query: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  provider_disabled: 409,
  provider_rate_limited: 429,
  provider_unavailable: 502,
  provider_auth_failed: 502,
  provider_not_configured: 503,
  catalog_unavailable: 503
};

export async function handleResearchRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/research/resources") {
      return await listResources(url, env, fetchImpl);
    }
    const detail = url.pathname.match(/^\/api\/research\/resources\/([^/]+)$/);
    if (request.method === "GET" && detail) {
      return await readResource(detail[1], env, fetchImpl, url);
    }
    if (request.method === "POST" && url.pathname === "/api/research/staff/discover") {
      return await discover(request, env, fetchImpl);
    }
    if (request.method === "POST" && url.pathname === "/api/research/staff/stage") {
      return await stage(request, env, fetchImpl);
    }
    if (request.method === "POST" && url.pathname === "/api/research/staff/publish") {
      return await publish(request, env, fetchImpl);
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    const code = STATUSES[error.code] ? error.code : "catalog_unavailable";
    return json({ error: code }, STATUSES[code]);
  }
}

async function listResources(url, env, fetchImpl) {
  const query = parseListQuery(url);
  if (query.error) return json({ error: query.error }, 400);
  const loaded = await withCatalogFallback(env, url, fetchImpl, (catalog) => Promise.all([
    catalog.list(query),
    catalog.facets()
  ]).then(([page, facets]) => ({ ...page, facets })));
  return json(loaded.result, 200, bindingHeader(env, loaded.source));
}

async function readResource(rawSlug, env, fetchImpl, requestUrl) {
  const slug = parseSlug(decodeURIComponent(rawSlug));
  if (!slug) return json({ error: "not_found" }, 404);
  const loaded = await withCatalogFallback(env, requestUrl, fetchImpl, (catalog) => catalog.getPublished(slug));
  if (!loaded.result) return json({ error: "not_found" }, 404);
  return json({ result: loaded.result }, 200, bindingHeader(env, loaded.source));
}

// Worker bindings are the primary catalog configuration.
// js/supabase-env.js is only a fallback when those bindings are missing
// or the bound Supabase request fails.
async function withCatalogFallback(env, requestUrl, fetchImpl, read) {
  const bound = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  try {
    const result = await read(createCatalog(await catalogEnv(env, requestUrl), fetchImpl));
    return { result, source: bound ? "binding" : "fallback" };
  } catch (error) {
    if (error.code !== "catalog_unavailable" || !bound) throw error;
    const fallback = await readPublicSupabaseConfig(env, requestUrl);
    return {
      result: await read(createCatalog({ ...env, ...fallback }, fetchImpl)),
      source: "fallback"
    };
  }
}

async function catalogEnv(env, requestUrl) {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) return env;
  return { ...env, ...(await readPublicSupabaseConfig(env, requestUrl)) };
}

async function readPublicSupabaseConfig(env, requestUrl) {
  if (!env.ASSETS) {
    const error = new Error("catalog_unavailable");
    error.code = "catalog_unavailable";
    throw error;
  }
  const response = await env.ASSETS.fetch(new Request(new URL("/js/supabase-env.js", requestUrl)));
  if (!response.ok) {
    const error = new Error("catalog_unavailable");
    error.code = "catalog_unavailable";
    throw error;
  }
  const text = await response.text();
  const url = text.match(/url:\s*'([^']+)'/);
  const anonKey = text.match(/anonKey:\s*'([^']+)'/);
  if (!url || !anonKey || /service_role/i.test(anonKey[1])) {
    const error = new Error("catalog_unavailable");
    error.code = "catalog_unavailable";
    throw error;
  }
  return { SUPABASE_URL: url[1], SUPABASE_ANON_KEY: anonKey[1] };
}

async function discover(request, env, fetchImpl) {
  const admin = await requireAdmin(request, env, fetchImpl);
  if (admin.error) return admin.error;
  const body = await readJson(request);
  const query = String(body.query || "").trim();
  if (!query || query.length > 80 || /[<>]/.test(query) || /^https?:\/\//i.test(query)) {
    return json({ error: "invalid_query" }, 400);
  }
  const provider = await requireOpenAlex(admin.jwt, env, fetchImpl);
  if (provider.error) return provider.error;
  const results = await adapterFor("openalex", env, fetchImpl).discover(query);
  return json({
    results: results.map((row) => ({
      externalId: row.openAlexId,
      title: row.title,
      publicationDate: row.publicationDate,
      doi: row.doi
    }))
  });
}

async function stage(request, env, fetchImpl) {
  const admin = await requireAdmin(request, env, fetchImpl);
  if (admin.error) return admin.error;
  const body = await readJson(request);
  const externalId = parseOpenAlexId(body.externalId);
  if (!externalId || body.url || body.sourceUrl) return json({ error: "invalid_query" }, 400);
  const provider = await requireOpenAlex(admin.jwt, env, fetchImpl);
  if (provider.error) return provider.error;
  const record = await adapterFor("openalex", env, fetchImpl).fetchByExternalId(externalId);
  if (!record || !record.title) return json({ error: "not_found" }, 404);
  const staged = await createCatalog(env, fetchImpl).stage(provider.provider, record, admin.jwt);
  return json(staged);
}

async function publish(request, env, fetchImpl) {
  const admin = await requireAdmin(request, env, fetchImpl);
  if (admin.error) return admin.error;
  const body = await readJson(request);
  const slug = parseSlug(body.slug);
  if (!slug) return json({ error: "invalid_query" }, 400);
  const published = await createCatalog(env, fetchImpl).publish(slug, admin.jwt);
  if (!published) return json({ error: "not_found" }, 404);
  return json(published);
}

async function requireOpenAlex(jwt, env, fetchImpl) {
  const provider = await createCatalog(env, fetchImpl).provider("openalex", jwt);
  if (!provider) return { error: json({ error: "provider_unavailable" }, 502) };
  if (!provider.is_enabled) return { error: json({ error: "provider_disabled" }, 409) };
  return { provider };
}

async function requireAdmin(request, env, fetchImpl) {
  const header = request.headers.get("Authorization") || "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt || jwt === env.SUPABASE_ANON_KEY) return { error: json({ error: "unauthorized" }, 401) };
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base || !env.SUPABASE_ANON_KEY) return { error: json({ error: "catalog_unavailable" }, 503) };
  const userResponse = await fetchImpl(`${base}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` }
  });
  if (!userResponse.ok) return { error: json({ error: "unauthorized" }, 401) };
  const user = await userResponse.json();
  const profileResponse = await fetchImpl(
    `${base}/rest/v1/profiles?select=role,is_active&id=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } }
  );
  if (!profileResponse.ok) return { error: json({ error: "forbidden" }, 403) };
  const profile = (await profileResponse.json())[0];
  if (!profile || profile.role !== "admin" || profile.is_active === false) {
    return { error: json({ error: "forbidden" }, 403) };
  }
  return { jwt };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function bindingHeader(env, source) {
  const state = (value) => value ? "present" : "absent";
  return {
    "X-Pulse-Bindings": `supabase_url=${state(env.SUPABASE_URL)}; supabase_anon=${state(env.SUPABASE_ANON_KEY)}; openalex=${state(env.OPENALEX_API_KEY)}; source=${source}`
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
