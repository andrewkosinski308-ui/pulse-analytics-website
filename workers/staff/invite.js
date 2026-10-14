/**
 * Administrator employee invitation.
 * The browser sends the administrator's session. Supabase Auth admin calls stay here.
 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function serviceKey(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || key.length < 20 || key === env?.SUPABASE_ANON_KEY) return "";
  return key;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function bearer(request) {
  const match = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function clean(value, max) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, max);
}

export const EMPLOYEE_SETUP_PAGE = "employee-setup.html";

/**
 * Exact invitation redirect. The path is always the employee setup page.
 * Auth will ignore it until that exact URL is on the redirect allow list.
 */
export function employeeSetupRedirect(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return { error: "The employee setup address is not allowed." };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    return { error: "The employee setup address is not allowed." };
  }
  const redirect = `${url.origin}/${EMPLOYEE_SETUP_PAGE}`;
  if (new URL(redirect).pathname !== `/${EMPLOYEE_SETUP_PAGE}`) {
    return { error: "The employee setup address is not allowed." };
  }
  return { redirect };
}

/** Reject passwords and any role other than employee before a privileged call. */
export function planEmployeeInvite(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Enter the employee details." };
  }
  if (Object.prototype.hasOwnProperty.call(body, "password") || Object.prototype.hasOwnProperty.call(body, "encrypted_password")) {
    return { error: "Passwords are not set by an administrator." };
  }
  if (body.role != null && body.role !== "employee") {
    return { error: "This workflow creates employee accounts only." };
  }
  const email = clean(body.email, 200).toLowerCase();
  const firstName = clean(body.first_name, 80);
  const lastName = clean(body.last_name, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!firstName || !lastName) return { error: "Enter the employee's first and last name." };
  const started = clean(body.started_on, 10);
  if (started && !/^\d{4}-\d{2}-\d{2}$/.test(started)) return { error: "Enter a start date as YYYY-MM-DD." };
  return {
    value: {
      email,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      job_title: clean(body.job_title, 120) || null,
      department: clean(body.department, 120) || null,
      started_on: started || null,
      role: "employee"
    }
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleStaffInvite(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ error: "Employee invitations use POST." }, 405);
  if (!sameOrigin(request)) return json({ error: "Employee invitations could not be sent from this page." }, 403);
  const jwt = bearer(request);
  const key = serviceKey(env);
  if (!jwt) return json({ error: "Sign in again to invite an employee." }, 401);
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY || !key) {
    return json({ error: "Employee invitations are not available right now." }, 503);
  }

  const planned = planEmployeeInvite(await readJson(request));
  if (planned.error) return json({ error: planned.error }, 400);
  const employee = planned.value;

  const userResponse = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` }
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) return json({ error: "Sign in again to invite an employee." }, 401);

  const profileResponse = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } }
  );
  const profiles = await profileResponse.json().catch(() => null);
  const admin = Array.isArray(profiles) ? profiles[0] : null;
  if (!profileResponse.ok || admin?.role !== "admin" || admin?.is_active === false) {
    return json({ error: "You do not have permission to perform this action." }, 403);
  }

  const redirectPlan = employeeSetupRedirect(request.url);
  if (redirectPlan.error) return json({ error: redirectPlan.error }, 500);
  const redirectTo = redirectPlan.redirect;
  const invited = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/invite`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: employee.email,
      data: {
        full_name: employee.full_name,
        first_name: employee.first_name,
        last_name: employee.last_name,
        signup_intent: "staff_employee"
      },
      redirect_to: redirectTo
    })
  });
  const invitedBody = await invited.json().catch(() => null);
  if (!invited.ok || !invitedBody?.id) {
    const already = String(invitedBody?.msg || invitedBody?.message || invitedBody?.error_description || "").toLowerCase();
    if (invited.status === 422 || already.includes("already")) {
      return json({ error: "An account with this email already exists." }, 409);
    }
    return json({ error: "The invitation email could not be sent. No employee account was created." }, 502);
  }

  const adminHeaders = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    "content-type": "application/json"
  };
  const roleCall = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/admin_set_staff_role`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ p_profile_id: invitedBody.id, p_role: "employee" })
  });
  const roleCheck = roleCall.ok
    ? await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(invitedBody.id)}&select=role`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } }
    )
    : null;
  const roleRows = roleCheck ? await roleCheck.json().catch(() => null) : null;
  const roleApplied = roleCall.ok && roleCheck?.ok && Array.isArray(roleRows) && roleRows[0]?.role === "employee";
  if (!roleApplied) {
    const removed = await fetchImpl(
      `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(invitedBody.id)}`,
      { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (removed.ok) {
      return json({
        error: "The employee role could not be applied. The incomplete account was removed. Send the invitation again."
      }, 502);
    }
    return json({
      error: "The invitation email was sent, but the account was left without the employee role. Do not ask the recipient to continue. No second invitation was sent."
    }, 502);
  }

  const profilePatch = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(invitedBody.id)}`,
    {
      method: "PATCH",
      headers: { ...adminHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        email: employee.email,
        first_name: employee.first_name,
        last_name: employee.last_name,
        full_name: employee.full_name,
        job_title: employee.job_title,
        department: employee.department,
        started_on: employee.started_on
      })
    }
  );

  if (!profilePatch.ok) {
    const cleanup = await fetchImpl(
      `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(invitedBody.id)}`,
      { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (cleanup.ok) {
      return json({
        error: "Employee profile setup failed. The incomplete account was removed. Send the invitation again."
      }, 502);
    }
    return json({
      error: "The invitation email was already sent, but employee profile setup failed and the account could not be removed. Do not ask the recipient to continue. Do not send another invitation."
    }, 502);
  }

  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      actor_id: user.id,
      action: "ADMIN_CREATED_EMPLOYEE",
      entity_type: "profiles",
      entity_id: invitedBody.id,
      metadata: { email: employee.email }
    })
  });

  return json({ ok: true, id: invitedBody.id });
}
