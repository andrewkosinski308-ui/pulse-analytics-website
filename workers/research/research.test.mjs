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
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?tier=premium")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?access_tier=internal")).error, "invalid_query");
  assert.equal(parseListQuery(new URL("https://pulse.test/api/research/resources?category=search-seo")).category, "search-seo");
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
      if (url.includes("/research_curated_resources")) return jsonResponse([]);
      return jsonResponse([publishedStudy()], { "content-range": "0-0/1" });
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
      if (String(input).includes("/research_curated_resources")) return jsonResponse([]);
      return jsonResponse([publishedStudy()], { "content-range": "0-0/1" });
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "published-study");
  assert.equal(response.headers.get("X-Pulse-Bindings"), "supabase_url=absent; supabase_anon=absent; openalex=absent; source=fallback");
  assert.equal(calls.some((url) => url.startsWith("https://example.supabase.co/rest/v1/research_works")), true);
});

test("primary catalog binding succeeds without reading the fallback", async () => {
  const assets = [];
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    {
      ...env,
      ASSETS: { fetch: async () => { assets.push("fallback"); return new Response(""); } }
    },
    async (input) => {
      calls.push(String(input.url || input));
      return catalogResponse(String(input.url || input));
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "bert-pre-training");
  assert.equal(body.results.some((row) => row.slug === "deep-learning"), false);
  assert.equal(assets.length, 0);
  assert.equal(calls.every((url) => url.startsWith("https://example.supabase.co/")), true);
  assert.equal(response.headers.get("X-Pulse-Bindings"), "supabase_url=present; supabase_anon=present; openalex=present; source=binding");
});

test("missing worker binding uses the deployed public catalog config", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    fallbackEnv(),
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.includes("/research_works")) {
        assert.equal(url.includes("status=eq.published"), true);
        assert.equal(url.includes("access_tier=eq.public"), true);
      }
      return catalogResponse(url);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "bert-pre-training");
  assert.equal(body.results.some((row) => row.slug === "deep-learning"), false);
  assert.equal(calls.some((url) => url.startsWith("https://fallback.supabase.co/")), true);
  assert.equal(calls.some((url) => url.startsWith("https://primary.supabase.co/")), false);
  assert.equal(response.headers.get("X-Pulse-Bindings").includes("source=fallback"), true);
});

test("transport failure uses the same published catalog query through the fallback", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    {
      ...env,
      SUPABASE_URL: "https://primary.supabase.co",
      ASSETS: {
        fetch: async () => new Response("window.PULSE_SUPABASE = { url: 'https://fallback.supabase.co', anonKey: 'publishable-key', siteUrl: '' };")
      }
    },
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.startsWith("https://primary.supabase.co/")) throw new TypeError("network down");
      return catalogResponse(url);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].slug, "bert-pre-training");
  assert.equal(calls.some((url) => url.startsWith("https://primary.supabase.co/")), true);
  assert.equal(calls.some((url) => url.startsWith("https://fallback.supabase.co/")), true);
  assert.equal(response.headers.get("X-Pulse-Bindings"), "supabase_url=present; supabase_anon=present; openalex=present; source=fallback");
});

test("schema error does not use the catalog fallback", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    {
      ...env,
      SUPABASE_URL: "https://primary.supabase.co",
      ASSETS: {
        fetch: async () => {
          calls.push("fallback-config");
          return new Response("window.PULSE_SUPABASE = { url: 'https://fallback.supabase.co', anonKey: 'publishable-key', siteUrl: '' };");
        }
      }
    },
    async (input) => {
      calls.push(String(input.url || input));
      return new Response(JSON.stringify({ code: "PGRST204", message: "column missing" }), { status: 400 });
    }
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "catalog_unavailable");
  assert.equal(calls.includes("fallback-config"), false);
  assert.equal(calls.some((url) => url.startsWith("https://fallback.supabase.co/")), false);
});

