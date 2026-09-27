import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { filterProjects } from "../../js/project-filters.js";
import { projectGroup, projectStatusLabel } from "../../js/project-status.js";
import { handleBillingRequest } from "./api.js";
import { planStripeCheckoutProject, stripeProjectName } from "./purchase-project.js";
import { unmappedCatalogIds } from "../checkout/service-map.js";

const CLIENT = "22222222-2222-4222-8222-222222222222";
const SEO = "59e4b073-4b0e-42b4-893c-2a78c531e98e";
const ADS = "bf5c5a87-a3ef-4965-b913-169c4c0dc111";
const SEO_PRICE = "price_1UJrK6FPF2SIqMND1EIRsqqE";
const ADS_PRICE = "price_1UJrK3FPF2SIqMNDv2f8EACe";
const SERVICES = [
  { id: SEO, name: "Search Engine Optimization", slug: "seo" },
  { id: ADS, name: "Google Ads Management", slug: "google-ads" }
];

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-not-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value-not-real",
  STRIPE_SECRET_KEY: "sk_test_billing_only",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_WEBHOOK_SECRET_TEST: "whsec_test_sandbox_only"
};

function session(overrides = {}) {
  return {
    id: "cs_test_purchase_1",
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    customer: "cus_mapped",
    metadata: { client_id: CLIENT },
    ...overrides
  };
}

test("project status labels and open/closed groups", () => {
  assert.equal(projectStatusLabel("planned"), "Planning");
  assert.equal(projectStatusLabel("active"), "In Progress");
  assert.equal(projectStatusLabel("on_hold"), "On Hold");
  assert.equal(projectStatusLabel("completed"), "Completed");
  assert.equal(projectStatusLabel("cancelled"), "Cancelled");
  assert.equal(projectGroup("planned"), "open");
  assert.equal(projectGroup("active"), "open");
  assert.equal(projectGroup("on_hold"), "open");
  assert.equal(projectGroup("completed"), "closed");
  assert.equal(projectGroup("cancelled"), "closed");
});

test("project filters keep history available and honor service, date, and search", () => {
  const projects = [
    { id: "1", client_id: "c1", clientName: "Portal Test Co", name: "Portal Test Co — Search Engine Optimization", status: "planned", starts_on: "2026-09-01", services: [{ id: SEO, name: "Search Engine Optimization" }] },
    { id: "2", client_id: "c1", clientName: "Portal Test Co", name: "Completed site", status: "completed", starts_on: "2026-08-01", services: [{ id: "web", name: "Website Design & Development" }] },
    { id: "3", client_id: "c1", clientName: "Portal Test Co", name: "Cancelled ads", status: "cancelled", starts_on: "2026-07-01", services: [{ id: ADS, name: "Google Ads Management" }] },
    { id: "4", client_id: "c2", clientName: "Other Co", name: "Other work", status: "active", starts_on: "2026-09-02", services: [{ id: SEO, name: "Search Engine Optimization" }] }
  ];
  assert.deepEqual(filterProjects(projects, { group: "open" }).map((row) => row.id), ["1", "4"]);
  assert.deepEqual(filterProjects(projects, { group: "closed" }).map((row) => row.id), ["2", "3"]);
  assert.deepEqual(filterProjects(projects, { clientId: "c1", group: "all" }).map((row) => row.id), ["1", "2", "3"]);
  assert.deepEqual(filterProjects(projects, { serviceId: SEO }).map((row) => row.id), ["1", "4"]);
  assert.deepEqual(filterProjects(projects, { from: "2026-09-01", to: "2026-09-30" }).map((row) => row.id), ["1", "4"]);
  assert.deepEqual(filterProjects(projects, { search: "cancelled ads" }).map((row) => row.id), ["3"]);
});

test("every catalog price maps to a service slug and names stay deterministic", () => {
  assert.deepEqual(unmappedCatalogIds(), []);
  assert.equal(
    stripeProjectName("Portal Test Co", ["Search Engine Optimization", "Google Ads Management"]),
    "Portal Test Co — Google Ads Management + Search Engine Optimization"
  );
});

test("a paid checkout with several prices becomes one planned purchase", () => {
  const plan = planStripeCheckoutProject({
    session: session(),
    lineItems: [{ price: { id: ADS_PRICE } }, { price: { id: SEO_PRICE } }, { price: { id: SEO_PRICE } }],
    services: SERVICES,
    clientName: "Portal Test Co"
  });
  assert.equal(plan.create, true);
  assert.deepEqual(plan.serviceIds, [ADS, SEO]);
  assert.deepEqual(plan.priceIds, [ADS_PRICE, SEO_PRICE]);
  assert.equal(plan.projectName, "Portal Test Co — Google Ads Management + Search Engine Optimization");
  assert.equal(/cs_|price_|prod_/.test(`${plan.projectName} ${plan.summary}`), false);
});

