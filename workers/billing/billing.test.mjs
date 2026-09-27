import assert from "node:assert/strict";
import test from "node:test";
import { handleBillingRequest, verifyStripeSignature } from "./api.js";
import { assertAllowedFile, sanitizeFileName } from "../../js/file-rules.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-not-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value-not-real",
  STRIPE_SECRET_KEY: "sk_test_billing_only",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_WEBHOOK_SECRET_TEST: "whsec_test_sandbox_only"
};

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

function webhookHandlingFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || "GET", body: options.body || "" });
    if (href.includes("/rest/v1/client_members")) {
      return new Response(JSON.stringify([{ profile_id: "11111111-1111-4111-8111-111111111111" }]), { status: 200 });
    }
    if (href.includes("/rest/v1/clients?")) {
      return new Response(JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222" }]), { status: 200 });
    }
    if (href.includes("api.stripe.com")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (href.includes("/rest/v1/notifications")) {
      return new Response("[]", { status: 201 });
    }
    return new Response("[]", { status: 200 });
  };
  return { calls, fetchImpl };
}

test("billing summary rejects a missing session", async () => {
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/summary"),
    env
  );
  assert.equal(response.status, 401);
});

test("billing summary does not trust a browser customer id", async () => {
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/summary?customer=cus_other", {
      headers: { Authorization: "Bearer user-jwt", Origin: "https://pulseanalyticsgroupllc.com" }
    }),
    env,
    async (url) => {
      const href = String(url);
      if (href.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" }), { status: 200 });
      }
      if (href.includes("/client_members")) {
        return new Response(JSON.stringify([{ client_id: "22222222-2222-4222-8222-222222222222", member_role: "owner", created_at: "2026-01-01" }]), { status: 200 });
      }
      if (href.includes("/clients?")) {
        return new Response(JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222", name: "Acme", stripe_customer_id: "cus_mapped" }]), { status: 200 });
      }
      if (href.includes("/subscriptions?")) {
        assert.ok(href.includes("customer=cus_mapped"));
        assert.equal(href.includes("cus_other"), false);
        return new Response(JSON.stringify({ data: [{ id: "sub_1", status: "active", items: { data: [{ price: { id: "price_1", product: { name: "SEO Growth" } } }] }, current_period_end: 1800000000, cancel_at_period_end: false }] }), { status: 200 });
      }
      if (href.includes("/invoices?")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (href.includes("/client_subscriptions")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subscriptions[0].productName, "SEO Growth");
  assert.equal(body.customerId, undefined);
});

function summaryFetch({ stripeStatus = 200, invoices = [], stripeInvoices = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({
      href,
      method: options.method || "GET",
      authorization: options.headers?.Authorization || "",
      apikey: options.headers?.apikey || ""
    });
    if (href.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" }), { status: 200 });
    }
    if (href.includes("/client_members")) {
      return new Response(JSON.stringify([{ client_id: "22222222-2222-4222-8222-222222222222", member_role: "owner", created_at: "2026-01-01" }]), { status: 200 });
    }
    if (href.includes("/rest/v1/clients?")) {
      return new Response(JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222", name: "Portal Test Co", stripe_customer_id: "cus_sandbox" }]), { status: 200 });
    }
    if (href.includes("api.stripe.com/v1/customers")) {
      return new Response(JSON.stringify({ id: "cus_should_not_be_created" }), { status: 200 });
    }
    if (href.includes("api.stripe.com/v1/subscriptions") || href.includes("api.stripe.com/v1/invoices")) {
      return new Response(JSON.stringify({ data: stripeInvoices, error: { code: "resource_missing" } }), { status: stripeStatus });
    }
    if (href.includes("/rest/v1/client_invoices")) {
      return new Response(JSON.stringify(invoices), { status: 200 });
    }
    if (href.includes("/client_subscriptions")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  return { calls, fetchImpl };
}

test("billing summary uses synchronized invoices when Stripe cannot read the customer", async () => {
  const { calls, fetchImpl } = summaryFetch({
    stripeStatus: 404,
    invoices: [
      {
        client_id: "22222222-2222-4222-8222-222222222222",
        stripe_invoice_id: "in_synced",
        status: "paid",
        amount_due: 100,
        amount_paid: 100,
        currency: "usd",
        hosted_invoice_url: null,
        invoice_pdf: null,
        period_start: "2026-09-26T22:00:00.000Z",
        period_end: "2026-09-26T22:00:00.000Z",
        created_at: "2026-09-26T22:01:00.000Z"
      },
      {
        client_id: "33333333-3333-4333-8333-333333333333",
        stripe_invoice_id: "in_other_client",
        status: "paid",
        amount_due: 500,
        amount_paid: 500,
        currency: "usd",
        created_at: "2026-09-26T22:02:00.000Z"
      }
    ]
  });
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/summary", {
      headers: { Authorization: "Bearer user-jwt", Origin: "https://pulseanalyticsgroupllc.com" }
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clientName, "Portal Test Co");
  assert.deepEqual(body.subscriptions, []);
  assert.equal(body.invoices.length, 1);
  assert.equal(body.invoices[0].id, "in_synced");
  assert.equal(body.invoices[0].status, "paid");
  assert.equal(body.invoices[0].amountPaid, 100);
  assert.equal(body.invoices[0].amountDue, 100);
  assert.equal(body.invoices[0].currency, "usd");
  assert.equal(body.invoices[0].createdAt, "2026-09-26T22:01:00.000Z");
  const stored = calls.find((call) => call.href.includes("/rest/v1/client_invoices"));
  assert.equal(stored.authorization, "Bearer user-jwt");
  assert.equal(stored.apikey, env.SUPABASE_ANON_KEY);
  assert.equal(stored.href.includes("client_id=eq.22222222-2222-4222-8222-222222222222"), true);
  assert.equal(calls.some((call) => call.href.includes("/v1/customers")), false);
});

test("billing summary keeps the Stripe error when no synchronized invoices exist", async () => {
  const { fetchImpl } = summaryFetch({ stripeStatus: 404, invoices: [] });
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/summary", {
      headers: { Authorization: "Bearer user-jwt", Origin: "https://pulseanalyticsgroupllc.com" }
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Billing details could not be loaded." });
});

test("billing summary prefers Stripe invoices when the Stripe read succeeds", async () => {
  const { calls, fetchImpl } = summaryFetch({
    stripeStatus: 200,
    stripeInvoices: [{ id: "in_live", status: "paid", amount_due: 2500, amount_paid: 2500, currency: "usd", created: 1790460000 }],
    invoices: [{ client_id: "22222222-2222-4222-8222-222222222222", stripe_invoice_id: "in_stored_only", status: "paid", amount_due: 100, amount_paid: 100, currency: "usd", created_at: "2026-09-26T22:01:00.000Z" }]
  });
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/summary", {
      headers: { Authorization: "Bearer user-jwt", Origin: "https://pulseanalyticsgroupllc.com" }
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.invoices[0].id, "in_live");
  assert.equal(body.invoices.some((row) => row.id === "in_stored_only"), false);
  assert.equal(calls.some((call) => call.method === "GET" && call.href.includes("/rest/v1/client_invoices")), false);
});

test("viewer cannot open the Stripe billing portal", async () => {
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/billing/portal", {
      method: "POST",
      headers: { Authorization: "Bearer user-jwt", Origin: "https://pulseanalyticsgroupllc.com" }
    }),
    env,
    async (url) => {
      const href = String(url);
      if (href.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 });
      if (href.includes("/client_members")) {
        return new Response(JSON.stringify([{ client_id: "22222222-2222-4222-8222-222222222222", member_role: "viewer", created_at: "2026-01-01" }]), { status: 200 });
      }
      if (href.includes("/clients?")) {
        return new Response(JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222", name: "Acme", stripe_customer_id: "cus_mapped" }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }
  );
  assert.equal(response.status, 403);
});

test("webhook rejects a bad signature", async () => {
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: "{}"
    }),
    env
  );
  assert.equal(response.status, 400);
});

