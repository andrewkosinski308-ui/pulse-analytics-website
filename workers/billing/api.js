import { shouldReconcileEngagement } from "./client-lifecycle.js";
import { linkCheckoutCustomer, maybeCreateProjectFromCheckout } from "./purchase-project.js";
import { resolveCheckoutItems } from "../checkout/catalog.js";
import { catalogIdForPrice, planServiceChange } from "./service-plan.js";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2025-03-31.basil";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function secretKey(env) {
  const key = env?.STRIPE_SECRET_KEY;
  if (typeof key !== "string" || !(key.startsWith("sk_") || key.startsWith("rk_"))) return "";
  return key;
}

function serviceKey(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || key.length < 20) return "";
  if (key === env?.SUPABASE_ANON_KEY) return "";
  return key;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

async function stripeForm(secret, path, params, method, fetchImpl) {
  const response = await fetchImpl(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION
    },
    body: params ? params.toString() : undefined
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function stripeGet(secret, path, fetchImpl) {
  const response = await fetchImpl(`${STRIPE_API}${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_VERSION
    }
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function restHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra
  };
}

async function supabaseUser(env, jwt, fetchImpl) {
  const response = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) return null;
  return payload;
}

async function memberContext(env, jwt, userId, fetchImpl) {
  const membersUrl = new URL(`${env.SUPABASE_URL}/rest/v1/client_members`);
  membersUrl.searchParams.set("profile_id", `eq.${userId}`);
  membersUrl.searchParams.set("select", "client_id,member_role,created_at");
  membersUrl.searchParams.set("order", "created_at.asc");
  membersUrl.searchParams.set("limit", "1");
  const members = await fetchImpl(membersUrl, {
    headers: restHeaders(env.SUPABASE_ANON_KEY, { Authorization: `Bearer ${jwt}` })
  });
  const rows = await members.json().catch(() => null);
  const membership = Array.isArray(rows) ? rows[0] : null;
  if (!members.ok || !membership?.client_id) return null;

  const clientUrl = new URL(`${env.SUPABASE_URL}/rest/v1/clients`);
  clientUrl.searchParams.set("id", `eq.${membership.client_id}`);
  clientUrl.searchParams.set("select", "id,name,stripe_customer_id");
  const clientRes = await fetchImpl(clientUrl, {
    headers: restHeaders(env.SUPABASE_ANON_KEY, { Authorization: `Bearer ${jwt}` })
  });
  const clients = await clientRes.json().catch(() => null);
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!clientRes.ok || !client?.id) return null;
  return { membership, client, userId };
}

async function ensureCustomer(env, secret, context, email, fetchImpl) {
  if (context.client.stripe_customer_id) return context.client.stripe_customer_id;
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (context.client.name) params.set("name", context.client.name);
  params.set("metadata[client_id]", context.client.id);
  const created = await stripeForm(secret, "/customers", params, "POST", fetchImpl);
  const customerId = created.payload?.id;
  if (!created.response.ok || !customerId) {
    console.error("Stripe customer was not created", {
      status: created.response.status,
      code: created.payload?.error?.code || ""
    });
    return "";
  }
  const saved = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/clients?id=eq.${context.client.id}&stripe_customer_id=is.null`,
    {
      method: "PATCH",
      headers: restHeaders(serviceKey(env), { Prefer: "return=representation" }),
      body: JSON.stringify({ stripe_customer_id: customerId })
    }
  );
  const savedRows = await saved.json().catch(() => null);
  if (Array.isArray(savedRows) && savedRows[0]?.stripe_customer_id) {
    return savedRows[0].stripe_customer_id;
  }
  const reread = await memberContext(env, context.jwt, context.userId, fetchImpl);
  return reread?.client?.stripe_customer_id || customerId;
}

function productName(item) {
  const product = item?.price?.product;
  if (product && typeof product === "object") return product.name || item.price?.nickname || null;
  return item?.price?.nickname || null;
}

async function syncCustomer(env, secret, clientId, customerId, fetchImpl) {
  const subs = await stripeGet(
    secret,
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20&expand[]=data.items.data.price.product`,
    fetchImpl
  );
  const invoices = await stripeGet(
    secret,
    `/invoices?customer=${encodeURIComponent(customerId)}&limit=24`,
    fetchImpl
  );
  if (!subs.response.ok || !invoices.response.ok) {
    console.error("Stripe billing read failed", {
      subscriptions: subs.response.status,
      invoices: invoices.response.status
    });
    return null;
  }
  const service = serviceKey(env);
  const subscriptionRows = (subs.payload?.data || []).map((sub) => {
    const item = sub.items?.data?.[0];
    return {
      client_id: clientId,
      stripe_subscription_id: sub.id,
      status: sub.status || "unknown",
      product_name: productName(item),
      price_id: item?.price?.id || null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      updated_at: new Date().toISOString()
    };
  });
  const invoiceRows = (invoices.payload?.data || []).map((invoice) => invoiceRow(clientId, invoice)).filter(Boolean);

  if (subscriptionRows.length) {
    await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/client_subscriptions?on_conflict=stripe_subscription_id`,
      {
        method: "POST",
        headers: restHeaders(service, { Prefer: "resolution=merge-duplicates" }),
        body: JSON.stringify(subscriptionRows)
      }
    );
  }
  if (invoiceRows.length) {
    await fetchImpl(`${env.SUPABASE_URL}/rest/v1/client_invoices?on_conflict=stripe_invoice_id`, {
      method: "POST",
      headers: restHeaders(service, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(invoiceRows)
    });
  }

  const seen = subscriptionRows.map((row) => row.stripe_subscription_id);
  const existingRes = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/client_subscriptions?client_id=eq.${clientId}&select=stripe_subscription_id,status`,
    { headers: restHeaders(service) }
  );
  const existing = await existingRes.json().catch(() => []);
  const stale = (Array.isArray(existing) ? existing : [])
    .map((row) => row.stripe_subscription_id)
    .filter((id) => id && !seen.includes(id));
  if (stale.length) {
    await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/client_subscriptions?stripe_subscription_id=in.(${stale.join(",")})`,
      {
        method: "PATCH",
        headers: restHeaders(service),
        body: JSON.stringify({ status: "canceled", updated_at: new Date().toISOString() })
      }
    );
  }

  return {
    subscriptions: subscriptionRows.map((row) => ({
      id: row.stripe_subscription_id,
      status: row.status,
      productName: row.product_name,
      priceId: row.price_id,
      catalogId: catalogIdForPrice(row.price_id),
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end
    })),
    invoices: invoiceRows.map((row) => ({
      id: row.stripe_invoice_id,
      status: row.status,
      amountDue: row.amount_due,
      amountPaid: row.amount_paid,
      currency: row.currency,
      hostedInvoiceUrl: row.hosted_invoice_url,
      invoicePdf: row.invoice_pdf,
      createdAt: row.created_at
    }))
  };
}

