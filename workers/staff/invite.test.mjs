import assert from "node:assert/strict";
import test from "node:test";
import { employeeSetupRedirect, handleStaffInvite, planEmployeeInvite } from "./invite.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-1234567890",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890"
};

function request(body, token = "user-jwt", url = "https://pulseanalyticsgroupllc.com/api/staff/invite") {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "https://pulseanalyticsgroupllc.com",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

const inviteBody = {
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace"
};

function callsFor(urls, options = {}) {
  return async (url, init = {}) => {
    const hit = { url: String(url), init };
    urls.push(hit);
    if (hit.url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "admin-1" }), { status: 200 });
    }
    if (hit.url.includes("/profiles?id=eq.admin-1")) {
      return new Response(JSON.stringify([{ role: "admin", is_active: true }]), { status: 200 });
    }
    if (hit.url.endsWith("/auth/v1/invite")) {
      if (options.inviteStatus) {
        return new Response(JSON.stringify(options.inviteBody || { msg: "email failed" }), { status: options.inviteStatus });
      }
      return new Response(JSON.stringify({ id: "employee-1", email: "ada@example.com" }), { status: 200 });
    }
    if (hit.url.includes("/rpc/admin_set_staff_role")) {
      return new Response(null, { status: options.roleStatus || 204 });
    }
    if (hit.url.includes("/profiles?id=eq.employee-1") && init.method === "PATCH") {
      return new Response(null, { status: options.profilePatchStatus || 204 });
    }
    if (hit.url.includes("/profiles?id=eq.employee-1")) {
      return new Response(JSON.stringify([{ id: "employee-1", role: options.role || "employee" }]), { status: 200 });
    }
    if (hit.url.includes("/auth/v1/admin/users/")) {
      return new Response(null, { status: options.deleteStatus || 200 });
    }
    if (hit.url.endsWith("/audit_logs")) {
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };
}

test("an invitation never accepts a password or an administrator role", () => {
  assert.equal(planEmployeeInvite({ email: "ada@example.com", first_name: "Ada", last_name: "Lovelace", password: "secret" }).error, "Passwords are not set by an administrator.");
  assert.equal(planEmployeeInvite({ email: "ada@example.com", first_name: "Ada", last_name: "Lovelace", role: "admin" }).error, "This workflow creates employee accounts only.");
  assert.equal(planEmployeeInvite({ email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" }).value.role, "employee");
});

test("employees and clients cannot invite staff", async () => {
  const urls = [];
  const fetchImpl = async (url, init = {}) => {
    urls.push(String(url));
    if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    return new Response(JSON.stringify([{ role: "employee", is_active: true }]), { status: 200 });
  };
  const response = await handleStaffInvite(request({
    email: "ada@example.com",
    first_name: "Ada",
    last_name: "Lovelace"
  }), env, fetchImpl);
  assert.equal(response.status, 403);
  assert.equal(urls.some((url) => url.endsWith("/auth/v1/invite")), false);
  const clientFetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-2" }), { status: 200 });
    return new Response(JSON.stringify([{ role: "client", is_active: true }]), { status: 200 });
  };
  const client = await handleStaffInvite(request({
    email: "ada@example.com",
    first_name: "Ada",
    last_name: "Lovelace"
  }), env, clientFetch);
  assert.equal(client.status, 403);
});

test("an administrator invitation creates an employee profile and stores no password", async () => {
  const urls = [];
  const response = await handleStaffInvite(request({
    email: "Ada@Example.com",
    first_name: "Ada",
    last_name: "Lovelace",
    job_title: "Analyst",
    department: "Insights",
    started_on: "2026-01-02"
  }), env, callsFor(urls));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, id: "employee-1" });
  assert.equal(JSON.stringify(body).includes(env.SUPABASE_SERVICE_ROLE_KEY), false);

  const invite = urls.find((item) => item.url.endsWith("/auth/v1/invite"));
  const sent = JSON.parse(invite.init.body);
  assert.equal(sent.email, "ada@example.com");
  assert.equal(sent.data.signup_intent, "staff_employee");
  assert.equal(sent.redirect_to, "https://pulseanalyticsgroupllc.com/employee-setup.html");
  assert.equal(sent.redirect_to.includes("admin-login"), false);
  assert.equal(Object.hasOwn(sent, "password"), false);
  assert.equal(invite.init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);

  const roleCall = urls.find((item) => item.url.includes("/rpc/admin_set_staff_role"));
  assert.deepEqual(JSON.parse(roleCall.init.body), { p_profile_id: "employee-1", p_role: "employee" });
  assert.equal(roleCall.init.headers.Authorization, "Bearer user-jwt");

  const patch = urls.find((item) => item.url.includes("/profiles?id=eq.employee-1") && item.init.method === "PATCH");
  const profile = JSON.parse(patch.init.body);
  assert.equal(Object.hasOwn(profile, "role"), false);
  assert.equal(profile.job_title, "Analyst");
  assert.equal(Object.hasOwn(profile, "password"), false);
  assert.equal(patch.init.headers.Authorization, "Bearer user-jwt");

  const audit = urls.find((item) => item.url.endsWith("/audit_logs"));
  assert.equal(JSON.parse(audit.init.body).action, "ADMIN_CREATED_EMPLOYEE");
  assert.equal(audit.init.headers.Authorization, "Bearer user-jwt");
  const profileRead = urls.find((item) => item.url.includes("/profiles?id=eq.admin-1"));
  assert.equal(profileRead.init.headers.Authorization, "Bearer user-jwt");
  assert.equal(profileRead.init.headers.apikey, env.SUPABASE_ANON_KEY);
});

