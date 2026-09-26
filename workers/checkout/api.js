import { resolveCheckoutItems } from "./catalog.js";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";
const STRIPE_VERSION = "2025-03-31.basil";
const CUSTOMER_ERROR = "We couldn't start checkout. Please try again or contact Pulse Analytics.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function publishableKey(env) {
  const key = env?.STRIPE_PUBLISHABLE_KEY;
  if (typeof key !== "string" || !key.startsWith("pk_")) return "";
  return key;
}

function secretKey(env) {
  const key = env?.STRIPE_SECRET_KEY;
  if (typeof key !== "string" || !key.startsWith("sk_")) return "";
  return key;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

/**
 * @param {string} returnUrl
 * @param {"payment" | "subscription"} mode
 * @param {{ priceId: string, quantity: number }[]} lineItems
 */
export function checkoutSessionBody(returnUrl, mode, lineItems) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("ui_mode", "embedded");
  params.set("return_url", returnUrl);
  params.set("billing_address_collection", "required");
  params.set("automatic_tax[enabled]", "true");
  params.set("tax_id_collection[enabled]", "true");
  params.set("name_collection[individual][enabled]", "true");
  if (mode === "payment") {
    params.set("customer_creation", "always");
    params.set("saved_payment_method_options[payment_method_save]", "enabled");
  }
  lineItems.forEach((item, index) => {
    params.set(`line_items[${index}][price]`, item.priceId);
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });
  return params;
}

/**
 * @param {string} secret
 * @param {URLSearchParams} params
 * @param {typeof fetch} fetchImpl
 */
export async function createStripeCheckoutSession(secret, params, fetchImpl = fetch) {
  const response = await fetchImpl(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION
    },
    body: params
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.client_secret) {
    console.error("Stripe checkout session was not created", {
      status: response.status,
      type: payload?.error?.type || "",
      code: payload?.error?.code || ""
    });
    return { ok: false, status: 502, error: CUSTOMER_ERROR };
  }
  return { ok: true, clientSecret: payload.client_secret };
}

/**
 * @param {string} secret
 * @param {string} sessionId
 * @param {typeof fetch} fetchImpl
 */
export async function readStripeCheckoutSession(secret, sessionId, fetchImpl = fetch) {
  const response = await fetchImpl(`${STRIPE_API}/${encodeURIComponent(sessionId)}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_VERSION
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    console.error("Stripe checkout session could not be read", {
      status: response.status,
      type: payload?.error?.type || "",
      code: payload?.error?.code || ""
    });
    return { ok: false, status: 502, error: "We couldn't confirm this payment. Please contact Pulse Analytics if you were charged." };
  }
  return {
    ok: true,
    complete: payload.status === "complete",
    status: payload.status
  };
}

export async function handleCheckoutRequest(request, env, fetchImpl = fetch) {
  if (!sameOrigin(request)) {
    return json({ error: CUSTOMER_ERROR }, 403);
  }

  const url = new URL(request.url);
  const secret = secretKey(env);
  const publishable = publishableKey(env);

  if (request.method === "GET" && url.pathname === "/api/checkout/session") {
    const sessionId = url.searchParams.get("session_id") || "";
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return json({ error: "We couldn't confirm this payment." }, 400);
    }
    if (!secret) return json({ error: CUSTOMER_ERROR }, 503);
    try {
      const result = await readStripeCheckoutSession(secret, sessionId, fetchImpl);
      if (!result.ok) return json({ error: result.error }, result.status);
      return json({ complete: result.complete, status: result.status });
    } catch (error) {
      console.error("Stripe checkout confirmation failed", error instanceof Error ? error.name : "Error");
      return json({ error: "We couldn't confirm this payment. Please contact Pulse Analytics if you were charged." }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/checkout/session") {
    if (!secret || !publishable) return json({ error: CUSTOMER_ERROR }, 503);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Please review your cart and try again." }, 400);
    }
    const resolved = resolveCheckoutItems(body?.items);
    if (!resolved.ok) return json({ error: resolved.error }, resolved.status);

    const returnUrl = `${url.origin}/cart/checkout.html?session_id={CHECKOUT_SESSION_ID}`;
    const params = checkoutSessionBody(returnUrl, resolved.mode, resolved.lineItems);
    try {
      const created = await createStripeCheckoutSession(secret, params, fetchImpl);
      if (!created.ok) return json({ error: created.error }, created.status);
      return json({
        clientSecret: created.clientSecret,
        publishableKey: publishable
      });
    } catch (error) {
      console.error("Stripe checkout request failed", error instanceof Error ? error.name : "Error");
      return json({ error: CUSTOMER_ERROR }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
}
