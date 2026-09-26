import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterBenchmarks, filterOptions, renderBenchmarkCards, selectionMessage } from "../../js/benchmarks-state.js";
import worker from "../router.js";
import { benchmarkCatalog, benchmarkMigrationSql, EMPTY_MESSAGE, ERROR_MESSAGE, METRICS } from "./catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = benchmarkCatalog();
const dash = "\u2013";

const approvedValues = [
  "5.13%",
  `1.4%${dash}3.3%`,
  "6.6%",
  "43.46%",
  "2.09%",
  "2.14%",
  "6.81%",
  `2.96%${dash}14.82%`,
  "0.22%",
  "0.20%",
  `Approximately 0.09%${dash}0.40%`,
  "6.64%",
  "$5.42",
  "8.18%",
  "$66.69",
  "20.02%",
  "10.36%",
  "3.89%",
  "4.9%",
  "84%",
  "3%",
  "2%",
  "1.8%",
  "1.5%",
  "0.8%",
  "4.0%",
  "4.1%",
  "4.5%",
  "1.20%",
  "1.15%",
  "0.80%",
  "0.55%",
  "0.20%",
  "Approximately 1.27%",
  "2.72%",
  "70.22%",
  "$192",
  "$265",
  "$169",
];

function observations() {
  return catalog.metrics.flatMap((metric) => metric.observations);
}

function byName(name) {
  return catalog.metrics.find((metric) => metric.name === name);
}

test("the catalog has six categories and the 20 approved metrics", () => {
  assert.deepEqual(catalog.categories.map((category) => category.name), [
    "Website & Conversion",
    "Email Marketing",
    "Advertising",
    "Search & SEO",
    "Social Media",
    "Ecommerce",
  ]);
  assert.equal(catalog.metrics.length, 20);
  assert.deepEqual(catalog.metrics.map((metric) => metric.name), [
    "Website Conversion Rate",
    "Lead Conversion Rate",
    "Landing-Page Conversion",
    "Open Rate",
    "Click Rate",
    "Click-to-Open Rate",
    "Unsubscribe Rate",
    "CTR",
    "CPC",
    "Conversion Rate",
    "Cost per Lead / Conversion",
    "Organic CTR by Search Position",
    "Organic Search Conversion Rate",
    "Local Search Use Rate",
    "Engagement Rate",
    "Reach Rate",
    "Paid Social CTR",
    "Ecommerce Conversion Rate",
    "Cart Abandonment Rate",
    "Average Order Value",
  ]);
});

test("every displayed value is an approved source-map value", () => {
  const actual = observations().map((observation) => observation.value).sort();
  assert.deepEqual(actual, [...approvedValues].sort());
  assert.equal(observations().length, 39);
  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes("1.82"), false);
  assert.equal(serialized.includes("Pulse average"), false);
  assert.equal(serialized.includes("Pulse benchmark"), false);
});

test("multi-value metrics stay separate", () => {
  const engagement = byName("Engagement Rate");
  assert.deepEqual(engagement.observations.map((observation) => [observation.label, observation.value]), [
    ["Instagram", "3%"],
    ["LinkedIn", "2%"],
    ["X", "1.8%"],
    ["TikTok", "1.5%"],
    ["Facebook", "0.8%"],
  ]);
  const positions = byName("Organic CTR by Search Position");
  assert.deepEqual(positions.observations.map((observation) => [observation.label, observation.value]), [
    ["Position 1", "20.02%"],
    ["Position 2", "10.36%"],
    ["Position 3", "3.89%"],
  ]);
  const reach = byName("Reach Rate");
  assert.equal(reach.observations.length, 8);
  assert.deepEqual(
    reach.observations.filter((observation) => observation.group === "Instagram").map((observation) => observation.value),
    ["4.0%", "4.1%", "4.5%"]
  );
  const orderValue = byName("Average Order Value");
  assert.deepEqual(orderValue.observations.map((observation) => observation.value), ["$192", "$265", "$169"]);
});

