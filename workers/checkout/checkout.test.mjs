import assert from "node:assert/strict";
import test from "node:test";
import { checkoutSessionBody, handleCheckoutRequest } from "./api.js";
import { resolveCheckoutItems, STRIPE_CATALOG } from "./catalog.js";

const EXPECTED = {
  "seo-startup": ["prod_VKSmByA4W7xMiU", "price_1UJrK6FPF2SIqMND1EIRsqqE", "monthly"],
  "google-ads-growth": ["prod_VKTcOkG3TaKsDJ", "price_1UJrK5FPF2SIqMND66d3VyaH", "monthly"],
  "google-ads-scale": ["prod_VKTkQ14Burij4l", "price_1UJrK4FPF2SIqMNDowTWvqyM", "monthly"],
  "google-ads-starter": ["prod_VKTY8vs7Zovs2A", "price_1UJrK3FPF2SIqMNDv2f8EACe", "monthly"],
  "seo-pro": ["prod_VKSw0rW1uIOMdY", "price_1UJrK0FPF2SIqMNDZktUhfDN", "monthly"],
  "ai-starter": ["prod_VKTnNm1wx9ROhH", "price_1UJrK2FPF2SIqMNDU6HW1G8p", "monthly"],
  "google-ads-pro": ["prod_VKThGJN7CUC2cs", "price_1UJrK0FPF2SIqMND1beRlIckK", "monthly"],
  "ai-pro": ["prod_VKTszOQlI28WGP", "price_1UJrJzFPF2SIqMND4P3cRYBe", "monthly"],
  "social-media-growth": ["prod_VKVpepMVGc8PY6", "price_1UJrJzFPF2SIqMNDQxKGWbJF", "monthly"],
  "social-profile-setup": ["prod_VKVjjbUW9dQ9AF", "price_1UJrJzFPF2SIqMNDSiL5vXBo", "one_time"],
  "website-professional": ["prod_VKU42OwoDblgBn", "price_1UJrJzFPF2SIqMNDIcaPYqPY", "one_time"],
  "ai-growth": ["prod_VKTp16O1x4YDih", "price_1UJrJzFPF2SIqMNDhlr7POuE", "monthly"],
  "website-startup": ["prod_VKTxF5FV6GZHAy", "price_1UJrJzFPF2SIqMND6LJHBZHd", "one_time"],
  "social-media-professional": ["prod_VKVsIEQ105fB2S", "price_1UJrJyFPF2SIqMNDEowaiNY8", "monthly"],
  "social-media-starter": ["prod_VKVmHxCF2onTDL", "price_1UJrJzFPF2SIqMNDSDy54phO", "monthly"],
  "ecommerce-basic": ["prod_VKU8ggRszdaZui", "price_1UJrJxFPF2SIqMNDpXjL8GPE", "one_time"],
  "website-business": ["prod_VKU0sqFMgcf7H2", "price_1UJrJzFPF2SIqMNDNknqoROO", "one_time"],
  "seo-growth": ["prod_VKSrhlYPRVawnl", "price_1UJrK1FPF2SIqMND4Q5DQE7Y", "monthly"]
};

const SECRET = "sk_test_catalog_only_not_a_real_key";
const PUBLISHABLE = "pk_test_catalog_only_not_a_real_key";

test("catalog contains the 18 approved Stripe products", () => {
  assert.equal(Object.keys(STRIPE_CATALOG).length, 18);
  for (const [id, [productId, priceId, billing]] of Object.entries(EXPECTED)) {
    assert.equal(STRIPE_CATALOG[id].productId, productId);
    assert.equal(STRIPE_CATALOG[id].priceId, priceId);
    assert.equal(STRIPE_CATALOG[id].billing, billing);
  }
});

test("one-time carts use payment mode and ignore client prices", () => {
  const resolved = resolveCheckoutItems([
    { id: "website-startup", quantity: 1, price: 1, priceId: "price_fake", name: "Wrong" }
  ]);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.mode, "payment");
  assert.deepEqual(resolved.lineItems, [
    { priceId: EXPECTED["website-startup"][1], quantity: 1, billing: "one_time" }
  ]);
});

test("recurring carts use subscription mode", () => {
  const resolved = resolveCheckoutItems([
    { id: "social-media-growth", quantity: 2 }
  ]);
  assert.equal(resolved.mode, "subscription");
  assert.equal(resolved.lineItems[0].priceId, EXPECTED["social-media-growth"][1]);
  assert.equal(resolved.lineItems[0].quantity, 2);
});