async function authorizedClient(request, env, fetchImpl) {
  if (!sameOrigin(request)) return { error: json({ error: "Billing could not be opened from this page." }, 403) };
  const jwt = bearer(request);
  if (!jwt || !env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY || !serviceKey(env) || !secretKey(env)) {
    return { error: json({ error: "Billing is not available right now." }, jwt ? 503 : 401) };
  }
  const user = await supabaseUser(env, jwt, fetchImpl);
  if (!user?.id) return { error: json({ error: "Sign in again to view billing." }, 401) };
  const context = await memberContext(env, jwt, user.id, fetchImpl);
  if (!context) return { error: json({ error: "No client account is linked to this login." }, 403) };
  context.jwt = jwt;
  context.email = user.email || "";
  return { context };
}

function storedInvoiceView(row) {
  return {
    id: row.stripe_invoice_id,
    status: row.status,
    amountDue: row.amount_due,
    amountPaid: row.amount_paid,
    currency: row.currency,
    hostedInvoiceUrl: row.hosted_invoice_url,
    invoicePdf: row.invoice_pdf,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at
  };
}

async function storedInvoices(env, context, fetchImpl) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/client_invoices`);
  url.searchParams.set("client_id", `eq.${context.client.id}`);
  url.searchParams.set(
    "select",
    "client_id,stripe_invoice_id,status,amount_due,amount_paid,currency,hosted_invoice_url,invoice_pdf,period_start,period_end,created_at"
  );
  url.searchParams.set("order", "created_at.desc");
  const response = await fetchImpl(url, {
    headers: restHeaders(env.SUPABASE_ANON_KEY, { Authorization: `Bearer ${context.jwt}` })
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) return null;
  return rows
    .filter((row) => row?.client_id === context.client.id && row.stripe_invoice_id)
    .map(storedInvoiceView);
}

export async function handleBillingSummary(request, env, fetchImpl = fetch) {
  const auth = await authorizedClient(request, env, fetchImpl);
  if (auth.error) return auth.error;
  const customerId = await ensureCustomer(env, secretKey(env), auth.context, auth.context.email, fetchImpl);
  if (!customerId) return json({ error: "Billing could not be linked to this client." }, 502);
  const synced = await syncCustomer(env, secretKey(env), auth.context.client.id, customerId, fetchImpl);
  if (synced) {
    return json({
      clientName: auth.context.client.name,
      memberRole: auth.context.membership.member_role,
      subscriptions: synced.subscriptions,
      invoices: synced.invoices
    });
  }
  const invoices = await storedInvoices(env, auth.context, fetchImpl);
  if (!invoices?.length) return json({ error: "Billing details could not be loaded." }, 502);
  return json({
    clientName: auth.context.client.name,
    memberRole: auth.context.membership.member_role,
    subscriptions: [],
    invoices
  });
}

export async function handleBillingPortal(request, env, fetchImpl = fetch) {
  const auth = await authorizedClient(request, env, fetchImpl);
  if (auth.error) return auth.error;
  if (auth.context.membership.member_role !== "owner") {
    return json({ error: "Only the client owner can open billing management." }, 403);
  }
  const customerId = await ensureCustomer(env, secretKey(env), auth.context, auth.context.email, fetchImpl);
  if (!customerId) return json({ error: "Billing could not be linked to this client." }, 502);
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", `${new URL(request.url).origin}/client-portal.html#billing`);
  const session = await stripeForm(secretKey(env), "/billing_portal/sessions", params, "POST", fetchImpl);
  if (!session.response.ok || !session.payload?.url) {
    console.error("Stripe billing portal session was not created", {
      status: session.response.status,
      code: session.payload?.error?.code || ""
    });
    return json({ error: "Stripe billing management is not available for this account yet." }, 502);
  }
  return json({ url: session.payload.url });
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find((part) => part[0] === "t")?.[1];
  const signatures = parts.filter((part) => part[0] === "v1").map((part) => part[1]);
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => safeEqual(signature, hex));
}

