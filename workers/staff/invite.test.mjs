import assert from "node:assert/strict";
import test from "node:test";
import { handleStaffInvite, planEmployeeInvite } from "./invite.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-1234567890",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890"
};

function request(body, token = "user-jwt") {
  return new Request("https://pulseanalyticsgroupllc.com/api/staff/invite", {
    method: "POST",
    headers: {
      origin: "https://pulseanalyticsgroupllc.com",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function callsFor(urls) {
  return async (url, init = {}) => {
    const hit = { url, init };
    urls.push(hit);
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "admin-1" }), { status: 200 });
    }
    if (String(url).includes("/profiles?id=eq.admin-1")) {
      return new Response(JSON.stringify([{ role: "admin", is_active: true }]), { status: 200 });
    }
    if (String(url).endsWith("/auth/v1/invite")) {
      return new Response(JSON.stringify({ id: "employee-1", email: "ada@example.com" }), { status: 200 });
    }
    if (String(url).includes("/profiles?id=eq.employee-1")) {
      return new Response(JSON.stringify([{ id: "employee-1", role: "employee" }]), { status: 200 });
    }
    if (String(url).endsWith("/audit_logs")) {
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
  const inviteBody = JSON.parse(invite.init.body);
  assert.equal(inviteBody.email, "ada@example.com");
  assert.equal(inviteBody.data.signup_intent, "staff_employee");
  assert.equal(Object.hasOwn(inviteBody, "password"), false);
  assert.equal(invite.init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);

  const patch = urls.find((item) => String(item.url).includes("/profiles?id=eq.employee-1"));
  const profile = JSON.parse(patch.init.body);
  assert.equal(profile.role, "employee");
  assert.equal(profile.is_active, true);
  assert.equal(profile.job_title, "Analyst");
  assert.equal(Object.hasOwn(profile, "password"), false);

  const audit = urls.find((item) => item.url.endsWith("/audit_logs"));
  assert.equal(JSON.parse(audit.init.body).action, "ADMIN_CREATED_EMPLOYEE");
  const profileRead = urls.find((item) => String(item.url).includes("/profiles?id=eq.admin-1"));
  assert.equal(profileRead.init.headers.Authorization, "Bearer user-jwt");
  assert.equal(profileRead.init.headers.apikey, env.SUPABASE_ANON_KEY);
});
