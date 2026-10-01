import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STRIPE_CATALOG } from "../checkout/catalog.js";
import { handleBillingRequest } from "./api.js";
import { planServiceChange, SERVICE_LADDERS } from "./service-plan.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-not-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value-not-real",
  STRIPE_SECRET_KEY: "sk_test_billing_only"
};

const ownerId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";

function request(body) {
  return new Request("https://pulseanalyticsgroupllc.com/api/billing/service-change", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-jwt",
      Origin: "https://pulseanalyticsgroupllc.com",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function portalFetch({ role = "client", memberRole = "owner", stripe = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || "GET", body: options.body || "" });
    if (href.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: ownerId, email: "owner@example.com" }), { status: 200 });
    if (href.includes("/client_members")) {
      return new Response(JSON.stringify([{ client_id: clientId, member_role: memberRole, created_at: "2026-01-01" }]), { status: 200 });
    }
    if (href.includes("/clients?")) {
      return new Response(JSON.stringify([{ id: clientId, name: "Acme", stripe_customer_id: "cus_owner" }]), { status: 200 });
    }
    if (href.includes("/profiles?")) return new Response(JSON.stringify([{ role }]), { status: 200 });
    if (href.includes("/subscriptions/sub_current") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({
        id: "sub_current",
        customer: "cus_owner",
        items: { data: [{ id: "si_current", price: { id: STRIPE_CATALOG["seo-growth"].priceId } }] }
      }), { status: 200 });
    }
    if (href.includes("api.stripe.com")) return new Response(JSON.stringify(stripe), { status: 200 });
    return new Response("[]", { status: 200 });
  };
  return { calls, fetchImpl };
}

test("an upgrade moves up the same plan ladder and ignores a browser price", () => {
  const planned = planServiceChange({ action: "upgrade", catalogId: "seo-pro", currentCatalogId: "seo-growth" });
  assert.equal(planned.kind, "subscription");
  assert.equal(planned.priceId, STRIPE_CATALOG["seo-pro"].priceId);
  assert.equal(planServiceChange({ action: "downgrade", catalogId: "seo-startup", currentCatalogId: "seo-growth" }).kind, "subscription");
  assert.equal(planServiceChange({ action: "upgrade", catalogId: "seo-startup", currentCatalogId: "seo-growth" }).error, "Choose a higher plan to upgrade.");
  assert.equal(planServiceChange({ action: "upgrade", catalogId: "ai-pro", currentCatalogId: "seo-growth" }).error, "That service change is not available.");
  assert.equal(planServiceChange({ action: "add", catalogId: "website-startup" }).kind, "checkout");
  assert.deepEqual(Object.values(SERVICE_LADDERS).flat().every((id) => STRIPE_CATALOG[id]), true);
});

test("a client owner upgrade is sent to Stripe and does not write billing tables", async () => {
  const { calls, fetchImpl } = portalFetch({ stripe: { id: "sub_current", status: "active" } });
  const response = await handleBillingRequest(request({
    action: "upgrade",
    catalogId: "seo-pro",
    subscriptionId: "sub_current",
    priceId: "price_fake"
  }), env, fetchImpl);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pending, true);
  assert.equal(JSON.stringify(body).includes("sk_"), false);
  const stripeWrite = calls.find((call) => call.method === "POST" && call.href.includes("/subscriptions/sub_current"));
  assert.match(stripeWrite.body, new RegExp(STRIPE_CATALOG["seo-pro"].priceId));
  assert.equal(stripeWrite.body.includes("price_fake"), false);
  assert.equal(calls.some((call) => call.href.includes("/client_subscriptions") || call.href.includes("/client_invoices")), false);
});

test("adding a service starts checkout and does not mark it active", async () => {
  const { calls, fetchImpl } = portalFetch({ stripe: { url: "https://checkout.stripe.com/c/pay/cs_test_portal" } });
  const response = await handleBillingRequest(request({ action: "add", catalogId: "seo-startup" }), env, fetchImpl);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.url, "https://checkout.stripe.com/c/pay/cs_test_portal");
  assert.equal(calls.some((call) => call.href.includes("/checkout/sessions")), true);
  assert.equal(calls.some((call) => call.href.includes("/client_subscriptions")), false);
});

test("employees and other clients cannot change services", async () => {
  const employee = portalFetch({ role: "employee" });
  const denied = await handleBillingRequest(request({ action: "add", catalogId: "seo-startup" }), env, employee.fetchImpl);
  assert.equal(denied.status, 403);
  assert.equal(employee.calls.some((call) => call.href.includes("api.stripe.com")), false);

  const viewer = portalFetch({ memberRole: "viewer" });
  const viewerDenied = await handleBillingRequest(request({ action: "remove", subscriptionId: "sub_current" }), env, viewer.fetchImpl);
  assert.equal(viewerDenied.status, 403);
});

test("service change source does not expose Stripe secrets", () => {
  const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/billing\/service-change/);
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY\s*=\s*["']sk_/);
});
