import assert from "node:assert/strict";
import test from "node:test";
import { handleResearchRequest } from "./api.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
  OPENALEX_API_KEY: "server-side-test-key"
};

test("scholarly search returns normalized OpenAlex results without raw payload or secrets", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/search?q=SEO"),
    env,
    async (input, init) => {
      const url = String(input.url || input);
      calls.push({ url, method: init?.method || input.method || "GET" });
      if (url.includes("api.openalex.org")) return jsonResponse({ results: [rawWork()], meta: { secret: "hidden" } });
      if (url.includes("/rest/v1/research_works")) {
        return jsonResponse([{ slug: "bert-pre-training", external_id: "W100" }]);
      }
      return jsonResponse([]);
    }
  );
  const body = await response.json();
  const text = JSON.stringify(body);
  const row = body.results[0];
  assert.equal(response.status, 200);
  assert.equal(row.id, "W100");
  assert.equal(row.title, "Search engine optimization and visibility");
  assert.equal(row.publicationYear, 2023);
  assert.deepEqual(row.authors, ["Ada Lovelace", "Grace Hopper", "Alan Turing"]);
  assert.equal(row.moreAuthors, true);
  assert.equal(row.sourceName, "Journal of Search");
  assert.equal(row.type, "Journal Article");
  assert.equal(row.doi, "10.1000/seo");
  assert.equal(row.openalexId, "W100");
  assert.equal(row.sourceUrl, "https://journal.example/seo-article");
  assert.equal(row.isOpenAccess, true);
  assert.equal(row.citedByCount, 12);
  assert.equal(row.catalogSlug, "bert-pre-training");
  assert.equal(text.includes("server-side-test-key"), false);
  assert.equal(text.includes("abstract_inverted_index"), false);
  assert.equal(text.includes("authorships"), false);
  assert.equal(text.includes("hidden"), false);
  assert.equal(calls.some((call) => call.method !== "GET"), false);
  assert.equal(calls.some((call) => call.url.includes("api.openalex.org") && new URL(call.url).searchParams.get("search") === "SEO"), true);
  assert.equal(Number(new URL(calls.find((call) => call.url.includes("api.openalex.org")).url).searchParams.get("per_page")) <= 20, true);
});

test("Google Search Console and keyword research search OpenAlex", async () => {
  for (const q of ["Google Search Console", "keyword research"]) {
    const calls = [];
    const response = await handleResearchRequest(
      new Request(`https://pulse.test/api/research/search?q=${encodeURIComponent(q)}`),
      env,
      async (input) => {
        const url = String(input.url || input);
        calls.push(url);
        if (url.includes("api.openalex.org")) {
          assert.equal(new URL(url).searchParams.get("search"), q);
          return jsonResponse({ results: [{ ...rawWork(), display_name: q, id: "https://openalex.org/W200" }] });
        }
        return jsonResponse([]);
      }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results[0].title, q);
    assert.equal(calls.some((url) => url.startsWith("https://evil.test") || url.includes("url=https")), false);
  }
});

test("repeated scholarly searches use the short-lived normalized cache", async () => {
  let openAlexCalls = 0;
  const fetchImpl = async (input) => {
    const url = String(input.url || input);
    if (url.includes("api.openalex.org")) {
      openAlexCalls += 1;
      return jsonResponse({ results: [rawWork()] });
    }
    return jsonResponse([]);
  };
  const first = await handleResearchRequest(new Request("https://pulse.test/api/research/search?q=local%20SEO"), env, fetchImpl);
  const second = await handleResearchRequest(new Request("https://pulse.test/api/research/search?q=local%20SEO"), env, fetchImpl);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(openAlexCalls, 1);
});