test("anonymous, unpaid, and unmapped checkouts do not plan a project", () => {
  assert.equal(planStripeCheckoutProject({
    session: session({ metadata: {} }),
    lineItems: [{ price: { id: SEO_PRICE } }],
    services: SERVICES,
    clientName: "Portal Test Co"
  }).reason, "anonymous");
  assert.equal(planStripeCheckoutProject({
    session: session({ payment_status: "unpaid" }),
    lineItems: [{ price: { id: SEO_PRICE } }],
    services: SERVICES,
    clientName: "Portal Test Co"
  }).reason, "unpaid");
  assert.equal(planStripeCheckoutProject({
    session: session(),
    lineItems: [{ price: { id: "price_unmapped_test" } }],
    services: SERVICES,
    clientName: "Portal Test Co"
  }).reason, "unmapped-price");
  assert.equal(planStripeCheckoutProject({
    session: { object: "invoice", id: "in_renewal", payment_status: "paid", metadata: { client_id: CLIENT } },
    lineItems: [{ price: { id: SEO_PRICE } }],
    services: SERVICES,
    clientName: "Portal Test Co"
  }).reason, "not-checkout-session");
});

async function signStripePayload(raw, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

function purchaseFetch(options = {}) {
  const purchases = new Map();
  const calls = [];
  const client = {
    id: CLIENT,
    name: "Portal Test Co",
    stripe_customer_id: options.customerId === undefined ? "cus_mapped" : options.customerId
  };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, method: init.method || "GET", body: init.body || "" });
    if (href.includes("/checkout/sessions/") && href.includes("/line_items")) {
      return new Response(JSON.stringify({ data: options.lineItems || [{ price: { id: SEO_PRICE } }] }), { status: 200 });
    }
    if (href.includes("api.stripe.com")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (href.includes("/rest/v1/services")) return new Response(JSON.stringify(SERVICES), { status: 200 });
    if (href.includes("/rest/v1/rpc/create_project_from_stripe_checkout")) {
      const body = JSON.parse(init.body);
      if (!purchases.has(body.p_session_id)) purchases.set(body.p_session_id, `project-${purchases.size + 1}`);
      return new Response(JSON.stringify(purchases.get(body.p_session_id)), { status: 200 });
    }
    if (href.includes("/rest/v1/clients?") && href.includes("id=eq.")) {
      return new Response(JSON.stringify(options.missingClient ? [] : [client]), { status: 200 });
    }
    if (href.includes("/rest/v1/clients?") && href.includes("stripe_customer_id=eq.")) {
      if (options.foreignCustomer) return new Response(JSON.stringify([{ id: "33333333-3333-4333-8333-333333333333" }]), { status: 200 });
      if (client.stripe_customer_id && href.includes(encodeURIComponent(client.stripe_customer_id))) {
        return new Response(JSON.stringify([{ id: client.id }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }
    if (href.includes("/rest/v1/clients?") && init.method === "PATCH") {
      client.stripe_customer_id = JSON.parse(init.body).stripe_customer_id;
      return new Response(JSON.stringify([client]), { status: 200 });
    }
    if (href.includes("/rest/v1/client_members")) return new Response(JSON.stringify([{ profile_id: "profile-1" }]), { status: 200 });
    if (href.includes("/rest/v1/notifications")) return new Response("[]", { status: 201 });
    if (href.includes("/rest/v1/clients?")) return new Response(JSON.stringify([{ id: client.id }]), { status: 200 });
    return new Response("[]", { status: 200 });
  };
  return { calls, purchases, fetchImpl };
}

async function postWebhook(raw, fetchImpl) {
  return handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, env.STRIPE_WEBHOOK_SECRET) },
      body: raw
    }),
    env,
    fetchImpl
  );
}

test("checkout completion creates one project and a second delivery does not", async () => {
  const raw = JSON.stringify({
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: { object: session() }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const first = await postWebhook(raw, fetchImpl);
  const second = await postWebhook(raw, fetchImpl);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(purchases.size, 1);
  const writes = calls.filter((call) => call.href.includes("create_project_from_stripe_checkout"));
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[0].body).p_session_id, "cs_test_purchase_1");
  assert.equal(JSON.parse(writes[0].body).p_billing, "one_time");
  assert.equal(JSON.parse(writes[1].body).p_session_id, "cs_test_purchase_1");
  assert.deepEqual(JSON.parse(writes[0].body).p_service_ids, [SEO]);
  assert.equal(JSON.parse(writes[0].body).p_project_name.includes("price_"), false);
});

test("a multi-price checkout attaches every mapped service", async () => {
  const raw = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: session({ id: "cs_test_purchase_multi" }) }
  });
  const { calls, fetchImpl } = purchaseFetch({
    lineItems: [{ price: { id: SEO_PRICE } }, { price: { id: ADS_PRICE } }]
  });
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  const write = calls.find((call) => call.href.includes("create_project_from_stripe_checkout"));
  const body = JSON.parse(write.body);
  assert.deepEqual(body.p_service_ids, [ADS, SEO]);
  assert.deepEqual(body.p_price_ids, [SEO_PRICE, ADS_PRICE]);
});