function invoiceRow(clientId, invoice) {
  if (!invoice?.id) return null;
  return {
    client_id: clientId,
    stripe_invoice_id: invoice.id,
    status: invoice.status || null,
    amount_due: Number.isFinite(invoice.amount_due) ? invoice.amount_due : null,
    amount_paid: Number.isFinite(invoice.amount_paid) ? invoice.amount_paid : null,
    currency: invoice.currency || null,
    hosted_invoice_url: invoice.hosted_invoice_url || null,
    invoice_pdf: invoice.invoice_pdf || null,
    period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    created_at: invoice.created ? new Date(invoice.created * 1000).toISOString() : new Date().toISOString()
  };
}

async function upsertEventInvoice(env, clientId, invoice, fetchImpl) {
  const row = invoiceRow(clientId, invoice);
  if (!row) return;
  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/client_invoices?on_conflict=stripe_invoice_id`, {
    method: "POST",
    headers: restHeaders(serviceKey(env), { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(row)
  });
}

async function notifyBilling(env, clientId, title, body, fetchImpl) {
  const membersRes = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/client_members?client_id=eq.${clientId}&select=profile_id`,
    { headers: restHeaders(serviceKey(env)) }
  );
  const members = await membersRes.json().catch(() => []);
  if (!Array.isArray(members) || !members.length) return;
  const rows = members.map((member) => ({
    recipient_id: member.profile_id,
    title,
    body,
    type: "system",
    link_path: "client-portal.html#billing",
    entity_type: "billing",
    entity_id: clientId
  }));
  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST",
    headers: restHeaders(serviceKey(env)),
    body: JSON.stringify(rows)
  });
}

function configuredWebhookSecrets(env) {
  return [env?.STRIPE_WEBHOOK_SECRET, env?.STRIPE_WEBHOOK_SECRET_TEST].filter(
    (value) => typeof value === "string" && value.length > 0
  );
}

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/;

