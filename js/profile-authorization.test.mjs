import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loginRedirectDestination, portalGuardDestination } from "./portal-guard.js";

const sql = readFileSync(new URL("../supabase/migrations/20261001030000_profile_authorization.sql", import.meta.url), "utf8");
const portal = readFileSync(new URL("./pulse-auth.js", import.meta.url), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from > -1 && to > from, `${start} block missing`);
  return source.slice(from, to);
}

test("self-service profile updates cannot change role or account status", () => {
  const guard = between(sql, "CREATE OR REPLACE FUNCTION public.protect_profile_privileges()", "REVOKE ALL ON FUNCTION public.protect_profile_privileges()");
  assert.match(guard, /NEW\.role := OLD\.role/);
  assert.match(guard, /NEW\.is_active := OLD\.is_active/);
  assert.match(guard, /self_update OR NOT caller_is_admin OR OLD\.role = 'admin'/);
  assert.match(guard, /NEW\.job_title := OLD\.job_title/);
  assert.match(guard, /auth\.role\(\), ''\) IS DISTINCT FROM 'authenticated'/);
  assert.doesNotMatch(sql, /password_hash|encrypted_password|CREATE TABLE public\.passwords/);
});

test("profiles are visible to the owner and administrators", () => {
  assert.match(sql, /CREATE POLICY profiles_select ON public\.profiles[\s\S]*USING \(id = auth\.uid\(\) OR public\.is_admin\(\)\)/);
  assert.doesNotMatch(between(sql, "CREATE POLICY profiles_select", "CREATE POLICY clients_update"), /is_staff\(\)/);
});

test("an administrator manages employee status, role, and client assignment", () => {
  for (const name of [
    "admin_assign_employee_client",
    "admin_unassign_employee_client",
    "admin_set_employee_active",
    "admin_set_staff_role"
  ]) {
    const body = between(sql, `CREATE OR REPLACE FUNCTION public.${name}`, "REVOKE ALL ON FUNCTION public." + name);
    assert.match(body, /NOT public\.is_admin\(\)/);
    assert.match(body, /Administrator access is required/);
  }
  assert.match(sql, /p_role NOT IN \('employee', 'client'\)|p_role <> 'employee'/);
  assert.match(sql, /AND role IN \('employee', 'client'\)/);
  assert.match(sql, /An administrator cannot change their own role/);
  assert.match(sql, /An administrator cannot change their own account status/);
  assert.match(sql, /ADMIN_ASSIGNED_EMPLOYEE_TO_CLIENT/);
  assert.match(sql, /ADMIN_REMOVED_EMPLOYEE_FROM_CLIENT/);
  assert.match(sql, /ADMIN_CHANGED_EMPLOYEE_ROLE/);
  assert.match(sql, /ADMIN_CHANGED_EMPLOYEE_STATUS/);
});

test("employee client access requires an active assignment or an existing staff relationship", () => {
  const staff = between(sql, "CREATE OR REPLACE FUNCTION public.is_staff_for_client", "CREATE OR REPLACE FUNCTION public.can_access_client");
  assert.match(staff, /public\.is_admin\(\)/);
  assert.match(staff, /account_manager_id = auth\.uid\(\)/);
  assert.match(staff, /project_members/);
  assert.match(staff, /employee_client_assignments/);
  assert.match(staff, /a\.active = true/);
  assert.match(staff, /ep\.role = 'employee'/);
  const access = between(sql, "CREATE OR REPLACE FUNCTION public.can_access_client", "REVOKE ALL ON FUNCTION public.is_authenticated");
  assert.match(access, /client_members/);
  assert.match(access, /a\.active = true/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.employee_client_assignments FROM authenticated/);
});

test("clients keep their own records and cannot write server-owned account fields", () => {
  const guard = between(sql, "CREATE OR REPLACE FUNCTION private.guard_client_owner_fields()", "REVOKE ALL ON FUNCTION private.guard_client_owner_fields()");
  assert.match(guard, /NEW\.status := OLD\.status/);
  assert.match(guard, /NEW\.stripe_customer_id := OLD\.stripe_customer_id/);
  assert.match(guard, /NEW\.onboarding_step := OLD\.onboarding_step/);
  assert.match(guard, /NEW\.account_manager_id := OLD\.account_manager_id/);
  assert.match(sql, /public\.is_client_owner\(id\)/);
  assert.match(sql, /SELECT public\.is_client_member\(p_client_id\)/);
});

test("employees do not receive billing visibility and reports stay on assigned clients", () => {
  const subscriptions = between(sql, "CREATE POLICY client_subscriptions_select", "DROP POLICY IF EXISTS client_invoices_select");
  const invoices = between(sql, "CREATE POLICY client_invoices_select", "DROP POLICY IF EXISTS audit_logs_staff_insert");
  assert.match(subscriptions, /public\.is_admin\(\) OR public\.is_client_member\(client_id\)/);
  assert.match(invoices, /public\.is_admin\(\) OR public\.is_client_member\(client_id\)/);
  assert.doesNotMatch(subscriptions, /is_staff_for_client/);
  assert.doesNotMatch(invoices, /is_staff_for_client/);
  const reports = between(sql, "CREATE POLICY reports_select", "DROP POLICY IF EXISTS reports_staff_write");
  assert.match(reports, /public\.is_staff\(\) AND public\.is_staff_for_client\(client_id\)/);
  assert.match(reports, /status = 'published'/);
  assert.match(reports, /public\.is_client_member\(client_id\)/);
});

test("ordinary users cannot insert audit records", () => {
  assert.match(sql, /DROP POLICY IF EXISTS audit_logs_staff_insert/);
  assert.match(sql, /CREATE POLICY audit_logs_admin_select ON public\.audit_logs[\s\S]*USING \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(sql, /CREATE POLICY audit_logs_staff_insert/);
});

test("phase 4 portal routing still separates administrators, employees, and clients", () => {
  assert.match(portal, /export async function requireAdminPortal/);
  assert.match(portal, /export async function requireAdminStaffPortal/);
  assert.doesNotMatch(portal, /portal === 'staff'/);
  assert.equal(loginRedirectDestination({ authenticated: true, profile: { role: "admin", is_active: true } }), "admin-portal.html");
  assert.equal(loginRedirectDestination({ authenticated: true, profile: { role: "employee", is_active: true } }), "staff-workspace.html");
  assert.equal(loginRedirectDestination({ authenticated: true, profile: { role: "client", is_active: true } }), "admin-unauthorized.html");
  assert.equal(portalGuardDestination({ authenticated: false }, "staff"), "admin-login.html");
  assert.equal(portalGuardDestination({ authenticated: true, profile: { role: "employee", is_active: true } }, "admin"), "staff-workspace.html");
});
