import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./router.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "https://pulseanalyticsgroupllc.com/";

function assets() {
  const calls = [];
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(request) {
          calls.push(new URL(request.url).pathname);
          return new Response("ok", { status: new URL(request.url).pathname === "/js/supabase-env.js" ? 404 : 200 });
        }
      }
    }
  };
}

async function route(url, headers = {}) {
  const mock = assets();
  const response = await worker.fetch(new Request(url, { headers, redirect: "manual" }), mock.env);
  return { response, calls: mock.calls };
}

function robotsRules(text) {
  let active = false;
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf(":");
    const key = trimmed.slice(0, split).trim().toLowerCase();
    const value = trimmed.slice(split + 1).trim();
    if (key === "user-agent") {
      active = value === "*";
      continue;
    }
    if (active && (key === "allow" || key === "disallow")) rules.push({ type: key, path: value });
  }
  return rules;
}

function robotsAllows(rules, path) {
  let match = null;
  for (const rule of rules) {
    if (!rule.path || !path.startsWith(rule.path)) continue;
    if (!match || rule.path.length > match.path.length) match = rule;
  }
  return !match || match.type === "allow";
}

test("http homepage permanently redirects to the canonical https homepage", async () => {
  const { response, calls } = await route("http://pulseanalyticsgroupllc.com/");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), CANONICAL);
  assert.equal(calls.length, 0);
});

test("www homepage permanently redirects to the canonical https homepage", async () => {
  const { response } = await route("https://www.pulseanalyticsgroupllc.com/");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), CANONICAL);
});

test("http www homepage redirects once to the canonical homepage", async () => {
  const { response } = await route("http://www.pulseanalyticsgroupllc.com/");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), CANONICAL);
});

test("canonical https homepage is served without a redirect", async () => {
  const { response, calls } = await route(CANONICAL);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(calls, ["/"]);
});

test("canonical homepage does not redirect to itself when the visitor scheme is already https", async () => {
  const first = await route(CANONICAL, { "CF-Visitor": "{\"scheme\":\"https\"}" });
  assert.equal(first.response.status, 200);
  const again = await route(CANONICAL);
  assert.equal(again.response.status, 200);
  assert.equal(again.response.headers.get("location"), null);
});

test("an http visitor recorded by Cloudflare still redirects once to https", async () => {
  const { response } = await route(CANONICAL, { "CF-Visitor": "{\"scheme\":\"http\"}" });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), CANONICAL);
  const followed = await route(CANONICAL, { "CF-Visitor": "{\"scheme\":\"https\"}" });
  assert.equal(followed.response.status, 200);
});

test("http and www paths keep their path and query on the canonical host", async () => {
  const httpPath = await route("http://pulseanalyticsgroupllc.com/contact.html?topic=seo");
  assert.equal(httpPath.response.status, 301);
  assert.equal(httpPath.response.headers.get("location"), "https://pulseanalyticsgroupllc.com/contact.html?topic=seo");

  const wwwPath = await route("https://www.pulseanalyticsgroupllc.com/services/seo.html?ref=ad");
  assert.equal(wwwPath.response.status, 301);
  assert.equal(wwwPath.response.headers.get("location"), "https://pulseanalyticsgroupllc.com/services/seo.html?ref=ad");
});

test("legacy host and path redirects still resolve to the canonical host", async () => {
  const legacy = await route("https://pulseanalyticsgroup.com/about.html");
  assert.equal(legacy.response.status, 301);
  assert.equal(legacy.response.headers.get("location"), "https://pulseanalyticsgroupllc.com/about.html");

  const legacyWww = await route("http://www.pulseanalyticsgroup.com/");
  assert.equal(legacyWww.response.status, 301);
  assert.equal(legacyWww.response.headers.get("location"), CANONICAL);

  const blog = await route("https://pulseanalyticsgroupllc.com/blog.html");
  assert.equal(blog.response.status, 301);
  assert.equal(blog.response.headers.get("location"), "https://pulseanalyticsgroupllc.com/resources/blog.html");

  const cased = await route("https://pulseanalyticsgroupllc.com/Solutions/local-business-growth.html");
  assert.equal(cased.response.status, 301);
  assert.equal(cased.response.headers.get("location"), "https://pulseanalyticsgroupllc.com/solutions/local-business-growth.html");
});

test("homepage canonical tag is the https non-www url", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const tags = html.match(/<link\s+rel="canonical"[^>]*>/gi) || [];
  assert.equal(tags.length, 1);
  assert.match(tags[0], /href="https:\/\/pulseanalyticsgroupllc\.com\/"/);
});

test("robots.txt allows the homepage and keeps the intentional blocks", () => {
  const text = readFileSync(join(root, "robots.txt"), "utf8");
  const rules = robotsRules(text);
  assert.equal(rules.some((rule) => rule.type === "disallow" && rule.path === "/"), false);
  assert.equal(robotsAllows(rules, "/"), true);
  assert.equal(robotsAllows(rules, "/about.html"), true);
  assert.equal(robotsAllows(rules, "/admin-login.html"), true);
  assert.equal(robotsAllows(rules, "/api/"), false);
  assert.equal(robotsAllows(rules, "/api/research/resources"), false);
  assert.equal(robotsAllows(rules, "/resources/research-curation.html"), false);
  assert.equal(robotsAllows(rules, "/resources/research-curation"), false);
  assert.match(text, /Sitemap:\s*https:\/\/pulseanalyticsgroupllc\.com\/sitemap\.xml/);
});

test("sitemap lists the canonical homepage and not the http or www variants", () => {
  const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
  assert.match(xml, /<loc>https:\/\/pulseanalyticsgroupllc\.com\/<\/loc>/);
  assert.equal(xml.includes("http://pulseanalyticsgroupllc.com"), false);
  assert.equal(xml.includes("www.pulseanalyticsgroupllc.com"), false);
});

test("research and admin routes stay on the canonical host", async () => {
  const research = await route("https://pulseanalyticsgroupllc.com/api/research/resources?page=1&pageSize=12&sort=publication_date");
  assert.notEqual(research.response.status, 301);
  assert.equal(research.response.headers.get("location"), null);

  const admin = await route("https://pulseanalyticsgroupllc.com/admin-login.html");
  assert.equal(admin.response.status, 200);
  assert.equal(admin.response.headers.get("location"), null);
  assert.deepEqual(admin.calls, ["/admin-login.html"]);
});
