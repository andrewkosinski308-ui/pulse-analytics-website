import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INDUSTRIES, INTERESTS, MARKETS } from "./onboarding-catalog.js";
import { validateOnboarding } from "./onboarding-rules.js";

const migration = readFileSync(new URL("../supabase/migrations/20260927061000_client_onboarding.sql", import.meta.url), "utf8");

test("account step requires a name, email, and matching password", () => {
  const missing = validateOnboarding(1, { full_name: "A", email: "not-an-email", password: "short", confirm: "other" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.full_name);
  assert.ok(missing.errors.email);
  assert.ok(missing.errors.password);
  assert.ok(missing.errors.confirm);

  const valid = validateOnboarding(1, {
    full_name: "Portal Owner",
    email: "owner@example.com",
    password: "Pulse1234",
    confirm: "Pulse1234"
  });
  assert.equal(valid.ok, true);
});

test("an existing account can update the name without sending a password", () => {
  const result = validateOnboarding(1, {
    existing: true,
    full_name: "Portal Owner",
    email: "owner@example.com"
  });
  assert.equal(result.ok, true);
});

test("business, discovery, and services reject incomplete answers", () => {
  assert.equal(validateOnboarding(2, { business_name: "Acme", region: "ZZ" }).ok, false);
  assert.equal(validateOnboarding(3, { industry: "other", markets: [], market_summary: "too short" }).ok, false);
  const services = validateOnboarding(4, { interests: ["seo", "branding"], primary_interest: "web-design" });
  assert.equal(services.ok, false);
  assert.ok(services.errors.primary_interest);
});

test("a complete services selection accepts one primary interest", () => {
  const result = validateOnboarding(4, {
    interests: ["seo", "local-seo"],
    primary_interest: "seo",
    interest_note: ""
  });
  assert.equal(result.ok, true);
});

test("the database constraints include every onboarding choice", () => {
  for (const item of [...INDUSTRIES, ...MARKETS, ...INTERESTS]) {
    assert.equal(migration.includes(`'${item.id}'`), true, item.id);
  }
});