test("webhook accepts a valid signature", async () => {
  const raw = JSON.stringify({ type: "invoice.paid", data: { object: { customer: "cus_mapped" } } });
  const header = await signStripePayload(raw, env.STRIPE_WEBHOOK_SECRET);
  const ok = await verifyStripeSignature(raw, header, env.STRIPE_WEBHOOK_SECRET);
  assert.equal(ok, true);
});

test("webhook accepts a production signature and continues handling", async () => {
  const raw = JSON.stringify({ id: "evt_test_live", type: "invoice.paid", data: { object: { customer: "cus_mapped" } } });
  const { calls, fetchImpl } = webhookHandlingFetch();
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, env.STRIPE_WEBHOOK_SECRET) },
      body: raw
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(calls.some((call) => call.href.includes("stripe_customer_id=eq.cus_mapped")), true);
  assert.equal(calls.some((call) => call.href.includes("/subscriptions?customer=cus_mapped")), true);
  assert.equal(calls.some((call) => call.href.includes("/invoices?customer=cus_mapped")), true);
  const notification = calls.find((call) => call.href.includes("/rest/v1/notifications"));
  assert.equal(notification?.method, "POST");
  assert.equal(JSON.parse(notification.body)[0].title, "Invoice paid");
  assert.equal(calls.some((call) => call.href.includes("create_project_from_stripe_checkout")), false);
});

