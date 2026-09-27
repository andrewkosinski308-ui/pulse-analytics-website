import { serviceSlugForPriceId } from "../checkout/service-map.js";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

export function stripeProjectName(clientName, serviceNames) {
  const client = String(clientName || "").trim() || "Client";
  const names = [...new Set(serviceNames.map((name) => String(name || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return `${client} — ${names.join(" + ")}`;
}

export function priceIdFromLineItem(item) {
  const price = item?.price;
  if (typeof price === "string") return price;
  if (price && typeof price.id === "string") return price.id;
  return "";
}

/**
 * Decide whether a Checkout Session is a new paid purchase.
 * invoice.paid is never passed here. Renewals do not emit checkout.session.completed.
 */
export function planStripeCheckoutProject({ session, lineItems, services, clientName }) {
  if (!session || session.object !== "checkout.session") {
    return { create: false, reason: "not-checkout-session" };
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { create: false, reason: "unpaid" };
  }
  if (!SESSION_ID.test(session.id || "")) {
    return { create: false, reason: "missing-session" };
  }
  const clientId = session.metadata?.client_id || "";
  if (!CLIENT_ID.test(clientId)) {
    return { create: false, reason: "anonymous" };
  }

  const priceIds = (lineItems || []).map(priceIdFromLineItem);
  if (!priceIds.length || priceIds.some((priceId) => !priceId)) {
    return { create: false, reason: "missing-price" };
  }
  const uniquePrices = [...new Set(priceIds)];
  const slugs = uniquePrices.map((priceId) => serviceSlugForPriceId(priceId));
  if (slugs.some((slug) => !slug)) {
    return { create: false, reason: "unmapped-price" };
  }

  const bySlug = new Map((services || []).map((service) => [service.slug, service]));
  if (slugs.some((slug) => !bySlug.get(slug)?.id)) {
    return { create: false, reason: "unknown-service" };
  }
  const chosen = [...new Map(slugs.map((slug) => {
    const service = bySlug.get(slug);
    return [service.id, service];
  })).values()].sort((left, right) => left.name.localeCompare(right.name));

  const projectName = stripeProjectName(clientName, chosen.map((service) => service.name));
  const summary = `Purchased ${chosen.map((service) => service.name).join(", ")}.`;
  if (/cs_|price_|prod_/.test(`${projectName} ${summary}`)) {
    return { create: false, reason: "unsafe-name" };
  }

  return {
    create: true,
    clientId,
    sessionId: session.id,
    priceIds: uniquePrices,
    serviceIds: chosen.map((service) => service.id),
    projectName,
    summary,
    billing: session.mode === "subscription" ? "recurring" : "one_time"
  };
}

function serviceKey(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || key.length < 20 || key === env?.SUPABASE_ANON_KEY) return "";
  return key;
}

function restHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra
  };
}

function stripeCustomerId(value) {
  if (typeof value === "string" && value.startsWith("cus_")) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.startsWith("cus_")) return value.id;
  return "";
}

async function stripeGet(secret, path, fetchImpl) {
  const response = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": "2025-03-31.basil"
    }
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function readClient(env, clientId, fetchImpl, key) {
  const response = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=id,name,stripe_customer_id`,
    { headers: restHeaders(key) }
  );
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) return { retry: true };
  return { client: rows[0] || null };
}

/**
 * Link a verified Checkout Session customer to the server-set client id.
 * Does not create a project.
 */
export async function linkCheckoutCustomer(env, session, fetchImpl) {
  const key = serviceKey(env);
  const clientId = session?.metadata?.client_id || "";
  const customerId = stripeCustomerId(session?.customer);
  if (!key || !env?.SUPABASE_URL || !CLIENT_ID.test(clientId) || !customerId) {
    return { linked: false };
  }
  if (session.payment_status !== "paid") return { linked: false };

  const current = await readClient(env, clientId, fetchImpl, key);
  if (current.retry) return { retry: true };
  if (!current.client) return { linked: false, reason: "unknown-client" };
  if (current.client.stripe_customer_id && current.client.stripe_customer_id !== customerId) {
    return { linked: false, reason: "customer-mismatch" };
  }

  const ownerRes = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/clients?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id`,
    { headers: restHeaders(key) }
  );
  const owners = await ownerRes.json().catch(() => null);
  if (!ownerRes.ok || !Array.isArray(owners)) return { retry: true };
  if (owners.some((row) => row.id && row.id !== clientId)) {
    return { linked: false, reason: "customer-mismatch" };
  }
  if (current.client.stripe_customer_id === customerId) return { linked: true, client: current.client };

  const saved = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&stripe_customer_id=is.null`,
    {
      method: "PATCH",
      headers: restHeaders(key, { Prefer: "return=representation" }),
      body: JSON.stringify({ stripe_customer_id: customerId })
    }
  );
  if (!saved.ok) return { retry: true };
  return { linked: true, client: { ...current.client, stripe_customer_id: customerId } };
}

export async function maybeCreateProjectFromCheckout(env, secret, session, fetchImpl) {
  if (!session || session.object !== "checkout.session" || session.status !== "complete" || session.payment_status !== "paid") {
    return { created: false, reason: "unpaid" };
  }
  if (!SESSION_ID.test(session.id || "")) return { created: false, reason: "missing-session" };
  if (!CLIENT_ID.test(session.metadata?.client_id || "")) return { created: false, reason: "anonymous" };

  const key = serviceKey(env);
  if (!key || !env?.SUPABASE_URL || !secret) return { retry: true };

  const loaded = await readClient(env, session.metadata.client_id, fetchImpl, key);
  if (loaded.retry) return { retry: true };
  if (!loaded.client) return { created: false, reason: "unknown-client" };

  const customerId = stripeCustomerId(session.customer);
  if (loaded.client.stripe_customer_id && customerId && loaded.client.stripe_customer_id !== customerId) {
    return { created: false, reason: "customer-mismatch" };
  }

  const lineResult = await stripeGet(
    secret,
    `/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`,
    fetchImpl
  );
  if (!lineResult.response.ok || !Array.isArray(lineResult.payload?.data)) {
    return { retry: true };
  }

  const slugs = [...new Set(lineResult.payload.data.map((item) => serviceSlugForPriceId(priceIdFromLineItem(item))).filter(Boolean))];
  const serviceRes = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/services?select=id,name,slug${slugs.length ? `&slug=in.(${slugs.join(",")})` : ""}`,
    { headers: restHeaders(key) }
  );
  const services = await serviceRes.json().catch(() => null);
  if (!serviceRes.ok || !Array.isArray(services)) return { retry: true };

  const plan = planStripeCheckoutProject({
    session,
    lineItems: lineResult.payload.data,
    services,
    clientName: loaded.client.name
  });
  if (!plan.create) return { created: false, reason: plan.reason };

  const rpc = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/rpc/create_project_from_stripe_checkout`,
    {
      method: "POST",
      headers: restHeaders(key),
      body: JSON.stringify({
        p_client_id: plan.clientId,
        p_session_id: plan.sessionId,
        p_service_ids: plan.serviceIds,
        p_price_ids: plan.priceIds,
        p_project_name: plan.projectName,
        p_summary: plan.summary,
        p_billing: plan.billing
      })
    }
  );
  if (!rpc.ok) return { retry: true };
  const projectId = await rpc.json().catch(() => null);
  if (typeof projectId !== "string" || !projectId) return { retry: true };
  return { created: true, projectId, sessionId: plan.sessionId };
}
