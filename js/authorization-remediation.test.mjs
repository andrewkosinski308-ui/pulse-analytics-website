import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientLoginStaffDestination } from "./portal-guard.js";

const migration = readFileSync(
  new URL("../supabase/migrations/20261012010000_authorization_remediation_phase1.sql", import.meta.url),
  "utf8"
);
const flagGuard = readFileSync(
  new URL("../supabase/migrations/20261012020000_role_change_flag_guard.sql", import.meta.url),
  "utf8"
);
const portal = readFileSync(new URL("./pulse-auth.js", import.meta.url), "utf8");
const clientLogin = readFileSync(new URL("../client-login.html", import.meta.url), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from > -1 && to > from, `${start} block missing`);
  return source.slice(from, to);
}

test("an employee cannot create a client or become its account manager", () => {
  const policy = between(migration, "CREATE POLICY clients_insert", "DROP POLICY IF EXISTS projects_insert");
  assert.match(policy, /WITH CHECK \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(policy, /is_staff\(\)/);
  assert.match(migration, /handle_new_user/);
  assert.match(migration, /employee_client_assignments remains insert-revoked/);
});

test("an employee project cannot grant that employee new client access", () => {
  const insert = between(migration, "CREATE POLICY projects_insert", "DROP POLICY IF EXISTS projects_update");
  assert.match(insert, /public\.is_admin\(\)/);
  assert.match(insert, /public\.is_staff_for_client\(client_id\)/);
  assert.match(insert, /owner_id IS DISTINCT FROM auth\.uid\(\)/);
  const update = between(migration, "CREATE POLICY projects_update", "CREATE OR REPLACE FUNCTION private.guard_project_staff_grant");
  assert.match(update, /WITH CHECK/);
  assert.match(update, /public\.is_staff_for_client\(client_id\)/);
  assert.doesNotMatch(update.slice(update.indexOf("WITH CHECK")), /is_project_member/);
  const guard = between(migration, "CREATE OR REPLACE FUNCTION private.guard_project_staff_grant()", "REVOKE ALL ON FUNCTION private.guard_project_staff_grant()");
  assert.match(guard, /NEW\.owner_id = auth\.uid\(\)/);
  assert.match(guard, /NEW\.client_id IS DISTINCT FROM OLD\.client_id/);
  assert.match(guard, /IS DISTINCT FROM 'authenticated'/);
  assert.match(guard, /public\.is_admin\(\)/);
});

test("direct profile updates cannot promote anyone to administrator", () => {
  const guard = between(migration, "CREATE OR REPLACE FUNCTION public.protect_profile_privileges()", "REVOKE ALL ON FUNCTION public.protect_profile_privileges()");
  assert.match(guard, /pulse\.role_change/);
  assert.match(guard, /NEW\.role::text NOT IN \('employee', 'client'\)/);
  assert.match(guard, /self_update/);
  assert.match(guard, /OLD\.role = 'admin'/);
  assert.match(guard, /Those account fields cannot be changed here/);
  assert.match(guard, /IS DISTINCT FROM 'authenticated'/);
  const insert = between(migration, "CREATE OR REPLACE FUNCTION private.guard_profile_role_insert()", "REVOKE ALL ON FUNCTION private.guard_profile_role_insert()");
  assert.match(insert, /NEW\.role = 'admin'/);
  const rpc = between(migration, "CREATE OR REPLACE FUNCTION public.admin_set_staff_role", "REVOKE ALL ON FUNCTION public.admin_set_staff_role");
  assert.match(rpc, /NOT public\.is_admin\(\)/);
  assert.match(rpc, /p_role NOT IN \('employee', 'client'\)/);
  assert.match(rpc, /set_config\('pulse\.role_change', 'approved', true\)/);
  assert.match(rpc, /An administrator cannot change their own role/);
  assert.match(rpc, /Remove this employee from client assignments/);
});

test("the role-change flag cannot authorize a caller by itself", () => {
  const guard = between(migration, "CREATE OR REPLACE FUNCTION public.protect_profile_privileges()", "REVOKE ALL ON FUNCTION public.protect_profile_privileges()");
  const rpc = between(migration, "CREATE OR REPLACE FUNCTION public.admin_set_staff_role", "REVOKE ALL ON FUNCTION public.admin_set_staff_role");
  const adminCheck = rpc.indexOf("NOT public.is_admin()");
  const flag = rpc.indexOf("set_config('pulse.role_change', 'approved', true)");
  assert.ok(adminCheck > -1 && adminCheck < flag);
  assert.equal((migration.match(/set_config\('pulse\.role_change'/g) || []).length, 1);
  assert.match(guard, /IS DISTINCT FROM 'approved'/);
  assert.match(guard, /OR NOT caller_is_admin/);
  assert.match(guard, /OR self_update/);
  assert.match(guard, /OR OLD\.role = 'admin'/);
  assert.match(guard, /OR NEW\.role::text NOT IN \('employee', 'client'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_set_staff_role\(uuid, public\.app_role\) TO authenticated/);
  assert.doesNotMatch(migration, /CREATE (OR REPLACE )?FUNCTION public\.set_config/);
  assert.match(flagGuard, /staff_still_assigned/);
  assert.match(flagGuard, /OR staff_still_assigned/);
  assert.match(flagGuard, /employee_client_assignments/);
  assert.match(flagGuard, /IS DISTINCT FROM 'authenticated'/);
  assert.match(flagGuard, /Remove this employee from client assignments/);
  assert.match(flagGuard, /REVOKE ALL ON FUNCTION public\.protect_profile_privileges\(\) FROM PUBLIC, anon, authenticated/);
});

test("service catalog writes are administrator-only and reads stay in the earlier policy", () => {
  assert.match(migration, /DROP POLICY IF EXISTS services_staff_write ON public\.services/);
  const write = between(migration, "CREATE POLICY services_admin_write", "FOR ALL TO authenticated");
  assert.match(migration, /CREATE POLICY services_admin_write ON public\.services[\s\S]*USING \(public\.is_admin\(\)\)[\s\S]*WITH CHECK \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(write, /is_staff\(\)/);
  assert.doesNotMatch(migration, /DROP POLICY IF EXISTS services_select/);
});

test("client sign-in keeps an active staff session and sends it to the staff destination", () => {
  const access = between(portal, "if (current.profile.role !== 'client')", "if (current.profile.is_active === false)");
  const staffBranch = access.slice(0, access.indexOf("await signOut()"));
  assert.match(staffBranch, /clientLoginStaffDestination/);
  assert.match(staffBranch, /error\.staffDestination = staffDestination/);
  assert.doesNotMatch(staffBranch, /signOut/);
  assert.match(access, /await signOut\(\)/);
  assert.match(portal, /const staffDestination = clientLoginStaffDestination\(authState\)/);
  assert.match(clientLogin, /err\.staffDestination/);
  assert.match(clientLogin, /window\.location\.replace\(err\.staffDestination\)/);
  assert.match(clientLogin, /clientEntryPath\(authState\)/);
  assert.equal(
    clientLoginStaffDestination({ authenticated: true, profile: { role: "admin", is_active: true } }),
    "admin-portal.html"
  );
  assert.equal(
    clientLoginStaffDestination({ authenticated: true, profile: { role: "employee", is_active: true } }),
    "admin-portal.html"
  );
  assert.equal(
    clientLoginStaffDestination({ authenticated: true, profile: { role: "client", is_active: true } }),
    null
  );
  assert.equal(
    clientLoginStaffDestination({ authenticated: true, profile: { role: "employee", is_active: false } }),
    null
  );
  assert.equal(clientLoginStaffDestination({ authenticated: false, profile: { role: "admin", is_active: true } }), null);
});