async function claimStripeEvent(env, eventId, eventType, fetchImpl) {
  if (!EVENT_ID.test(eventId || "")) return { duplicate: false, retry: false };
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/claim_stripe_event`, {
    method: "POST",
    headers: restHeaders(serviceKey(env)),
    body: JSON.stringify({ p_event_id: eventId, p_event_type: eventType || "unknown" })
  });
  if (!response.ok) return { duplicate: false, retry: true };
  const body = await response.json().catch(() => null);
  return { duplicate: body === false, retry: false };
}

async function releaseStripeEvent(env, eventId, fetchImpl) {
  if (!EVENT_ID.test(eventId || "")) return;
  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/stripe_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: restHeaders(serviceKey(env))
  });
}

async function rememberPaidSubscription(env, session, clientId, fetchImpl) {
  if (session?.mode !== "subscription" || session.payment_status !== "paid") return { ok: true, recorded: false };
  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id || "";
  if (!subscriptionId.startsWith("sub_") || !CLIENT_ID.test(clientId || "")) return { ok: true, recorded: false };
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/client_subscriptions?on_conflict=stripe_subscription_id`, {
    method: "POST",
    headers: restHeaders(serviceKey(env), { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({
      client_id: clientId,
      stripe_subscription_id: subscriptionId,
      status: "active",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString()
    })
  });
  return { ok: response.ok, recorded: response.ok };
}

async function syncEngagementStatus(env, clientId, fetchImpl) {
  if (!CLIENT_ID.test(clientId || "")) return false;
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/sync_client_engagement_status`, {
    method: "POST",
    headers: restHeaders(serviceKey(env)),
    body: JSON.stringify({ p_client_id: clientId })
  });
  return response.ok;
}

export async function handleStripeWebhook(request, env, fetchImpl = fetch) {
  const secrets = configuredWebhookSecrets(env);
  const stripeSecret = secretKey(env);
  if (!secrets.length || !stripeSecret || !serviceKey(env) || !env?.SUPABASE_URL) {
    return json({ error: "Webhook is not configured." }, 503);
  }
  const raw = await request.text();
  const header = request.headers.get("stripe-signature") || "";
  let valid = false;
  for (const secret of secrets) {
    if (await verifyStripeSignature(raw, header, secret)) {
      valid = true;
      break;
    }
  }
  if (!valid) return json({ error: "Invalid signature." }, 400);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid payload." }, 400);
  }
  const object = event.data?.object || {};
  const claim = await claimStripeEvent(env, event.id, event.type, fetchImpl);
  if (claim.duplicate) return json({ received: true });
  if (claim.retry) return json({ error: "Purchase could not be recorded." }, 500);
  const retry = async () => {
    await releaseStripeEvent(env, event.id, fetchImpl);
    return json({ error: "Purchase could not be recorded." }, 500);
  };

  if (event.type === "checkout.session.completed") {
    const linked = await linkCheckoutCustomer(env, object, fetchImpl);
    if (linked.retry) return retry();
  }
  const customerId = object.customer || (event.type?.startsWith("customer.") ? object.id : "");
  let linkedClientId = "";
  if (!customerId && event.type !== "checkout.session.completed") return json({ received: true });
  if (customerId) {
    const clientRes = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/clients?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id`,
      { headers: restHeaders(serviceKey(env)) }
    );
    const clients = await clientRes.json().catch(() => []);
    const client = Array.isArray(clients) ? clients[0] : null;
    if (client?.id) {
      linkedClientId = client.id;
      await syncCustomer(env, stripeSecret, client.id, customerId, fetchImpl);
      if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
        await upsertEventInvoice(env, client.id, object, fetchImpl);
      }
      if (event.type === "invoice.paid") {
        await notifyBilling(env, client.id, "Invoice paid", "A Stripe invoice was paid.", fetchImpl);
      } else if (event.type === "invoice.payment_failed") {
        await notifyBilling(env, client.id, "Payment failed", "Stripe reported a failed invoice payment.", fetchImpl);
      }
    }
  }

  let projectCreated = false;
  let subscriptionRecorded = false;
  const metadataClientId = CLIENT_ID.test(object.metadata?.client_id || "") ? object.metadata.client_id : "";
  if (event.type === "checkout.session.completed") {
    const subscription = await rememberPaidSubscription(env, object, metadataClientId || linkedClientId, fetchImpl);
    if (!subscription.ok) return retry();
    subscriptionRecorded = subscription.recorded;
    const project = await maybeCreateProjectFromCheckout(env, stripeSecret, object, fetchImpl);
    if (project.retry) return retry();
    projectCreated = project.created === true;
  }

  const engagementClientId = metadataClientId || linkedClientId;
  if (shouldReconcileEngagement({ eventType: event.type, projectCreated, subscriptionRecorded }) && CLIENT_ID.test(engagementClientId)) {
    const synced = await syncEngagementStatus(env, engagementClientId, fetchImpl);
    if (!synced) return retry();
  }
  return json({ received: true });
}