test("mixed carts use one subscription session", () => {
  const resolved = resolveCheckoutItems([
    { id: "website-startup", quantity: 1 },
    { id: "social-media-growth", quantity: 1 }
  ]);
  assert.equal(resolved.mode, "subscription");
  assert.equal(resolved.lineItems.length, 2);
  assert.equal(resolved.lineItems.some((item) => item.billing === "one_time"), true);
  assert.equal(resolved.lineItems.some((item) => item.billing === "monthly"), true);
});

test("duplicate cart ids are merged and unknown products are rejected", () => {
  const merged = resolveCheckoutItems([
    { id: "seo-startup", quantity: 1 },
    { id: "seo-startup", quantity: 2 }
  ]);
  assert.equal(merged.lineItems.length, 1);
  assert.equal(merged.lineItems[0].quantity, 3);

  for (const items of [
    [],
    [{ id: "additional-pages", quantity: 1 }],
    [{ id: "seo-startup", quantity: 0 }],
    [{ id: "price_1UJrK6FPF2SIqMND1EIRsqqE", quantity: 1 }],
    [{ id: "not-a-product", quantity: 1 }]
  ]) {
    assert.equal(resolveCheckoutItems(items).ok, false);
  }
});

test("session request uses Stripe price ids and does not return the secret", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ id: "cs_test_123", client_secret: "cs_test_123_secret" }), { status: 200 });
  };
  const request = new Request("https://pulseanalyticsgroupllc.com/api/checkout/session", {
    method: "POST",
    headers: { Origin: "https://pulseanalyticsgroupllc.com", "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { id: "website-startup", quantity: 1, price: 699 },
        { id: "social-media-starter", quantity: 1, price: 399 }
      ]
    })
  });
  const response = await handleCheckoutRequest(request, {
    STRIPE_SECRET_KEY: SECRET,
    STRIPE_PUBLISHABLE_KEY: PUBLISHABLE
  }, fetchImpl);
  const body = await response.json();
  const text = JSON.stringify(body);
  assert.equal(response.status, 200);
  assert.equal(body.publishableKey, PUBLISHABLE);
  assert.equal(body.clientSecret, "cs_test_123_secret");
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("sk_"), false);
  const params = new URLSearchParams(captured.options.body);
  assert.equal(params.get("mode"), "subscription");
  assert.equal(params.get("ui_mode"), "embedded");
  assert.equal(params.get("line_items[0][price]"), EXPECTED["website-startup"][1]);
  assert.equal(params.get("line_items[1][price]"), EXPECTED["social-media-starter"][1]);
  assert.equal(params.get("automatic_tax[enabled]"), "true");
  assert.equal(params.has("customer_creation"), false);
  assert.equal(params.get("return_url").includes("{CHECKOUT_SESSION_ID}"), true);
  assert.equal(captured.options.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(params.has("line_items[0][price_data][unit_amount]"), false);
});

test("payment-only carts create a customer and do not call Stripe when configuration is missing", async () => {
  const params = checkoutSessionBody("https://pulseanalyticsgroupllc.com/cart/checkout.html?session_id={CHECKOUT_SESSION_ID}", "payment", [
    { priceId: EXPECTED["website-business"][1], quantity: 1 }
  ]);
  assert.equal(params.get("mode"), "payment");
  assert.equal(params.get("customer_creation"), "always");

  let called = false;
  const request = new Request("https://pulseanalyticsgroupllc.com/api/checkout/session", {
    method: "POST",
    headers: { Origin: "https://pulseanalyticsgroupllc.com" },
    body: JSON.stringify({ items: [{ id: "website-business", quantity: 1 }] })
  });
  const response = await handleCheckoutRequest(request, {}, async () => {
    called = true;
    return new Response("{}", { status: 500 });
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.equal(JSON.stringify(body).includes("sk_"), false);
  assert.match(body.error, /couldn't start checkout/i);
});

test("completed sessions are confirmed without returning the Stripe session payload", async () => {
  const request = new Request("https://pulseanalyticsgroupllc.com/api/checkout/session?session_id=cs_test_complete", {
    headers: { Origin: "https://pulseanalyticsgroupllc.com" }
  });
  const response = await handleCheckoutRequest(request, { STRIPE_SECRET_KEY: SECRET }, async () => {
    return new Response(JSON.stringify({
      id: "cs_test_complete",
      status: "complete",
      customer_email: "private@example.com",
      client_secret: "cs_test_complete_secret"
    }), { status: 200 });
  });
  const body = await response.json();
  assert.deepEqual(body, { complete: true, status: "complete" });
});