test("invalid catalog query does not query supabase or the fallback", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?pageSize=100&sort=secret"),
    {
      ...env,
      ASSETS: { fetch: async () => { calls.push("fallback-config"); return new Response(""); } }
    },
    async (input) => {
      calls.push(String(input.url || input));
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_query");
  assert.equal(calls.length, 0);
});

test("primary and fallback catalog responses match and hide drafts", async () => {
  const primary = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12&sort=title"),
    env,
    async (input) => catalogResponse(String(input.url || input))
  );
  const fallback = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12&sort=title"),
    fallbackEnv(),
    async (input) => {
      const url = String(input.url || input);
      if (url.includes("/research_works")) {
        assert.equal(url.includes("status=eq.published"), true);
        assert.equal(url.includes("access_tier=eq.public"), true);
      }
      return catalogResponse(url);
    }
  );
  const primaryBody = await primary.json();
  const fallbackBody = await fallback.json();
  assert.equal(primary.status, 200);
  assert.deepEqual(fallbackBody, primaryBody);
  assert.equal(primaryBody.results[0].slug, "bert-pre-training");
  assert.equal(JSON.stringify(primaryBody).includes("deep-learning"), false);
  assert.equal(primary.headers.get("X-Pulse-Bindings").endsWith("source=binding"), true);
  assert.equal(fallback.headers.get("X-Pulse-Bindings").endsWith("source=fallback"), true);
});

test("detail route uses the binding first and the fallback after transport failure", async () => {
  const primary = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/bert-pre-training"),
    env,
    async (input) => catalogResponse(String(input.url || input))
  );
  const primaryBody = await primary.json();
  assert.equal(primary.status, 200);
  assert.equal(primaryBody.result.slug, "bert-pre-training");
  assert.equal(primary.headers.get("X-Pulse-Bindings").endsWith("source=binding"), true);

  const calls = [];
  const fallback = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/bert-pre-training"),
    {
      ...env,
      SUPABASE_URL: "https://primary.supabase.co",
      ASSETS: {
        fetch: async () => new Response("window.PULSE_SUPABASE = { url: 'https://fallback.supabase.co', anonKey: 'publishable-key', siteUrl: '' };")
      }
    },
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.startsWith("https://primary.supabase.co/")) throw new TypeError("timeout");
      return catalogResponse(url);
    }
  );
  const fallbackBody = await fallback.json();
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallbackBody, primaryBody);
  assert.equal(fallback.headers.get("X-Pulse-Bindings").endsWith("source=fallback"), true);

  const denied = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/bert-pre-training"),
    {
      ...env,
      ASSETS: { fetch: async () => { calls.push("fallback-config"); return new Response(""); } }
    },
    async () => new Response(JSON.stringify({ code: "42501" }), { status: 401 })
  );
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).error, "catalog_unavailable");
  assert.equal(calls.includes("fallback-config"), false);
});

test("staff catalog routes stay authenticated and do not use the public fallback", async () => {
  const calls = [];
  const assets = { fetch: async () => { calls.push("fallback-config"); return new Response(""); } };
  for (const path of ["/api/research/staff/discover", "/api/research/staff/stage", "/api/research/staff/publish"]) {
    const response = await handleResearchRequest(
      new Request(`https://pulse.test${path}`, { method: "POST", body: "{}" }),
      { ...env, ASSETS: assets },
      async (input) => {
        calls.push(String(input.url || input));
        return jsonResponse([]);
      }
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  }
  const drafts = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/drafts"),
    { ...env, ASSETS: assets },
    async (input) => {
      calls.push(String(input.url || input));
      return jsonResponse([]);
    }
  );
  assert.equal(drafts.status, 401);
  assert.equal((await drafts.json()).error, "unauthorized");
  assert.equal(calls.length, 0);
});

