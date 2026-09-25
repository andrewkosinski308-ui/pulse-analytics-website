import assert from "node:assert/strict";
import test from "node:test";
import { handleResearchRequest } from "./api.js";
import { resolveImportTarget } from "./duplicates.js";
import { normalizeOpenAlexWork, requestOpenAlex } from "./openalex.js";
import { parseListQuery, parseOpenAlexId, plainText } from "./validate.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
  OPENALEX_API_KEY: "server-side-test-key"
};

test("plain text strips markup", () => {
  assert.equal(plainText("<script>alert(1)</script> Title"), "alert(1) Title");
});

test("query validation rejects urls, bad pages, and unknown sorts", () => {
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?url=https://evil.test")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?page=0")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?pageSize=100")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?sort=secret")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?sort=title")).sort, "title");
});

test("openalex ids stay on the provider and ignore arbitrary urls", () => {
  assert.equal(parseOpenAlexId("W2741809807"), "W2741809807");
  assert.equal(parseOpenAlexId("https://openalex.org/W2741809807"), "W2741809807");
  assert.equal(parseOpenAlexId("https://evil.test/W2741809807"), null);
});

test("doi match attaches a claim instead of creating a work", () => {
  assert.deepEqual(resolveImportTarget({ id: "work-1", slug: "existing" }, null), {
    action: "attach",
    workId: "work-1",
    slug: "existing"
  });
  assert.equal(resolveImportTarget(null, null).action, "insert");
});

test("openalex normalization keeps metadata and drops markup", () => {
  const record = normalizeOpenAlexWork({
    id: "https://openalex.org/W1",
    display_name: "<b>Attention</b>",
    publication_date: "2017-06-12",
    type: "article",
    doi: "https://doi.org/10.48550/arXiv.1706.03762",
    open_access: { is_oa: true },
    authorships: [{ author: { display_name: "Ashish Vaswani" } }],
    primary_location: { source: { display_name: "arXiv" } },
    topics: [{ display_name: "Machine learning" }],
    abstract_inverted_index: { Hello: [0], world: [1] }
  });
  assert.equal(record.title, "Attention");
  assert.equal(record.doi, "10.48550/arxiv.1706.03762");
  assert.equal(record.sourceUrl, "https://doi.org/10.48550/arxiv.1706.03762");
  assert.equal(record.summary, "Hello world");
  assert.equal(record.limitationsUnknown, true);
  assert.equal(JSON.stringify(record).includes("pdf"), false);
});

test("openalex requests cannot leave the provider host", async () => {
  await assert.rejects(
    () => requestOpenAlex(env, fetch, "https://evil.test/works/W1"),
    (error) => error.code === "blocked_url"
  );
});

test("missing openalex key fails closed", async () => {
  await assert.rejects(
    () => requestOpenAlex({ OPENALEX_API_KEY: "" }, fetch, "/works/W1"),
    (error) => error.code === "provider_not_configured"
  );
});

test("public catalog rejects a visitor-supplied url and hides secrets", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?url=https://evil.test"),
    env,
    async (input) => {
      calls.push(String(input.url || input));
      return new Response("[]");
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal((await response.text()).includes("server-side-test-key"), false);
});

test("unpublished and unknown slugs are not found", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/missing-work"),
    env,
    async () => jsonResponse([])
  );
  assert.equal(response.status, 404);
});

test("published catalog read returns normalized rows", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    env,
    async (input) => {
      const url = String(input.url || input);
      if (url.includes("resource_type,research_resource_topics")) return jsonResponse([]);
      return jsonResponse([{
        title: "Published study",
        slug: "published-study",
        resource_type: "article",
        publication_date: "2020-01-01",
        source_url: "https://doi.org/10.1000/example",
        retrieved_at: "2026-09-24T00:00:00Z",
        rights_class: "metadata",
        summary: null,
        open_access: false,
        doi: "10.1000/example",
        venue: "Journal",
        limitations_unknown: true,
        research_providers: { key: "openalex", attribution_text: "OpenAlex" },
        research_resource_contributors: [],
        research_resource_topics: [],
        research_licenses: []
      }], { "content-range": "0-0/1" });
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "published-study");
  assert.equal(body.total, 1);
});

test("disabled provider blocks import before any upstream call", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/discover", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ query: "marketing" })
    }),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: false }]);
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 409);
  assert.equal(calls.some((url) => url.includes("api.openalex.org")), false);
});

test("import rejects a caller-supplied source url", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W1", sourceUrl: "https://evil.test" })
    }),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.some((url) => url.includes("evil.test")), false);
});

test("openalex rate limit becomes a safe error", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807" })
    }),
    env,
    async (input) => {
      const url = String(input.url || input);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: true }]);
      if (url.includes("api.openalex.org")) return new Response("{}", { status: 429 });
      return jsonResponse([]);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error, "provider_rate_limited");
  assert.equal(JSON.stringify(body).includes("server-side-test-key"), false);
});

test("catalog reads use the deployed publishable config when worker bindings are missing", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    {
      ASSETS: {
        fetch: async () => new Response("window.PULSE_SUPABASE = { url: 'https://example.supabase.co', anonKey: 'publishable-key', siteUrl: '' };")
      }
    },
    async (input, options) => {
      calls.push(String(input));
      if (options.headers.apikey !== "publishable-key") return new Response("{}", { status: 401 });
      if (String(input).includes("resource_type,research_resource_topics")) return jsonResponse([]);
      return jsonResponse([{
        title: "Published study",
        slug: "published-study",
        resource_type: "article",
        publication_date: "2020-01-01",
        source_url: "https://doi.org/10.1000/example",
        retrieved_at: "2026-09-24T00:00:00Z",
        rights_class: "metadata",
        summary: null,
        open_access: false,
        doi: "10.1000/example",
        venue: "Journal",
        limitations_unknown: true,
        research_providers: { key: "openalex", attribution_text: "OpenAlex" },
        research_resource_contributors: [],
        research_resource_topics: [],
        research_licenses: []
      }], { "content-range": "0-0/1" });
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "published-study");
  assert.equal(response.headers.get("X-Pulse-Bindings"), "supabase_url=absent; supabase_anon=absent; openalex=absent; source=fallback");
  assert.equal(calls.some((url) => url.startsWith("https://example.supabase.co/rest/v1/research_works")), true);
});

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