test("webhook accepts a sandbox signature and continues handling", async () => {
  const raw = JSON.stringify({ id: "evt_test_sandbox", type: "invoice.paid", data: { object: { customer: "cus_mapped" } } });
  const { calls, fetchImpl } = webhookHandlingFetch();
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, env.STRIPE_WEBHOOK_SECRET_TEST) },
      body: raw
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(calls.some((call) => call.href.includes("stripe_customer_id=eq.cus_mapped")), true);
  assert.equal(calls.some((call) => call.href.includes("/subscriptions?customer=cus_mapped")), true);
  const notification = calls.find((call) => call.href.includes("/rest/v1/notifications"));
  assert.equal(notification?.method, "POST");
  assert.equal(JSON.parse(notification.body)[0].title, "Invoice paid");
});

test("webhook records the paid invoice when the Stripe list cannot be read", async () => {
  const raw = JSON.stringify({
    id: "evt_test_invoice_payload",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_payload",
        object: "invoice",
        customer: "cus_mapped",
        status: "paid",
        amount_due: 100,
        amount_paid: 100,
        currency: "usd"
      }
    }
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || "GET", body: options.body || "" });
    if (href.includes("api.stripe.com")) return new Response(JSON.stringify({ error: { message: "missing" } }), { status: 404 });
    if (href.includes("/rest/v1/clients?")) return new Response(JSON.stringify([{ id: "client-1" }]));
    if (href.includes("/rest/v1/client_members?")) return new Response(JSON.stringify([{ profile_id: "profile-1" }]));
    return new Response("[]", { status: 201 });
  };
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, env.STRIPE_WEBHOOK_SECRET_TEST) },
      body: raw
    }),
    env,
    fetchImpl
  );
  assert.equal(response.status, 200);
  const invoiceWrite = calls.find((call) => call.method === "POST" && call.href.includes("/rest/v1/client_invoices"));
  assert.equal(invoiceWrite != null, true);
  const row = JSON.parse(invoiceWrite.body);
  assert.equal(row.stripe_invoice_id, "in_test_payload");
  assert.equal(row.status, "paid");
  assert.equal(row.amount_paid, 100);
  assert.equal(row.client_id, "client-1");
  const notification = calls.find((call) => call.href.includes("/rest/v1/notifications"));
  assert.equal(JSON.parse(notification.body)[0].title, "Invoice paid");
});

test("webhook rejects a signature that matches neither secret", async () => {
  const raw = JSON.stringify({ id: "evt_test_bad", type: "invoice.paid", data: { object: { customer: "cus_mapped" } } });
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, "whsec_test_matches_neither") },
      body: raw
    }),
    env
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid signature." });
});

test("webhook returns 503 when both signing secrets are missing", async () => {
  const bare = { ...env };
  delete bare.STRIPE_WEBHOOK_SECRET;
  delete bare.STRIPE_WEBHOOK_SECRET_TEST;
  const raw = JSON.stringify({ type: "invoice.paid", data: { object: { customer: "cus_mapped" } } });
  const response = await handleBillingRequest(
    new Request("https://pulseanalyticsgroupllc.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await signStripePayload(raw, "whsec_test_secret") },
      body: raw
    }),
    bare
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Webhook is not configured." });
});

test("file rules reject path names, bad types, and oversized files", () => {
  assert.equal(sanitizeFileName("../secret.pdf"), "secret.pdf");
  assert.throws(() => assertAllowedFile({ name: "virus.exe", type: "application/x-msdownload", size: 10 }));
  assert.throws(() => assertAllowedFile({ name: "big.pdf", type: "application/pdf", size: 52428801 }));
  const ok = assertAllowedFile({ name: "report.pdf", type: "application/pdf", size: 1200 });
  assert.equal(ok.safeName, "report.pdf");
  assert.equal(ok.mime, "application/pdf");
});