async function clientRole(env, jwt, userId, fetchImpl) {
  const response = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role`,
    { headers: restHeaders(env.SUPABASE_ANON_KEY, { Authorization: `Bearer ${jwt}` }) }
  );
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) ? rows[0]?.role || "" : "";
}

export async function handleServiceChange(request, env, fetchImpl = fetch) {
  const auth = await authorizedClient(request, env, fetchImpl);
  if (auth.error) return auth.error;
  if (auth.context.membership.member_role !== "owner") {
    return json({ error: "You do not have permission to perform this action." }, 403);
  }
  const role = await clientRole(env, auth.context.jwt, auth.context.userId, fetchImpl);
  if (role !== "client") return json({ error: "You do not have permission to perform this action." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "That service change is not available." }, 400);
  }
  const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId : "";
  if (body?.action !== "add" && !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
    return json({ error: "Choose an active service." }, 400);
  }

  let currentCatalogId = "";
  let stripeSubscription = null;
  if (body?.action !== "add") {
    const loaded = await stripeGet(secretKey(env), `/subscriptions/${encodeURIComponent(subscriptionId)}`, fetchImpl);
    stripeSubscription = loaded.payload;
    const customer = typeof stripeSubscription?.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription?.customer?.id;
    if (!loaded.response.ok || customer !== auth.context.client.stripe_customer_id) {
      return json({ error: "That service could not be changed." }, 403);
    }
    currentCatalogId = catalogIdForPrice(stripeSubscription?.items?.data?.[0]?.price?.id || "");
  }

  const planned = planServiceChange({
    action: body?.action,
    catalogId: typeof body?.catalogId === "string" ? body.catalogId : "",
    currentCatalogId
  });
  if (planned.error) return json({ error: planned.error }, 400);

  const secret = secretKey(env);
  if (planned.kind === "checkout") {
    const resolved = resolveCheckoutItems([{ id: planned.catalogId, quantity: 1 }]);
    if (!resolved.ok) return json({ error: resolved.error }, resolved.status);
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set("mode", resolved.mode);
    params.set("success_url", `${origin}/client-portal.html#billing`);
    params.set("cancel_url", `${origin}/client-portal.html#billing`);
    params.set("metadata[client_id]", auth.context.client.id);
    if (auth.context.client.stripe_customer_id) params.set("customer", auth.context.client.stripe_customer_id);
    resolved.lineItems.forEach((item, index) => {
      params.set(`line_items[${index}][price]`, item.priceId);
      params.set(`line_items[${index}][quantity]`, String(item.quantity));
    });
    const created = await stripeForm(secret, "/checkout/sessions", params, "POST", fetchImpl);
    if (!created.response.ok || !created.payload?.url) {
      return json({ error: "Checkout could not be started. Please try again." }, 502);
    }
    return json({ ok: true, url: created.payload.url });
  }

  if (planned.kind === "cancel") {
    const params = new URLSearchParams();
    params.set("cancel_at_period_end", "true");
    const canceled = await stripeForm(secret, `/subscriptions/${encodeURIComponent(subscriptionId)}`, params, "POST", fetchImpl);
    if (!canceled.response.ok) return json({ error: "That service could not be changed. Please try again." }, 502);
    return json({ ok: true, pending: true });
  }

  const itemId = stripeSubscription?.items?.data?.[0]?.id;
  if (!itemId) return json({ error: "That service could not be changed." }, 409);
  const params = new URLSearchParams();
  params.set("items[0][id]", itemId);
  params.set("items[0][price]", planned.priceId);
  params.set("proration_behavior", "create_prorations");
  const updated = await stripeForm(secret, `/subscriptions/${encodeURIComponent(subscriptionId)}`, params, "POST", fetchImpl);
  if (!updated.response.ok) return json({ error: "That service could not be changed. Please try again." }, 502);
  return json({ ok: true, pending: true });
}

export async function handleBillingRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      return await handleStripeWebhook(request, env, fetchImpl);
    }
    if (url.pathname === "/api/billing/summary" && request.method === "GET") {
      return await handleBillingSummary(request, env, fetchImpl);
    }
    if (url.pathname === "/api/billing/portal" && request.method === "POST") {
      return await handleBillingPortal(request, env, fetchImpl);
    }
    if (url.pathname === "/api/billing/service-change" && request.method === "POST") {
      return await handleServiceChange(request, env, fetchImpl);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("Billing request failed", { name: error?.name || "Error" });
    return json({ error: "Billing could not be completed." }, 502);
  }
}