test("an unmapped price does not create a project", async () => {
  const raw = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: session({ id: "cs_test_unmapped" }) }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch({
    lineItems: [{ price: { id: "price_unmapped_test" } }]
  });
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 0);
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
});

test("an anonymous checkout does not create a project", async () => {
  const raw = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: session({ id: "cs_test_anon", metadata: {}, customer: "cus_public" }) }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 0);
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
});

test("a customer owned by another client does not create a project", async () => {
  const raw = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: session({ id: "cs_test_mismatch", customer: "cus_other" }) }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch({ foreignCustomer: true, customerId: "cus_mapped" });
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 0);
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
});

test("a renewal invoice still notifies and does not create a project", async () => {
  const raw = JSON.stringify({
    id: "evt_renewal",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_renewal",
        object: "invoice",
        customer: "cus_mapped",
        status: "paid",
        billing_reason: "subscription_cycle",
        amount_due: 100,
        amount_paid: 100,
        currency: "usd"
      }
    }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 0);
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
  const notification = calls.find((call) => call.href.includes("/rest/v1/notifications"));
  assert.equal(JSON.parse(notification.body)[0].title, "Invoice paid");
  assert.equal(calls.some((call) => call.href.includes("/subscriptions?customer=cus_mapped")), true);
});

test("an unpaid or failed checkout does not reconcile the account to active", async () => {
  for (const paymentStatus of ["unpaid", "no_payment_required"]) {
    const raw = JSON.stringify({
      id: `evt_${paymentStatus}`,
      type: "checkout.session.completed",
      data: { object: session({ id: `cs_test_${paymentStatus}`, status: "complete", payment_status: paymentStatus }) }
    });
    const { calls, purchases, fetchImpl } = purchaseFetch();
    const response = await postWebhook(raw, fetchImpl);
    assert.equal(response.status, 200);
    assert.equal(purchases.size, 0);
    assert.equal(calls.some((call) => call.href.includes("sync_client_engagement_status")), false);
    assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
  }
});

test("a paid recurring checkout records the subscription and reconciles the same account", async () => {
  const raw = JSON.stringify({
    id: "evt_subscription",
    type: "checkout.session.completed",
    data: {
      object: session({
        id: "cs_test_subscription",
        mode: "subscription",
        subscription: "sub_test_engagement"
      })
    }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 1);
  const project = calls.find((call) => call.href.includes("create_project_from_stripe_checkout"));
  assert.equal(JSON.parse(project.body).p_billing, "recurring");
  const subscription = calls.find((call) => call.method === "POST" && call.href.includes("/rest/v1/client_subscriptions"));
  assert.equal(JSON.parse(subscription.body).status, "active");
  assert.equal(JSON.parse(subscription.body).stripe_subscription_id, "sub_test_engagement");
  assert.equal(calls.some((call) => call.href.includes("sync_client_engagement_status")), true);
});

test("a repeated stripe event does not create a second project", async () => {
  let claims = 0;
  const raw = JSON.stringify({
    id: "evt_checkout_once",
    type: "checkout.session.completed",
    data: { object: session({ id: "cs_test_once" }) }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const wrapped = async (url, init) => {
    if (String(url).includes("claim_stripe_event")) {
      claims += 1;
      return new Response(claims === 1 ? "true" : "false", {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return fetchImpl(url, init);
  };
  const first = await postWebhook(raw, wrapped);
  const second = await postWebhook(raw, wrapped);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(purchases.size, 1);
  assert.equal(calls.filter((call) => call.href.includes("create_project_from_stripe_checkout")).length, 1);
  assert.equal(calls.filter((call) => call.href.includes("sync_client_engagement_status")).length, 1);
});

test("a renewal invoice reconciles the engagement and does not open another project", async () => {
  const raw = JSON.stringify({
    id: "evt_cycle",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_cycle",
        object: "invoice",
        customer: "cus_mapped",
        status: "paid",
        billing_reason: "subscription_cycle",
        amount_due: 100,
        amount_paid: 100,
        currency: "usd"
      }
    }
  });
  const { calls, purchases, fetchImpl } = purchaseFetch();
  const response = await postWebhook(raw, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(purchases.size, 0);
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
  assert.equal(calls.some((call) => call.href.includes("sync_client_engagement_status")), true);
});

test("the purchase migration enforces one project per checkout session", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260927021500_project_purchases.sql", import.meta.url), "utf8");
  assert.equal(sql.includes("UNIQUE (stripe_checkout_session_id)"), true);
  assert.equal(sql.includes("WHEN unique_violation"), true);
  assert.equal(sql.includes("'planned'"), true);
  assert.equal(sql.includes("GRANT SELECT, INSERT ON public.projects TO service_role"), true);
  assert.equal(sql.includes("FROM authenticated"), true);
  assert.equal(sql.includes("invoice.paid"), false);
});
