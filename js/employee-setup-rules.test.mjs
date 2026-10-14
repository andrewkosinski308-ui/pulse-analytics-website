import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EMPLOYEE_SETUP_REDIRECT,
  EMPLOYEE_WORKSPACE_PAGE,
  employeeInvitationGate,
  employeeRecoveryRequest,
  employeeSetupAccess,
  employeeSetupDestination,
  passwordSaveAllowed,
  passwordSetupError,
  recoveryCallbackFailure,
  recoveryRequestAllowed
} from "./employee-setup-rules.js";

const employee = {
  authenticated: true,
  profile: { role: "employee", is_active: true }
};

test("a valid employee may set a password and then opens the staff workspace", () => {
  assert.equal(employeeInvitationGate(employee).ok, true);
  assert.equal(employeeSetupDestination(employee), EMPLOYEE_WORKSPACE_PAGE);
  assert.equal(employeeSetupDestination(employee).includes("admin-login"), false);
});

test("missing, client, and administrator sessions cannot use employee setup", () => {
  assert.equal(employeeInvitationGate(null).ok, false);
  assert.equal(employeeInvitationGate({ authenticated: false, profile: null }).ok, false);
  assert.equal(employeeSetupDestination({ authenticated: false }), "");
  for (const role of ["client", "admin"]) {
    const state = { authenticated: true, profile: { role, is_active: true } };
    assert.equal(employeeInvitationGate(state).ok, false);
    assert.equal(employeeSetupDestination(state), "");
  }
  assert.equal(employeeInvitationGate({
    authenticated: true,
    profile: { role: "employee", is_active: false }
  }).ok, false);
});

test("password confirmation rejects a short password and a mismatch", () => {
  assert.match(passwordSetupError("short1", "short1"), /8 characters/);
  assert.match(passwordSetupError("longpassword", "longpassword"), /letter and a number/);
  assert.equal(passwordSetupError("Employee1", "Employee2"), "Passwords do not match.");
  assert.equal(passwordSetupError("Employee1", "Employee1"), "");
});

test("the setup page does not send the recipient to admin login or client signup", () => {
  const page = readFileSync(new URL("../employee-setup.html", import.meta.url), "utf8");
  assert.equal(page.includes("admin-login"), false);
  assert.equal(page.includes("account/create"), false);
  assert.match(page, /employeeSetupAccess/);
  assert.match(page, /updatePassword/);
  assert.match(page, /employeeSetupDestination/);
});

test("client signup stays on the client intent and does not invite an employee", () => {
  const auth = readFileSync(new URL("./pulse-auth.js", import.meta.url), "utf8");
  const start = auth.indexOf("export async function signUpClient");
  const end = auth.indexOf("/** Active administrator", start);
  const signup = auth.slice(start, end);
  assert.match(signup, /signup_intent:\s*'portal_client'/);
  assert.equal(signup.includes("staff_employee"), false);
  assert.equal(signup.includes("employee-setup"), false);
});

const setupUrl = "https://pulseanalyticsgroupllc.com/employee-setup.html";

test("employee recovery requests use the setup page and a generic result", () => {
  const plan = employeeRecoveryRequest("Andrew@Example.com");
  assert.equal(plan.redirectTo, EMPLOYEE_SETUP_REDIRECT);
  assert.equal(plan.redirectTo, setupUrl);
  assert.equal(plan.email, "andrew@example.com");
  assert.match(plan.message, /If an employee account exists/);
  assert.equal(plan.message.includes("andrew@example.com"), false);
  assert.equal(employeeRecoveryRequest("not-an-email").error, "Enter a valid email address.");
  assert.equal(employeeRecoveryRequest("missing@example.com").message, plan.message);
});

