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

  const redirectTo = `${new URL(request.url).origin}/admin-update-password.html`;
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
    return json({ error: "The invitation could not be sent. Please try again." }, 502);
  }

  const profileFields = {
    email: employee.email,
    first_name: employee.first_name,
    last_name: employee.last_name,
    full_name: employee.full_name,
    job_title: employee.job_title,
    department: employee.department,
    started_on: employee.started_on,
    role: "employee",
    is_active: true
  };
  const profilePatch = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(invitedBody.id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(profileFields)
    }
  );
  const patched = await profilePatch.json().catch(() => null);
  if (!profilePatch.ok) return json({ error: "The invitation could not be sent. Please try again." }, 502);
  if (Array.isArray(patched) && patched.length === 0) {
    const created = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ id: invitedBody.id, ...profileFields })
    });
    if (!created.ok) return json({ error: "The invitation could not be sent. Please try again." }, 502);
  }

  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      Prefer: "return=minimal"
    },
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
