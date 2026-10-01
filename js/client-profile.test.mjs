import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STRIPE_CATALOG } from "../workers/checkout/catalog.js";
import { SERVICE_LADDERS as serverLadders } from "../workers/billing/service-plan.js";
import {
  businessPayload,
  emailChangeRequest,
  interestSelection,
  personalPayload,
  serviceChangeRequest
} from "./account-profile.js";
import { SERVICE_LADDERS, SERVICE_OFFERS } from "./service-offers.js";

const sql = readFileSync(new URL("../supabase/migrations/20261002040000_client_profile_services.sql", import.meta.url), "utf8");
const portal = readFileSync(new URL("./client-portal.js", import.meta.url), "utf8");
const auth = readFileSync(new URL("./pulse-auth.js", import.meta.url), "utf8");
const staff = readFileSync(new URL("../staff-workspace.html", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin-portal.html", import.meta.url), "utf8");
const offers = readFileSync(new URL("./service-offers.js", import.meta.url), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? undefined : to);
}

test("every account type can edit personal fields, and email follows Auth", () => {
  const payload = personalPayload({
    first_name: "Ada",
    last_name: "Lovelace",
    phone: "555",
    timezone: "America/New_York",
    email_reports: "on",
    email_billing: "off",
    email_support: "on",
    role: "admin",
    is_active: false,
    job_title: "Analyst",
    department: "Insights",
    started_on: "2026-01-01",
    ended_on: "2026-02-01",
    email: "ada@example.com"
  });
  assert.equal(payload.first_name, "Ada");
  assert.equal(payload.last_name, "Lovelace");
  assert.equal(payload.phone, "555");
  assert.equal(payload.timezone, "America/New_York");
  assert.equal(payload.notification_preferences.email_reports, true);
  assert.equal(payload.notification_preferences.email_billing, false);
  assert.equal(Object.hasOwn(payload, "role"), false);
  assert.equal(Object.hasOwn(payload, "job_title"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
  assert.equal(emailChangeRequest("Ada@Example.com").email, "ada@example.com");
  assert.match(auth, /updateUser\(\{ email:/);
  assert.match(portal, /updateEmail\(/);
  assert.match(sql, /sync_profile_email_from_auth/);
  assert.match(sql, /NEW\.email IS DISTINCT FROM auth_email/);
  assert.match(staff, /data-tab="account"/);
  assert.match(admin, /id="nav-account"/);
});

test("employment fields stay administrator controlled", () => {
  assert.match(sql, /NEW\.job_title := OLD\.job_title/);
  assert.match(sql, /NEW\.department := OLD\.department/);
  assert.match(sql, /NEW\.started_on := OLD\.started_on/);
  assert.match(sql, /NEW\.ended_on := OLD\.ended_on/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS ended_on date/);
  assert.doesNotMatch(portal, /name="job_title"|name="ended_on"|name="started_on"/);
  const employees = readFileSync(new URL("./admin-employees.js", import.meta.url), "utf8");
  assert.match(employees, /name="job_title"/);
  assert.match(employees, /name="ended_on"/);
});

test("clients edit their own business fields and cannot write protected ones", () => {
  const payload = businessPayload({
    name: "Northwind",
    website: "https://northwind.example",
    industry: "retail",
    status: "active",
    stripe_customer_id: "cus_fake",
    onboarding_step: 1,
    billing_email: "bill@example.com",
    notes: "internal",
    account_manager_id: "someone"
  });
  assert.equal(payload.name, "Northwind");
  assert.equal(Object.hasOwn(payload, "status"), false);
  assert.equal(Object.hasOwn(payload, "stripe_customer_id"), false);
  assert.equal(Object.hasOwn(payload, "notes"), false);
  assert.match(sql, /USING \(public\.is_admin\(\) OR public\.is_client_owner\(id\)\)/);
  assert.doesNotMatch(between(sql, "CREATE POLICY clients_update", "CREATE OR REPLACE FUNCTION private.guard_client_owner_fields"), /is_staff_for_client/);
  assert.match(sql, /NEW\.status := OLD\.status/);
  assert.match(sql, /NEW\.stripe_customer_id := OLD\.stripe_customer_id/);
  assert.match(sql, /NEW\.onboarding_step := OLD\.onboarding_step/);
  assert.match(portal, /\.from\("clients"\)\.update\(payload\)/);
});

test("service interests and market focus stay on the owner's client and do not change billing", () => {
  assert.deepEqual(interestSelection(["seo", "seo"], "seo"), [{ slug: "seo", is_primary: true }]);
  const interests = between(sql, "CREATE OR REPLACE FUNCTION public.save_client_service_interests", "CREATE OR REPLACE FUNCTION public.save_client_market_focus");
  assert.match(interests, /public\.is_admin\(\) OR public\.is_client_owner\(p_client_id\)/);
  assert.match(interests, /client_service_interests/);
  assert.doesNotMatch(interests, /client_subscriptions|client_invoices|projects|NEW\.status/);
  const markets = between(sql, "CREATE OR REPLACE FUNCTION public.save_client_market_focus", "REVOKE ALL ON FUNCTION public.save_client_service_interests");
  assert.match(markets, /client_market_focus/);
  assert.match(markets, /public\.is_client_owner\(p_client_id\)/);
  assert.match(sql, /client_service_interests_write/);
  assert.match(sql, /client_market_focus_write/);
  assert.match(portal, /save_client_service_interests/);
  assert.match(portal, /save_client_market_focus/);
  assert.match(portal, /They do not purchase a service/);
});

test("active services stay separate and use the billing service-change route", () => {
  const change = serviceChangeRequest({ action: "upgrade", catalogId: "seo-pro", subscriptionId: "sub_current" });
  assert.equal(change.catalogId, "seo-pro");
  assert.equal(Object.hasOwn(change, "priceId"), false);
  assert.match(portal, /\/api\/billing\/service-change/);
  assert.match(portal, /Stripe confirms each change/);
  assert.doesNotMatch(portal, /from\("client_subscriptions"\)\.update|from\("client_invoices"\)\.update|from\("client_subscriptions"\)\.insert/);
  assert.deepEqual(SERVICE_LADDERS, serverLadders);
  for (const offer of SERVICE_OFFERS) assert.equal(Boolean(STRIPE_CATALOG[offer.id]), true);
  assert.doesNotMatch(offers, /price_|sk_|service_role/);
});