test("the employee redirect is the setup page and an insecure origin is rejected", () => {
  assert.equal(
    employeeSetupRedirect("https://pulseanalyticsgroupllc.com/admin-login.html").redirect,
    "https://pulseanalyticsgroupllc.com/employee-setup.html"
  );
  assert.equal(employeeSetupRedirect("http://evil.example/employee-setup.html").error, "The employee setup address is not allowed.");
});

test("an email failure does not assign a role or leave a success response", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, { inviteStatus: 500 }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /email could not be sent/);
  assert.equal(urls.some((item) => item.url.includes("admin_set_staff_role")), false);
});

test("a role failure removes only the invited account and does not report success", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, { roleStatus: 403 }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /incomplete account was removed/);
  const removed = urls.find((item) => item.url.includes("/auth/v1/admin/users/employee-1"));
  assert.equal(removed.init.method, "DELETE");
  assert.equal(urls.some((item) => item.url.endsWith("/audit_logs")), false);
});

test("a duplicate invitation is rejected without creating another account", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, {
    inviteStatus: 422,
    inviteBody: { msg: "A user with this email address has already been registered" }
  }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /already exists/);
  assert.equal(urls.some((item) => item.url.includes("/auth/v1/admin/users/")), false);
});

test("a client role left by signup is removed instead of reported as an employee", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, { role: "client" }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /incomplete account was removed/);
  assert.equal(urls.some((item) => item.url.endsWith("/audit_logs")), false);
});

test("a failed profile update removes the incomplete invitation account", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, { profilePatchStatus: 500 }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /profile setup failed/i);
  assert.match(body.error, /incomplete account was removed/i);
  assert.match(body.error, /send the invitation again/i);
  const removed = urls.filter((item) => item.url.includes("/auth/v1/admin/users/"));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].url, "https://example.supabase.co/auth/v1/admin/users/employee-1");
  assert.equal(removed[0].init.method, "DELETE");
  assert.equal(removed[0].init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.equal(urls.some((item) => item.url.endsWith("/audit_logs")), false);
});

test("a failed profile update reports when account cleanup also fails", async () => {
  const urls = [];
  const response = await handleStaffInvite(request(inviteBody), env, callsFor(urls, {
    profilePatchStatus: 500,
    deleteStatus: 500
  }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /invitation email was already sent/i);
  assert.match(body.error, /profile setup failed/i);
  assert.match(body.error, /account could not be removed/i);
  assert.match(body.error, /do not ask the recipient to continue/i);
  assert.match(body.error, /do not send another invitation/i);
  const removed = urls.filter((item) => item.url.includes("/auth/v1/admin/users/"));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].init.method, "DELETE");
  assert.equal(urls.some((item) => item.url.endsWith("/audit_logs")), false);
});
