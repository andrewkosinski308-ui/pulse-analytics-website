import assert from "node:assert/strict";
import test from "node:test";
import { handleResearchRequest } from "./api.js";
import { resolveImportTarget } from "./duplicates.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
  OPENALEX_API_KEY: "server-side-test-key"
};

const openAlexWork = {
  id: "https://openalex.org/W2741809807",
  display_name: "Attention Is All You Need",
  publication_date: "2017-06-12",
  type: "article",
  doi: "https://doi.org/10.48550/arXiv.1706.03762",
  open_access: { is_oa: true },
  authorships: [{ author: { display_name: "Ashish Vaswani" } }],
  primary_location: { source: { display_name: "arXiv" } },
  topics: [{ display_name: "Machine learning" }],
  abstract_inverted_index: { Hello: [0], world: [1] }
};

test("title similarity does not merge works", () => {
  assert.equal(resolveImportTarget(null, null).action, "insert");
  assert.equal(resolveImportTarget({ id: "a", slug: "same-title" }, null).action, "attach");
});

test("unauthenticated curation routes are rejected", async () => {
  const calls = [];
  const routes = [
    ["POST", "/api/research/staff/discover"],
    ["POST", "/api/research/staff/stage"],
    ["POST", "/api/research/staff/publish"],
    ["GET", "/api/research/staff/drafts"]
  ];
  for (const [method, path] of routes) {
    const response = await handleResearchRequest(
      new Request(`https://pulse.test${path}`, { method, body: method === "POST" ? "{}" : undefined }),
      env,
      async (input) => {
        calls.push(String(input.url || input));
        return jsonResponse([]);
      }
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  }
  assert.equal(calls.length, 0);
});

test("authenticated non-admin curation is rejected", async () => {
  const calls = [];
  for (const path of ["/api/research/staff/discover", "/api/research/staff/stage", "/api/research/staff/publish"]) {
    const response = await handleResearchRequest(
      new Request(`https://pulse.test${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer staff-jwt" },
        body: JSON.stringify({ query: "attention", externalId: "W2741809807", slug: "imported-study" })
      }),
      env,
      mockAuth(calls, "client")
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "forbidden");
  }
  const drafts = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/drafts", { headers: { Authorization: "Bearer staff-jwt" } }),
    env,
    mockAuth(calls, "client")
  );
  assert.equal(drafts.status, 403);
  assert.equal(calls.some((call) => call.url.includes("api.openalex.org")), false);
});

test("discovery returns normalized openalex records and hides the provider credential", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/discover", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ query: "attention" })
    }),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: true }]);
      if (url.includes("api.openalex.org")) return jsonResponse({ results: [openAlexWork] });
      return jsonResponse([]);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].provider, "openalex");
  assert.equal(body.results[0].title, "Attention Is All You Need");
  assert.deepEqual(body.results[0].contributors, ["Ashish Vaswani"]);
  assert.equal(body.results[0].rightsClass, "permitted_description");
  assert.equal(body.results[0].sourceUrl.startsWith("https://doi.org/"), true);
  assert.equal(body.results[0].fullTextStored, false);
  assert.deepEqual(body.results[0].providerTopics, ["Machine learning"]);
  assert.equal(JSON.stringify(body).includes("abstract_inverted_index"), false);
  assert.equal(JSON.stringify(body).includes("server-side-test-key"), false);
  assert.equal(calls.some((url) => url.includes("https://api.openalex.org/")), true);
});

test("valid category and active topic stage a public draft", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({
        externalId: "W2741809807",
        categorySlug: "ai-marketing-technology",
        topicSlugs: ["generative-ai"]
      })
    }),
    env,
    stageFetch(calls, {
      category: [{ id: "cat-1", slug: "ai-marketing-technology" }],
      topics: [{ id: "topic-1", slug: "generative-ai", category_id: "cat-1", research_categories: { slug: "ai-marketing-technology" } }]
    })
  );
  const body = await response.json();
  const insert = calls.find((call) => call.method === "POST" && call.url.includes("/research_works"));
  const stored = JSON.parse(insert.body);
  assert.equal(response.status, 200);
  assert.equal(body.status, "draft");
  assert.equal(body.duplicate, false);
  assert.equal(stored.status, "draft");
  assert.equal(stored.access_tier, "public");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/research_topics")), false);
});

test("topic from another category is rejected", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({
        externalId: "W2741809807",
        categorySlug: "search-seo",
        topicSlugs: ["generative-ai"]
      })
    }),
    env,
    stageFetch(calls, {
      category: [{ id: "cat-1", slug: "search-seo" }],
      topics: [{ id: "topic-1", slug: "generative-ai", category_id: "cat-2", research_categories: { slug: "ai-marketing-technology" } }]
    })
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_taxonomy");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_works")), false);
});

test("unknown, deprecated, and arbitrary topics are rejected", async () => {
  const missing = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", topicSlugs: ["not-a-topic"] })
    }),
    env,
    stageFetch([], { topics: [] })
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "invalid_taxonomy");

  const deprecated = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", categorySlug: "search-seo", topicSlugs: ["seo"] })
    }),
    env,
    stageFetch([], { category: [{ id: "cat-1", slug: "search-seo" }], topics: [] })
  );
  assert.equal(deprecated.status, 400);
  assert.equal((await deprecated.json()).error, "invalid_taxonomy");

  const calls = [];
  const arbitrary = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", topicSlugs: ["Machine learning"] })
    }),
    env,
    stageFetch(calls, {})
  );
  assert.equal(arbitrary.status, 400);
  assert.equal((await arbitrary.json()).error, "invalid_query");
  assert.equal(calls.some((call) => call.url.includes("api.openalex.org")), false);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_topics")), false);
});

test("unknown category is rejected", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", categorySlug: "not-a-category", topicSlugs: ["seo"] })
    }),
    env,
    stageFetch(calls, { category: [], topics: [{ id: "topic-1", slug: "seo", research_categories: { slug: "search-seo" } }] })
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_taxonomy");
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("same doi attaches to the existing work", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807", topicSlugs: ["generative-ai"] })
    }),
    env,
    stageFetch(calls, {
      topics: [{ id: "topic-1", slug: "generative-ai", research_categories: { slug: "ai-marketing-technology" } }],
      doi: [{ research_works: { id: "work-9", slug: "existing-study", status: "published" } }]
    })
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.slug, "existing-study");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_works")), false);
});

test("same provider and external id is not inserted again", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/stage", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ externalId: "W2741809807" })
    }),
    env,
    stageFetch(calls, {
      claim: [{ research_works: { id: "work-9", slug: "existing-study", status: "published" } }]
    })
  );
  const body = await response.json();
  assert.equal(body.duplicate, true);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/research_works")), false);
});

test("a classified draft can be published and then read publicly", async () => {
  let published = false;
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/publish", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ slug: "imported-study" })
    }),
    env,
    async (input, options = {}) => {
      const url = String(input.url || input);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (options.method === "PATCH") {
        published = true;
        return jsonResponse([{ slug: "imported-study", status: "published" }]);
      }
      if (url.includes("/research_works?") && url.includes("status=eq.draft")) return jsonResponse([draftRecord()]);
      if (url.includes("/research_work_identifiers")) return jsonResponse([]);
      if (url.includes("/research_provider_claims")) return jsonResponse([]);
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "published");
  assert.equal(published, true);

  const visible = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/imported-study"),
    env,
    async () => jsonResponse([{ ...draftRecord(), status: "published", access_tier: "public" }])
  );
  assert.equal(visible.status, 200);
  assert.equal((await visible.json()).result.slug, "imported-study");
});

test("publish rejects incomplete, non-publishable, and non-public drafts", async () => {
  const rights = await publishCase({ rights_class: "copyrighted_full_text_prohibited" });
  assert.equal(rights.status, 409);
  assert.equal(rights.body.error, "rights_rejected");
  assert.equal(rights.patched, false);

  const unknownRights = await publishCase({ rights_class: "unknown" });
  assert.equal(unknownRights.status, 409);
  assert.equal(unknownRights.body.error, "rights_rejected");

  const missingUrl = await publishCase({ source_url: "" });
  assert.equal(missingUrl.status, 400);
  assert.equal(missingUrl.body.error, "provenance_incomplete");

  const missingExternal = await publishCase({ external_id: "" });
  assert.equal(missingExternal.status, 400);
  assert.equal(missingExternal.body.error, "provenance_incomplete");

  const premium = await publishCase({ access_tier: "premium" });
  assert.equal(premium.status, 403);
  assert.equal(premium.body.error, "access_rejected");

  const internal = await publishCase({ access_tier: "internal" });
  assert.equal(internal.status, 403);
  assert.equal(internal.body.error, "access_rejected");

  const unclassified = await publishCase({ research_resource_topics: [] });
  assert.equal(unclassified.status, 400);
  assert.equal(unclassified.body.error, "invalid_taxonomy");

  const deprecated = await publishCase({
    research_resource_topics: [{
      research_topics: {
        slug: "seo",
        status: "deprecated",
        category_id: "cat-1",
        research_categories: { slug: "search-seo", display_name: "Search & SEO" }
      }
    }]
  });
  assert.equal(deprecated.status, 400);
  assert.equal(deprecated.body.error, "invalid_taxonomy");
  assert.equal(deprecated.patched, false);
});

test("publish rejects duplicate doi and provider identity", async () => {
  const doi = await publishCase({}, { doi: [{ work_id: "other" }] });
  assert.equal(doi.status, 409);
  assert.equal(doi.body.error, "duplicate_work");
  assert.equal(doi.patched, false);

  const claim = await publishCase({}, { claim: [{ work_id: "other" }] });
  assert.equal(claim.status, 409);
  assert.equal(claim.body.error, "duplicate_work");
  assert.equal(claim.patched, false);
});

test("an already published slug is not published again", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/publish", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ slug: "bert-pre-training" })
    }),
    env,
    async (input) => {
      const url = String(input.url || input);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "not_found");
});

test("staff drafts are admin-only public drafts and ignore tier query parameters", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/drafts", { headers: { Authorization: "Bearer staff-jwt" } }),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      assert.equal(url.includes("status=eq.draft"), true);
      assert.equal(url.includes("access_tier=eq.public"), true);
      return jsonResponse([
        draftRecord(),
        { ...draftRecord(), slug: "published-study", status: "published" },
        { ...draftRecord(), slug: "premium-draft", access_tier: "premium" }
      ]);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((row) => row.slug), ["imported-study"]);
  assert.equal(body.results[0].status, "draft");
  assert.equal(body.results[0].accessTier, "public");

  const bypass = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/drafts?tier=premium", { headers: { Authorization: "Bearer staff-jwt" } }),
    env,
    async (input) => {
      const url = String(input.url || input);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (url.includes("/research_works")) throw new Error("draft query should not run");
      return jsonResponse([]);
    }
  );
  assert.equal(bypass.status, 400);
});

test("a staged draft stays off the public detail route", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/imported-study"),
    env,
    async () => jsonResponse([draftRecord()])
  );
  assert.equal(response.status, 404);
});

function mockAuth(calls, role) {
  return async (input) => {
    const url = String(input.url || input);
    calls.push({ url });
    if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-1" });
    if (url.includes("/profiles")) return jsonResponse([{ role, is_active: true }]);
    return jsonResponse([]);
  };
}

function stageFetch(calls, fixtures) {
  return async (input, options = {}) => {
    const url = String(input.url || input);
    const call = { url, method: options.method || "GET", body: options.body || null };
    calls.push(call);
    if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
    if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
    if (url.includes("/research_providers")) return jsonResponse([{ id: "p1", key: "openalex", is_enabled: true }]);
    if (url.includes("api.openalex.org")) return jsonResponse(openAlexWork);
    if (url.includes("/research_categories?")) return jsonResponse(fixtures.category || []);
    if (url.includes("/research_topics?")) return jsonResponse(fixtures.topics || []);
    if (url.includes("/research_work_identifiers")) return jsonResponse(fixtures.doi || []);
    if (url.includes("/research_provider_claims") && (!options.method || options.method === "GET")) {
      return jsonResponse(fixtures.claim || []);
    }
    if (url.includes("slug=eq.")) return jsonResponse([]);
    if (options.method === "POST" && url.includes("/research_works")) return jsonResponse([{ id: "work-1", slug: "attention-is-all-you-need" }]);
    if (options.method === "POST" && url.includes("/research_resource_topics")) return jsonResponse([]);
    if (options.method === "POST") return jsonResponse([{ id: "row-1" }]);
    if (options.method === "DELETE") return jsonResponse([]);
    return jsonResponse([]);
  };
}

async function publishCase(overrides, conflicts = {}) {
  let patched = false;
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/staff/publish", {
      method: "POST",
      headers: { Authorization: "Bearer staff-jwt" },
      body: JSON.stringify({ slug: "imported-study" })
    }),
    env,
    async (input, options = {}) => {
      const url = String(input.url || input);
      if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: "admin-1" });
      if (url.includes("/profiles")) return jsonResponse([{ role: "admin", is_active: true }]);
      if (options.method === "PATCH") {
        patched = true;
        return jsonResponse([{ slug: "imported-study", status: "published" }]);
      }
      if (url.includes("/research_works?")) return jsonResponse([draftRecord(overrides)]);
      if (url.includes("/research_work_identifiers")) return jsonResponse(conflicts.doi || []);
      if (url.includes("/research_provider_claims")) return jsonResponse(conflicts.claim || []);
      return jsonResponse([]);
    }
  );
  return { status: response.status, body: await response.json(), patched };
}

function draftRecord(overrides = {}) {
  return {
    id: "work-1",
    title: "Imported study",
    slug: "imported-study",
    resource_type: "article",
    publication_date: "2020-01-01",
    status: "draft",
    access_tier: "public",
    source_url: "https://doi.org/10.1000/imported",
    external_id: "W2741809807",
    retrieved_at: "2026-09-25T00:00:00.000Z",
    rights_class: "metadata",
    summary: null,
    open_access: false,
    doi: "10.1000/imported",
    venue: null,
    methodology: null,
    limitations: null,
    limitations_unknown: true,
    provider_id: "p1",
    research_providers: { key: "openalex", attribution_text: "OpenAlex" },
    research_resource_contributors: [{ role: "author", research_contributors: { full_name: "Ada Lovelace" } }],
    research_resource_topics: [{
      research_topics: {
        name: "Generative AI",
        display_name: "Generative AI",
        slug: "generative-ai",
        status: "active",
        category_id: "cat-1",
        research_categories: { slug: "ai-marketing-technology", display_name: "AI & Marketing Technology" }
      }
    }],
    research_licenses: [],
    ...overrides
  };
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
