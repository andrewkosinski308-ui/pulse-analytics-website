import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../staff-workspace.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../client-portal.css", import.meta.url), "utf8");

test("the staff portal keeps its workspace below the shared header", () => {
  assert.match(page, /<body class="staff-portal-page">/);
  assert.match(page, /client-portal\.css/);
  assert.match(css, /body\.staff-portal-page\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\.staff-portal-page > header\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /body\.staff-portal-page > \.client-portal-shell\s*\{[^}]*overflow:\s*auto/s);
  assert.doesNotMatch(css, /body\.staff-portal-page[^}]*Category/);
  assert.equal(page.includes("position:fixed"), false);
});
