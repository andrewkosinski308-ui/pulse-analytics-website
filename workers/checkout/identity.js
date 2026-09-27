const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

/**
 * Resolve the signed-in portal client from the Supabase access token.
 * Ignores any client id in the request body.
 */
export async function resolveCheckoutIdentity(request, env, fetchImpl) {
  const jwt = bearer(request);
  if (!jwt || !env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) return null;

  const userRes = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`
    }
  });
  const user = await userRes.json().catch(() => null);
  if (!userRes.ok || !user?.id) return null;

  const membersUrl = new URL(`${env.SUPABASE_URL}/rest/v1/client_members`);
  membersUrl.searchParams.set("profile_id", `eq.${user.id}`);
  membersUrl.searchParams.set("select", "client_id,created_at");
  membersUrl.searchParams.set("order", "created_at.asc");
  membersUrl.searchParams.set("limit", "1");
  const membersRes = await fetchImpl(membersUrl, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`
    }
  });
  const members = await membersRes.json().catch(() => null);
  const membership = Array.isArray(members) ? members[0] : null;
  if (!membersRes.ok || !CLIENT_ID.test(membership?.client_id || "")) return null;

  const clientUrl = new URL(`${env.SUPABASE_URL}/rest/v1/clients`);
  clientUrl.searchParams.set("id", `eq.${membership.client_id}`);
  clientUrl.searchParams.set("select", "id,name,stripe_customer_id");
  const clientRes = await fetchImpl(clientUrl, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`
    }
  });
  const clients = await clientRes.json().catch(() => null);
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!clientRes.ok || client?.id !== membership.client_id) return null;

  const customerId = typeof client.stripe_customer_id === "string" && client.stripe_customer_id.startsWith("cus_")
    ? client.stripe_customer_id
    : "";
  return { clientId: client.id, customerId, name: client.name || "" };
}
