import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isAdminPortalEligible,
  isAdminStaffPortalEligible,
  loginRedirectDestination,
  portalGuardDestination
} from "./portal-guard.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function session(role, extra = {}) {
  return {
    authenticated: true,
    profile: { role, is_active: true, ...extra }
  };
}

test("shared login routes an active administrator to the Admin Portal", () => {
  const auth = session("admin");
  assert.equal(isAdminPortalEligible(auth), true);
  assert.equal(isAdminStaffPortalEligible(auth), true);
  assert.equal(loginRedirectDestination(auth), "admin-portal.html");
});

test("shared login routes an active employee to the Staff Portal", () => {
  const auth = session("employee");
  assert.equal(isAdminPortalEligible(auth), false);
  assert.equal(isAdminStaffPortalEligible(auth), true);
  assert.equal(loginRedirectDestination(auth), "staff-workspace.html");
});

test("shared login denies a client", () => {
  const auth = session("client");
  assert.equal(loginRedirectDestination(auth), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(auth, "admin"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(auth, "staff"), "admin-unauthorized.html");
});

test("an unauthenticated visitor stays on the shared login", () => {
  const auth = { authenticated: false, profile: null };
  assert.equal(loginRedirectDestination(auth), null);
  assert.equal(portalGuardDestination(auth, "admin"), "admin-login.html");
  assert.equal(portalGuardDestination(auth, "staff"), "admin-login.html");
});

test("Staff Workspace admits employees and administrators and refuses everyone else", () => {
  assert.equal(portalGuardDestination(session("employee"), "staff"), null);
  assert.equal(portalGuardDestination(session("admin"), "staff"), null);
  assert.equal(portalGuardDestination(session("client"), "staff"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination({ authenticated: false }, "staff"), "admin-login.html");
});

test("Admin Portal admits only an active administrator", () => {
  assert.equal(portalGuardDestination(session("admin"), "admin"), null);
  assert.equal(portalGuardDestination(session("employee"), "admin"), "staff-workspace.html");
  assert.equal(portalGuardDestination(session("client"), "admin"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination({ authenticated: false }, "admin"), "admin-login.html");
});

test("an inactive or signed-out session cannot stay on a protected portal page", () => {
  const inactiveAdmin = session("admin", { is_active: false });
  const inactiveEmployee = session("employee", { is_active: false });
  const signedOut = { authenticated: false, profile: { role: "admin", is_active: true } };
  assert.equal(portalGuardDestination(inactiveAdmin, "admin"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(inactiveEmployee, "staff"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(signedOut, "staff"), "admin-login.html");
  assert.equal(portalGuardDestination(signedOut, "admin"), "admin-login.html");
});

test("Staff Workspace no longer has its own login", () => {
  const page = read("staff-workspace.html");
  const script = read("js/staff-workspace.js");
  assert.match(page, /requireAdminStaffPortal|staff-gate/);
  assert.match(script, /requireAdminStaffPortal/);
  assert.match(script, /portalGuardDestination\(next, "staff"\)/);
  assert.match(script, /admin-login\.html/);
  assert.doesNotMatch(page, /staff-login-form|Staff sign in/);
  assert.doesNotMatch(script, /signIn\(/);
  assert.doesNotMatch(script, /isStaffWorkspaceEligible/);
  assert.match(script, /from\("files"\)/);
  assert.match(script, /from\("reports"\)/);
  assert.match(script, /from\("support_requests"\)/);
  assert.match(script, /from\("support_messages"\)/);
});

test("Admin Portal keeps the administrator-only gate", () => {
  const page = read("admin-portal.html");
  const auth = read("js/pulse-auth.js");
  assert.match(page, /requireAdminPortal/);
  assert.match(page, /portalGuardDestination\(next, 'admin'\)/);
  assert.match(auth, /export async function requireAdminPortal/);
  assert.match(auth, /export async function requireAdminStaffPortal/);
  assert.doesNotMatch(auth, /portal === 'staff'/);
  assert.doesNotMatch(read("supabase/migrations/20260927050000_remove_leads_contacts_appointments.sql"), /DISABLE ROW LEVEL SECURITY/);
});