test("a failed or reused recovery callback cannot open password setup", () => {
  const employee = { authenticated: true, profile: { role: "employee", is_active: true } };
  for (const href of [
    `${setupUrl}#error=access_denied&error_code=otp_expired&error_description=expired`,
    `${setupUrl}?error_code=otp_expired`,
    `${setupUrl}#access_token=secret&error=access_denied`
  ]) {
    const access = employeeSetupAccess(employee, href);
    assert.equal(access.ok, false);
    assert.equal(access.allowRecoveryRequest, true);
    assert.equal(JSON.stringify(access).includes("secret"), false);
    assert.equal(JSON.stringify(access).includes("access_token"), false);
  }
  assert.equal(recoveryCallbackFailure("not a url"), true);
});

test("only an active employee session can set a password", () => {
  assert.equal(employeeSetupAccess(employee, setupUrl).ok, true);
  assert.equal(employeeSetupAccess({ authenticated: false, profile: null }, setupUrl).ok, false);
  assert.equal(employeeSetupAccess({ authenticated: true, profile: null }, setupUrl).ok, false);
  assert.equal(employeeSetupAccess({
    authenticated: true,
    error: "Unable to load profile.",
    profile: null
  }, setupUrl).ok, false);
  for (const role of ["client", "admin", "owner"]) {
    const access = employeeSetupAccess({
      authenticated: true,
      profile: { role, is_active: true },
      user: { id: "caller-supplied", email: "person@example.com", user_metadata: { role: "employee" } }
    }, `${setupUrl}?role=employee&email=person@example.com&user_id=caller-supplied`);
    assert.equal(access.ok, false);
    assert.equal(access.allowRecoveryRequest, false);
  }
  assert.equal(employeeSetupAccess({
    authenticated: true,
    profile: { role: "employee", is_active: false }
  }, setupUrl).ok, false);
});

test("password saves and recovery sends cannot overlap themselves", () => {
  assert.equal(passwordSaveAllowed({ ready: true, saving: false }), true);
  assert.equal(passwordSaveAllowed({ ready: true, saving: true }), false);
  assert.equal(passwordSaveAllowed({ ready: false, saving: false }), false);
  assert.equal(recoveryRequestAllowed({ sending: false }), true);
  assert.equal(recoveryRequestAllowed({ sending: true }), false);
});

test("the setup page keeps recovery on the employee page and the invitation flow unchanged", () => {
  const page = readFileSync(new URL("../employee-setup.html", import.meta.url), "utf8");
  const recovery = readFileSync(new URL("./employee-recovery.js", import.meta.url), "utf8");
  const invite = readFileSync(new URL("../workers/staff/invite.js", import.meta.url), "utf8");
  const auth = readFileSync(new URL("./pulse-auth.js", import.meta.url), "utf8");
  assert.match(page, /employeeSetupAccess/);
  assert.match(page, /requestEmployeePasswordRecovery/);
  assert.match(page, /passwordSaveAllowed/);
  assert.match(page, /recoveryRequestAllowed/);
  assert.equal(page.includes("admin-login"), false);
  assert.equal(page.includes("account/create"), false);
  assert.equal(page.includes("admin-update-password"), false);
  assert.equal(page.includes("console.log"), false);
  const rules = readFileSync(new URL("./employee-setup-rules.js", import.meta.url), "utf8");
  assert.match(recovery, /resetPasswordForEmail/);
  assert.match(recovery, /redirectTo !== EMPLOYEE_SETUP_REDIRECT/);
  assert.match(rules, /https:\/\/pulseanalyticsgroupllc\.com\/employee-setup\.html/);
  assert.equal(recovery.includes("service_role"), false);
  assert.equal(recovery.includes("admin-update-password"), false);
  assert.equal(recovery.includes("account/create"), false);
  assert.match(auth, /detectSessionInUrl:\s*true/);
  assert.match(auth, /updateUser\(\{\s*password:\s*newPassword\s*\}\)/);
  const duplicate = invite.indexOf("already exists");
  const remove = invite.indexOf("auth/v1/admin/users/");
  assert.equal(duplicate > 0, true);
  assert.equal(remove > duplicate, true);
});
