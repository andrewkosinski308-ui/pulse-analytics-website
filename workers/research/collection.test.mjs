import assert from "node:assert/strict";
import test from "node:test";
import { handleResearchRequest } from "./api.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
  OPENALEX_API_KEY: "server-side-test-key"
};

test("published catalog includes existing research, new studies, and official google links", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12"),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      return collectionResponse(url);
    }
  );
  const body = await response.json();
  const slugs = body.results.map((row) => row.slug);
  assert.equal(response.status, 200);
  assert.equal(slugs.includes("bert-pre-training"), true);
  assert.equal(slugs.includes("query-sampler"), true);
  assert.equal(slugs.includes("seo-starter-guide"), true);
  assert.equal(slugs.includes("deep-learning"), false);
  assert.equal(slugs.includes("premium-guide"), false);
  assert.equal(slugs.includes("draft-guide"), false);
  const guide = body.results.find((row) => row.slug === "seo-starter-guide");
  assert.equal(guide.sourceType, "google");
  assert.equal(guide.sourceUrl, "https://developers.google.com/search/docs/fundamentals/seo-starter-guide");
  assert.equal(body.results.find((row) => row.slug === "query-sampler").sourceType, "openalex");
  assert.equal(calls.some((url) => url.includes("developers.google.com") || url.includes("support.google.com")), false);
  assert.equal(calls.some((url) => url.includes("/research_works") && url.includes("status=eq.published") && url.includes("access_tier=eq.public")), true);
  assert.equal(calls.some((url) => url.includes("/research_curated_resources") && url.includes("status=eq.published") && url.includes("access_tier=eq.public")), true);
});

test("search and search-seo filters query both catalogs without proxying urls", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?q=Search%20Console&category=search-seo&topic=seo&pageSize=12"),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.includes("/research_works?") && !url.includes("select=status,access_tier,resource_type")) {
        assert.equal(url.includes("title.ilike"), true);
        assert.equal(url.includes("topic"), true);
        assert.equal(url.includes("search-seo"), true);
      }
      if (url.includes("/research_curated_resources?") && !url.includes("select=status,access_tier,resource_type")) {
        assert.equal(url.includes("description.ilike"), true);
        assert.equal(url.includes("research_categories.slug"), true);
        assert.equal(url.includes("seo"), true);
      }
      return collectionResponse(url);
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results.some((row) => row.sourceType === "google"), true);
  assert.equal(body.results.some((row) => row.slug === "query-sampler"), true);
  assert.equal(calls.some((url) => url.startsWith("https://developers.google.com") || url.startsWith("https://support.google.com")), false);
});

test("official google resources are not served by the research detail route", async () => {
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/seo-starter-guide"),
    env,
    async () => jsonResponse([])
  );
  assert.equal(response.status, 404);
});

test("tier query parameters still cannot bypass the public catalog", async () => {
  const calls = [];
  const response = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?tier=premium"),
    env,
    async (input) => {
      calls.push(String(input.url || input));
      return jsonResponse([]);
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

function collectionResponse(url) {
  if (url.includes("/research_curated_resources")) {
    if (url.includes("select=status,access_tier,resource_type")) {
      return jsonResponse([
        { status: "published", access_tier: "public", resource_type: "official-guide" },
        { status: "draft", access_tier: "public", resource_type: "official-guide" },
        { status: "published", access_tier: "internal", resource_type: "official-guide" }
      ]);
    }
    return jsonResponse([
      googleRow(),
      { ...googleRow(), slug: "draft-guide", status: "draft" },
      { ...googleRow(), slug: "premium-guide", access_tier: "premium", external_url: "https://support.google.com/webmasters/answer/7576553" }
    ]);
  }
  if (url.includes("/research_categories") || url.includes("/research_topics?")) return jsonResponse([]);
  if (url.includes("select=status,access_tier,resource_type")) {
    return jsonResponse([
      { status: "published", access_tier: "public", resource_type: "conference-paper" },
      { status: "draft", access_tier: "public", resource_type: "article" },
      { status: "published", access_tier: "premium", resource_type: "article" }
    ]);
  }
  return jsonResponse([bertRow(), draftWork(), studyRow(), premiumWork()]);
}

function googleRow() {
  return {
    slug: "seo-starter-guide",
    title: "SEO Starter Guide",
    description: "A practical introduction to SEO.",
    publisher: "Google Search Central",
    external_url: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    resource_type: "official-guide",
    status: "published",
    access_tier: "public",
    rights_class: "source_link",
    research_categories: { slug: "search-seo", display_name: "Search & SEO" },
    research_curated_resource_topics: [
      { research_topics: { slug: "seo", display_name: "SEO", name: "SEO" } }
    ]
  };
}

function bertRow() {
  return {
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    slug: "bert-pre-training",
    status: "published",
    access_tier: "public",
    resource_type: "conference-paper",
    publication_date: "2019-01-01",
    source_url: "https://doi.org/10.18653/v1/n19-1423",
    rights_class: "metadata",
    summary: null,
    limitations_unknown: true,
    research_providers: { key: "openalex", attribution_text: "OpenAlex" },
    research_resource_contributors: [],
    research_resource_topics: [],
    research_licenses: []
  };
}

function studyRow() {
  return {
    ...bertRow(),
    title: "Query sampler: generating query sets for analyzing search engines using keyword research tools",
    slug: "query-sampler",
    resource_type: "article",
    publication_date: "2023-06-07",
    source_url: "https://doi.org/10.7717/peerj-cs.1421",
    rights_class: "pulse_summary",
    summary: "A methods paper about keyword research tools and search queries."
  };
}

function draftWork() {
  return { ...bertRow(), title: "Deep Learning", slug: "deep-learning", status: "draft" };
}

function premiumWork() {
  return { ...bertRow(), title: "Premium study", slug: "premium-study", access_tier: "premium" };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
