import assert from "node:assert/strict";
import test from "node:test";
import { onboardingDecision } from "./gate.js";

test("an unsigned visitor can open account creation and no later step", () => {
  assert.equal(onboardingDecision({ pathname: "/account/create", authenticated: false }).type, "serve");
  const services = onboardingDecision({ pathname: "/account/services", authenticated: false });
  assert.equal(services.type, "redirect");
  assert.equal(services.location, "/account/create");
});

test("a client on the business step cannot open discovery, services, or completion", () => {
  const base = { authenticated: true, role: "client", active: true, step: 2 };
  assert.equal(onboardingDecision({ ...base, pathname: "/account/business" }).type, "serve");
  assert.equal(onboardingDecision({ ...base, pathname: "/account/create" }).type, "serve");
  assert.equal(onboardingDecision({ ...base, pathname: "/account/discovery" }).location, "/account/business");
  assert.equal(onboardingDecision({ ...base, pathname: "/account/services" }).location, "/account/business");
  assert.equal(onboardingDecision({ ...base, pathname: "/account/complete" }).location, "/account/business");
});

test("a finished client leaves the form pages and can open the completion page", () => {
  const base = { authenticated: true, role: "client", active: true, step: 5 };
  assert.equal(onboardingDecision({ ...base, pathname: "/account/services" }).location, "/client-portal.html");
  assert.equal(onboardingDecision({ ...base, pathname: "/account/complete" }).type, "serve");
});

test("staff accounts are sent to their own portals", () => {
  assert.equal(onboardingDecision({ pathname: "/account/create", authenticated: true, role: "admin", active: true, step: 5 }).location, "/admin-portal.html");
  assert.equal(onboardingDecision({ pathname: "/account/business", authenticated: true, role: "employee", active: true, step: 2 }).location, "/staff-workspace.html");
});

test("routes outside onboarding are ignored", () => {
  assert.equal(onboardingDecision({ pathname: "/client-portal.html", authenticated: false }), null);
});
