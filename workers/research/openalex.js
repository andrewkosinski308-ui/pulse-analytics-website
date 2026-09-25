import { plainText } from "./validate.js";

const OPENALEX_HOST = "api.openalex.org";
const SELECT = [
  "id",
  "display_name",
  "publication_date",
  "type",
  "doi",
  "open_access",
  "authorships",
  "primary_location",
  "topics",
  "abstract_inverted_index"
].join(",");

export function createOpenAlexAdapter(env, fetchImpl = fetch) {
  const base = "https://api.openalex.org";
  return {
    key: "openalex",
    domain: "research",
    async isEnabled(provider) {
      return Boolean(provider && provider.key === "openalex" && provider.is_enabled);
    },
    async fetchByExternalId(externalId) {
      const payload = await requestOpenAlex(
        env,
        fetchImpl,
        `/works/${externalId}?select=${SELECT}`
      );
      return payload ? normalizeOpenAlexWork(payload) : null;
    },
    async discover(query) {
      const payload = await requestOpenAlex(
        env,
        fetchImpl,
        `/works?search=${encodeURIComponent(query)}&per_page=5&select=id,display_name,publication_date,type,doi`
      );
      return (payload.results || []).map(normalizeOpenAlexWork);
    }
  };
}

export function normalizeOpenAlexWork(work) {
  const openAlexId = String(work.id || "").split("/").pop();
  const doi = normalizeDoi(work.doi);
  const summary = abstractText(work.abstract_inverted_index);
  const authors = (work.authorships || [])
    .map((row) => plainText(row?.author?.display_name, 160))
    .filter(Boolean)
    .slice(0, 12);
  const topics = (work.topics || [])
    .map((topic) => plainText(topic?.display_name, 80))
    .filter(Boolean)
    .slice(0, 3);
  const venue = plainText(work.primary_location?.source?.display_name, 160) || null;
  return {
    title: plainText(work.display_name, 300),
    resourceType: plainText(work.type || "work", 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "work",
    publicationDate: /^\d{4}-\d{2}-\d{2}$/.test(work.publication_date || "") ? work.publication_date : null,
    doi,
    openAlexId,
    sourceUrl: doi ? `https://doi.org/${doi}` : `https://openalex.org/${openAlexId}`,
    openAccess: Boolean(work.open_access?.is_oa),
    summary: summary || null,
    authors,
    venue,
    topics,
    rightsClass: summary ? "permitted_description" : "metadata",
    limitationsUnknown: true,
    methodology: null,
    limitations: null,
    license: {
      name: "CC0 1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      notes: "OpenAlex metadata is CC0. This record stores metadata and a source link only."
    }
  };
}

export async function requestOpenAlex(env, fetchImpl, pathAndQuery) {
  if (!env.OPENALEX_API_KEY) {
    const error = new Error("provider_not_configured");
    error.code = "provider_not_configured";
    throw error;
  }
  const url = new URL(pathAndQuery, "https://api.openalex.org");
  if (url.host !== OPENALEX_HOST) {
    const error = new Error("blocked_url");
    error.code = "blocked_url";
    throw error;
  }
  url.searchParams.set("api_key", env.OPENALEX_API_KEY);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (response.status === 429) {
    const error = new Error("provider_rate_limited");
    error.code = "provider_rate_limited";
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    const error = new Error("provider_auth_failed");
    error.code = "provider_auth_failed";
    throw error;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error("provider_unavailable");
    error.code = "provider_unavailable";
    throw error;
  }
  return response.json();
}

function normalizeDoi(value) {
  if (!value) return null;
  return String(value).replace(/^https?:\/\/doi\.org\//i, "").trim().toLowerCase() || null;
}

function abstractText(index) {
  if (!index || typeof index !== "object") return "";
  const placed = [];
  for (const [word, positions] of Object.entries(index)) {
    const clean = plainText(word, 80);
    if (!clean) continue;
    for (const position of positions || []) {
      if (Number.isInteger(position) && position >= 0 && position < 400) {
        placed[position] = clean;
      }
    }
  }
  return plainText(placed.filter(Boolean).join(" "), 600);
}