test("required context stays attached to each named benchmark", () => {
  const checks = [
    ["Website Conversion Rate", "5.13%", "Ruler Analytics", "2026", "13 industries; 110M+ sessions and 5M+ conversions", "Not stated by source"],
    ["Open Rate", "43.46%", "MailerLite", `December 2024${dash}November 2025`, "3.6M+ campaigns; 46 industries", "Global"],
    ["CTR", "6.64%", "WordStream / LocaliQ", `April 2025${dash}March 2026`, "13,000+ search campaigns; 23 industries", "United States"],
    ["Ecommerce Conversion Rate", "2.72%", "Dynamic Yield", "Current rolling 12 months", "Ecommerce visitors", "Global"],
    ["Cart Abandonment Rate", "70.22%", "Baymard Institute", "Current published benchmark; 50-study compilation", "Ecommerce checkout studies", "Global/multi-study"],
  ];
  for (const [name, value, provider, period, segment, geography] of checks) {
    const metric = byName(name);
    const observation = metric.observations[0];
    assert.equal(observation.value, value);
    assert.equal(observation.provider, provider);
    assert.equal(observation.period, period);
    assert.equal(observation.segment, segment);
    assert.equal(observation.geography, geography);
    assert.equal(observation.definition, metric.definition);
    assert.ok(observation.limitations.length > 0);
    assert.ok(observation.sourceUrl.startsWith("https://"));
  }
  const local = byName("Local Search Use Rate");
  assert.match(local.note, /consumer behavior/i);
  assert.match(local.observations[0].statement, /84% of consumers searched/);
  assert.match(local.limitations, /does not measure a business's local SEO performance/);
});

test("category, metric, source, and period filters work together", () => {
  assert.equal(filterBenchmarks(catalog, { categoryId: "email-marketing" }).length, 4);
  assert.equal(filterBenchmarks(catalog, { metricId: "engagement-rate" }).length, 1);
  assert.equal(filterBenchmarks(catalog, { provider: "MailerLite" }).length, 4);
  assert.equal(filterBenchmarks(catalog, { period: "July 2026" }).length, 1);
  assert.equal(filterBenchmarks(catalog, {
    categoryId: "email-marketing",
    provider: "MailerLite",
    period: `December 2024${dash}November 2025`,
  }).length, 4);
  const empty = filterBenchmarks(catalog, { categoryId: "email-marketing", period: "July 2026" });
  assert.deepEqual(empty, []);
  assert.equal(selectionMessage(empty), EMPTY_MESSAGE);
  assert.equal(selectionMessage(empty), "No benchmark is available for this selection.");
  const options = filterOptions(catalog);
  assert.equal(options.sources.includes("Hootsuite"), true);
  assert.equal(options.periods.includes("July 2026"), true);
});

test("cards keep source links and methodology without ranking language", () => {
  const html = renderBenchmarkCards(catalog.metrics);
  assert.match(html, /43\.46%/);
  assert.match(html, /href="https:\/\/www\.mailerlite\.com\/blog\/compare-your-email-performance-metrics-industry-benchmarks"/);
  assert.match(html, /Methodology &amp; Limitations/);
  assert.match(html, /Apple Mail Privacy Protection can inflate recorded opens/);
  assert.match(html, /Position 1/);
  assert.match(html, /Position 2/);
  assert.match(html, /Position 3/);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.equal(html.includes("1.82"), false);
  assert.equal(/\b(good|bad|target|recommended|expected)\b/i.test(text), false);
  assert.equal(text.includes("should achieve"), false);
});

test("the migration stores the same approved observations", () => {
  const sql = benchmarkMigrationSql();
  const file = join(root, "supabase/migrations/20260926053000_benchmark_metrics.sql");
  assert.equal(readFileSync(file, "utf8"), sql);
  assert.equal(METRICS.length, 20);
  for (const value of approvedValues) assert.equal(sql.includes(value), true, value);
});

test("the public page is one sitemap URL without filter-state URLs", () => {
  const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
  const html = readFileSync(join(root, "sitemap.html"), "utf8");
  const page = readFileSync(join(root, "resources/marketing-benchmarks.html"), "utf8");
  assert.equal(xml.split("resources/marketing-benchmarks.html").length - 1, 1);
  assert.equal(xml.includes("marketing-benchmarks.html?"), false);
  assert.match(html, /resources\/marketing-benchmarks\.html/);
  assert.match(page, /Marketing Benchmarks &amp; Data/);
  assert.match(page, /Explore benchmark data for common marketing, website, advertising, social media, search, email, and ecommerce metrics\. Benchmarks provide context and should be interpreted within their source, audience, and measurement methodology\./);
  assert.match(page, /Website &amp; Conversion/);
  assert.match(page, /Email Marketing/);
  assert.match(page, /Advertising/);
  assert.match(page, /Search &amp; SEO/);
  assert.match(page, /Social Media/);
  assert.match(page, /Ecommerce/);
  assert.equal(page.includes("?category="), false);
});

test("benchmark data loads from its own route", async () => {
  const response = await worker.fetch(new Request("https://pulseanalyticsgroupllc.com/api/benchmarks"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.metrics.length, 20);
  const missing = await worker.fetch(new Request("https://pulseanalyticsgroupllc.com/api/benchmarks/filter"));
  assert.equal(missing.status, 404);
  const research = await worker.fetch(new Request("https://pulseanalyticsgroupllc.com/api/research/not-a-route"));
  assert.equal(research.status, 404);
  assert.deepEqual(await research.json(), { error: "not_found" });
  const market = await worker.fetch(new Request("https://pulseanalyticsgroupllc.com/api/market-intelligence/not-a-route"));
  assert.equal(market.status, 404);
  const marketBody = await market.json();
  assert.equal(marketBody.metrics, undefined);
  const assets = [];
  const page = await worker.fetch(new Request("https://pulseanalyticsgroupllc.com/resources/marketing-benchmarks.html"), {
    ASSETS: {
      async fetch(request) {
        assets.push(new URL(request.url).pathname);
        return new Response("ok", { status: 200 });
      },
    },
  });
  assert.equal(page.status, 200);
  assert.deepEqual(assets, ["/resources/marketing-benchmarks.html"]);
});

test("a catalog failure uses the public error message and not a raw database error", () => {
  assert.equal(ERROR_MESSAGE, "Benchmark data is temporarily unavailable. Please try again.");
  assert.equal(ERROR_MESSAGE.includes("postgres"), false);
});
