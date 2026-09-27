import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../main.js", import.meta.url), "utf8");

test("public header keeps Client Portal and adds Admin Portal sign-in", () => {
  assert.match(source, /client-login\.html/);
  assert.match(source, /admin-login\.html/);
  assert.match(source, /Client Portal/);
  assert.match(source, /Admin Portal/);
  assert.match(source, /fa-user-lock/);
  assert.match(source, /fa-user-shield/);
  assert.doesNotMatch(source, /admin-portal\.html/);
  const clientAt = source.indexOf("client-login.html");
  const adminAt = source.indexOf("admin-login.html");
  assert.ok(clientAt > -1 && adminAt > clientAt);
});