test("empty, short, long, and proxied scholarly queries are rejected", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(String(input.url || input));
    return jsonResponse({ results: [] });
  };
  const cases = [
    "https://pulse.test/api/research/search",
    "https://pulse.test/api/research/search?q=",
    "https://pulse.test/api/research/search?q=a",
    `https://pulse.test/api/research/search?q=${"a".repeat(101)}`,
    "https://pulse.test/api/research/search?q=SEO&limit=21",
    "https://pulse.test/api/research/search?q=SEO&url=https://evil.test",
    "https://pulse.test/api/research/search?q=https://api.openalex.org/works"
  ];
  for (const target of cases) {
    const response = await handleResearchRequest(new Request(target), env, fetchImpl);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_query" });
  }
  assert.equal(calls.length, 0);
});

test("scholarly result limit stays capped at 20", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/search?q=marketing%20analytics&limit=20"),
    env,
    async (input) => {
      const url = String(input.url || input);
      if (url.includes("api.openalex.org")) {
        assert.equal(new URL(url).searchParams.get("per_page"), "20");
        return jsonResponse({ results: [] });
      }
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [] });
});

test("OpenAlex failure stays a controlled scholarly search error", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/search?q=AI%20marketing"),
    env,
    async () => new Response("upstream exploded api_key=server-side-test-key", { status: 500 })
  );
  const text = JSON.stringify(await response.json());
  assert.equal(response.status, 503);
  assert.equal(text, JSON.stringify({ error: "search_unavailable" }));
  assert.equal(text.includes("server-side-test-key"), false);
  assert.equal(text.includes("exploded"), false);
});

test("live scholarly search does not write catalog records", async () => {
  const calls = [];
  await handleResearchRequest(
    new Request("https://pulse.test/api/research/search?q=website%20conversion"),
    env,
    async (input, init) => {
      calls.push({ url: String(input.url || input), method: init?.method || "GET" });
      if (String(input.url || input).includes("api.openalex.org")) return jsonResponse({ results: [rawWork()] });
      return jsonResponse([]);
    }
  );
  assert.equal(calls.some((call) => call.method !== "GET"), false);
  assert.equal(calls.some((call) => /\/rest\/v1\/research_(works|curated)/.test(call.url) && call.method !== "GET"), false);
});

test("catalog search and category filters stay independent of scholarly search", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?q=SEO&category=search-seo&topic=seo"),
    env,
    async (input) => {
      calls.push(String(input.url || input));
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 200);
  assert.equal(calls.some((url) => url.includes("api.openalex.org")), false);
  assert.equal(calls.some((url) => url.includes("/research_works") && url.includes("status=eq.published")), true);
  assert.equal(calls.some((url) => url.includes("/research_curated_resources") && url.includes("search-seo")), true);
  assert.equal(calls.some((url) => url.includes("topic")), true);
});

test("scholarly search rate limit does not expose upstream details", async () => {
  let status = 200;
  for (let i = 0; i < 31; i += 1) {
    const response = await handleResearchRequest(
      new Request("https://pulse.test/api/research/search?q=rate%20limit", { headers: { "CF-Connecting-IP": "203.0.113.8" } }),
      env,
      async (input) => {
        if (String(input.url || input).includes("api.openalex.org")) return jsonResponse({ results: [rawWork()] });
        return jsonResponse([]);
      }
    );
    status = response.status;
  }
  assert.equal(status, 429);
});

function rawWork() {
  return {
    id: "https://openalex.org/W100",
    display_name: "Search engine optimization and visibility",
    publication_year: 2023,
    type: "article",
    doi: "https://doi.org/10.1000/seo",
    open_access: { is_oa: true },
    cited_by_count: 12,
    authorships: [
      { author: { display_name: "Ada Lovelace" } },
      { author: { display_name: "Grace Hopper" } },
      { author: { display_name: "Alan Turing" } },
      { author: { display_name: "Edsger Dijkstra" } }
    ],
    primary_location: {
      landing_page_url: "https://journal.example/seo-article",
      pdf_url: "https://journal.example/seo-article.pdf",
      source: { display_name: "Journal of Search", type: "journal" }
    },
    abstract_inverted_index: { secret: [0] },
    topics: [{ display_name: "Should not be copied" }]
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