test("public catalog hides drafts and non-public tiers on list and detail", async () => {
  const calls = [];
  const list = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      return catalogResponse(url);
    }
  );
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.deepEqual(body.results.map((row) => row.slug), ["bert-pre-training"]);
  assert.equal(calls.some((url) => url.includes("access_tier=eq.public")), true);
  assert.equal(calls.some((url) => url.includes("tier=premium")), false);

  const hidden = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/premium-study"),
    env,
    async (input) => jsonResponse([premiumRow()])
  );
  assert.equal(hidden.status, 404);

  const bypass = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?tier=premium"),
    env,
    async () => {
      throw new Error("query should not run");
    }
  );
  assert.equal(bypass.status, 400);
});

test("staff staging does not create topics from provider labels", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", topicSlugs: ["not-a-topic"] })
    }),
    env,
    async (input, options = {}) => {
      const url = String(input.url || input);
      calls.push({ url, method: options.method || "GET" });
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: true }]);
      if (url.includes("api.openalex.org")) {
        return jsonResponse({
          id: "https://openalex.org/W2741809807",
          display_name: "Imported study",
          publication_date: "2020-01-01",
          type: "article",
          topics: [{ display_name: "Machine learning" }]
        });
      }
      if (url.includes("/research_topics?")) return jsonResponse([]);
      if (options.method === "POST" && url.includes("/research_works")) return jsonResponse([{ id: "work-1", slug: "imported-study" }]);
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_topics")), false);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_works")), false);
});

test("controlled topic slugs can be attached without creating topics", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", topicSlugs: ["generative-ai"] })
    }),
    env,
    async (input, options = {}) => {
      const url = String(input.url || input);
      calls.push({ url, method: options.method || "GET" });
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: true }]);
      if (url.includes("api.openalex.org")) {
        return jsonResponse({
          id: "https://openalex.org/W2741809807",
          display_name: "Imported study",
          publication_date: "2020-01-01",
          type: "article",
          topics: [{ display_name: "Generative artificial intelligence" }]
        });
      }
      if (url.includes("/research_topics?")) return jsonResponse([{ id: "topic-1", slug: "generative-ai" }]);
      if (url.includes("slug=eq.")) return jsonResponse([]);
      if (options.method === "POST" && url.includes("/research_works")) return jsonResponse([{ id: "work-1", slug: "imported-study" }]);
      if (options.method === "POST" && url.includes("/research_resource_topics")) return jsonResponse([]);
      if (options.method === "POST") return jsonResponse([{ id: "row-1" }]);
      return jsonResponse([]);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "draft");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/research_topics")), false);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_resource_topics")), true);
});

function publishedStudy() {
  return {
    title: "Published study",
    slug: "published-study",
    status: "published",
    access_tier: "public",
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
  };
}

function bertRow() {
  return {
    ...publishedStudy(),
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    slug: "bert-pre-training",
    status: "published",
    doi: "10.18653/v1/n19-1423",
    source_url: "https://doi.org/10.18653/v1/n19-1423"
  };
}

function draftRow() {
  return {
    ...publishedStudy(),
    title: "Deep Learning",
    slug: "deep-learning",
    status: "draft"
  };
}

function fallbackEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("window.PULSE_SUPABASE = { url: 'https://fallback.supabase.co', anonKey: 'publishable-key', siteUrl: '' };")
    }
  };
}

function catalogResponse(url) {
  if (url.includes("/rest/v1/research_curated_resources")) return jsonResponse([]);
  if (url.includes("/rest/v1/research_categories") || url.includes("/rest/v1/research_topics?")) {
    return jsonResponse([]);
  }
  if (url.includes("select=status,access_tier,resource_type")) {
    return jsonResponse([bertRow()]);
  }
  if (url.includes("resource_type,research_resource_topics")) {
    return jsonResponse([bertRow()]);
  }
  if (url.includes("slug=eq.")) {
    return jsonResponse(url.includes("bert-pre-training") ? [bertRow(), draftRow()] : [draftRow()]);
  }
  return jsonResponse([bertRow(), draftRow(), premiumRow()], { "content-range": "0-0/1" });
}

function premiumRow() {
  return {
    ...bertRow(),
    title: "Premium study",
    slug: "premium-study",
    status: "published",
    access_tier: "premium"
  };
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
