import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loginRedirectDestination, portalGuardDestination } from "./portal-guard.js";
import {
  employmentPayload,
  employeeListRequest,
  portalAccessText,
  relationshipBlockers,
  roleChoices,
  safeEmployeeError
} from "./admin-employees-view.js";

const portalHtml = readFileSync(new URL("../admin-portal.html", import.meta.url), "utf8");
const staffHtml = readFileSync(new URL("../staff-workspace.html", import.meta.url), "utf8");
const employeesJs = readFileSync(new URL("./admin-employees.js", import.meta.url), "utf8");
const employeesView = readFileSync(new URL("./admin-employees-view.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261001180000_employee_management.sql", import.meta.url), "utf8");
const phase5 = readFileSync(new URL("../supabase/migrations/20261001030000_profile_authorization.sql", import.meta.url), "utf8");

test("employee management stays inside the administrator portal", () => {
  assert.equal(portalHtml.includes("requireAdminPortal"), true);
  assert.equal(portalHtml.includes('id="nav-employees"'), true);
  assert.equal(portalHtml.includes("mountAdminEmployees"), true);
  assert.equal(staffHtml.includes("Employee Management"), false);
  assert.equal(staffHtml.includes("nav-employees"), false);
  assert.equal(staffHtml.includes("admin-employees"), false);
});

test("the directory loads through an administrator function", () => {
  assert.deepEqual(employeeListRequest({ query: "  Ada ", filter: "active" }), {
    p_query: "Ada",
    p_filter: "active"
  });
  assert.equal(employeeListRequest({ filter: "admins" }).p_filter, "employees");
  assert.match(employeesJs, /admin_employee_list/);
  assert.match(employeesJs, /admin_employee_detail/);
  assert.match(sql, /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\)/);
  assert.match(sql, /Administrator access is required/);
  assert.match(sql, /p\.role IN \('employee', 'client'\)/);
  assert.doesNotMatch(sql, /password_hash|encrypted_password|CREATE TABLE public\.passwords/);
});

test("administrators edit employment fields without setting role or account status", () => {
  const payload = employmentPayload({
    first_name: "Ada",
    last_name: "Lovelace",
    full_name: "Ada Lovelace",
    phone: "555",
    job_title: "Analyst",
    department: "Insights",
    started_on: "2026-01-02",
    role: "admin",
    is_active: false,
    password: "secret"
  });
  assert.deepEqual(payload, {
    first_name: "Ada",
    last_name: "Lovelace",
    full_name: "Ada Lovelace",
    phone: "555",
    job_title: "Analyst",
    department: "Insights",
    started_on: "2026-01-02"
  });
  assert.equal(Object.hasOwn(payload, "role"), false);
  assert.equal(Object.hasOwn(payload, "is_active"), false);
  assert.match(employeesJs, /\.from\("profiles"\)\.update\(payload\)/);
  assert.doesNotMatch(employeesJs, /is_active:\s*(true|false|input)/);
  assert.doesNotMatch(employeesJs, /role:\s*["']admin["']/);
});

test("role choices stay employee or client and a blocked client change is explained", () => {
  assert.deepEqual(roleChoices().map((choice) => choice.value), ["employee", "client"]);
  assert.equal(roleChoices().some((choice) => choice.value === "admin"), false);
  assert.equal(relationshipBlockers({ blockers: { assignments: 1, account_manager: 0, projects: 0 } }), true);
  assert.equal(relationshipBlockers({ blockers: { assignments: 0, account_manager: 0, projects: 0 } }), false);
  assert.match(sql, /Remove this employee from client assignments and project staff/);
  assert.match(sql, /employee_client_assignments/);
  assert.match(sql, /account_manager_id/);
  assert.match(sql, /project_members/);
  assert.doesNotMatch(sql, /DELETE FROM public\.employee_client_assignments/);
  assert.doesNotMatch(sql, /DELETE FROM public\.project_members/);
  assert.match(employeesJs, /admin_set_staff_role/);
  assert.match(employeesJs, /admin_set_employee_active/);
});

test("assignments are changed only through the administrator functions", () => {
  assert.match(employeesJs, /admin_assign_employee_client/);
  assert.match(employeesJs, /admin_unassign_employee_client/);
  assert.match(employeesView, /Removing this direct assignment does not remove project membership/);
  assert.match(employeesJs, /UNASSIGN_NOTE/);
  assert.doesNotMatch(employeesJs, /from\("employee_client_assignments"\)/);
  assert.match(phase5, /REVOKE INSERT, UPDATE, DELETE ON public\.employee_client_assignments FROM authenticated/);
});

test("portal access follows role and account status", () => {
  assert.equal(portalAccessText({ role: "employee", is_active: true }), "Enabled");
  assert.equal(portalAccessText({ role: "employee", is_active: false }), "Disabled");
  assert.equal(portalAccessText({ role: "client", is_active: true }), "Disabled");
  const inactive = { authenticated: true, profile: { role: "employee", is_active: false } };
  const employee = { authenticated: true, profile: { role: "employee", is_active: true } };
  const client = { authenticated: true, profile: { role: "client", is_active: true } };
  const admin = { authenticated: true, profile: { role: "admin", is_active: true } };
  assert.equal(loginRedirectDestination(admin), "admin-portal.html");
  assert.equal(loginRedirectDestination(employee), "staff-workspace.html");
  assert.equal(loginRedirectDestination(client), "admin-unauthorized.html");
  assert.equal(loginRedirectDestination(inactive), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(employee, "admin"), "staff-workspace.html");
  assert.equal(portalGuardDestination(client, "admin"), "admin-unauthorized.html");
  assert.equal(portalGuardDestination(inactive, "staff"), "admin-unauthorized.html");
});

test("expected employee errors stay specific", () => {
  assert.equal(safeEmployeeError("Administrator access is required."), "You do not have permission to perform this action.");
  assert.match(safeEmployeeError("new row violates row-level security"), /do not have permission/);
  assert.match(safeEmployeeError("Remove this employee from client assignments and project staff before changing them to a client."), /before changing them to a client/);
  assert.match(safeEmployeeError("already inactive"), /already inactive/);
  assert.equal(safeEmployeeError("duplicate key value"), "Employee details could not be saved. Try again.");
});
