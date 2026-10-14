import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planStripeCheckoutProject } from "../workers/billing/purchase-project.js";

const migration = readFileSync(
  new URL("../supabase/migrations/20261012045059_admin_only_project_creation.sql", import.meta.url),
  "utf8"
);
const earlier = readFileSync(
  new URL("../supabase/migrations/20261012010000_authorization_remediation_phase1.sql", import.meta.url),
  "utf8"
);
const stripeSql = readFileSync(
  new URL("../supabase/migrations/20260927070000_client_lifecycle.sql", import.meta.url),
  "utf8"
);
const adminProjects = readFileSync(new URL("./admin-projects.js", import.meta.url), "utf8");
const adminPortal = readFileSync(new URL("../admin-portal.html", import.meta.url), "utf8");
const purchase = readFileSync(new URL("../workers/billing/purchase-project.js", import.meta.url), "utf8");
const integration = readFileSync(
  new URL("../supabase/tests/authorization_phase1.sql", import.meta.url),
  "utf8"
);

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from > -1 && to > from, `${start} block missing`);
  return source.slice(from, to);
}

test("authenticated project creation is administrator-only", () => {
  const policy = between(migration, "CREATE POLICY projects_insert", "CREATE OR REPLACE FUNCTION private.guard_project_staff_grant");
  assert.match(policy, /WITH CHECK \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(policy, /is_staff_for_client|is_staff\(\)/);
  assert.doesNotMatch(migration, /CREATE POLICY projects_update|DROP POLICY IF EXISTS projects_select|DROP POLICY IF EXISTS files_|DROP POLICY IF EXISTS reports_/);
  const guard = between(migration, "CREATE OR REPLACE FUNCTION private.guard_project_staff_grant()", "REVOKE ALL ON FUNCTION private.guard_project_staff_grant()");
  const insert = between(guard, "IF TG_OP = 'INSERT'", "IF NEW.client_id IS DISTINCT FROM OLD.client_id");
  assert.match(insert, /RAISE EXCEPTION 'Administrator access is required\.'/);
  assert.doesNotMatch(insert, /is_staff_for_client/);
  assert.match(guard, /IS DISTINCT FROM 'authenticated'/);
  assert.match(guard, /IF public\.is_admin\(\) THEN/);
  assert.match(guard, /NEW\.owner_id = auth\.uid\(\)/);
  assert.match(earlier, /is_staff_for_client\(client_id\)/);
});

test("Stripe provisioning stays on the service role and still requires a paid checkout", () => {
  const fn = between(stripeSql, "CREATE FUNCTION public.create_project_from_stripe_checkout(", "REVOKE ALL ON FUNCTION public.create_project_from_stripe_checkout");
  assert.match(fn, /SECURITY INVOKER/);
  assert.match(fn, /INSERT INTO public\.projects/);
  assert.match(fn, /payment_status|cs_\[A-Za-z0-9_\]\+/);
  assert.match(stripeSql, /GRANT EXECUTE ON FUNCTION public\.create_project_from_stripe_checkout\(uuid, text, uuid\[\], text\[\], text, text, text\) TO service_role/);
  assert.match(stripeSql, /FROM PUBLIC, anon, authenticated/);
  assert.match(purchase, /\/rest\/v1\/rpc\/create_project_from_stripe_checkout/);
  assert.match(purchase, /serviceKey\(env\)/);
  assert.equal(planStripeCheckoutProject({ session: { object: "checkout.session", status: "complete", payment_status: "unpaid", id: "cs_test" }, lineItems: [], services: [], clientName: "Client" }).create, false);
  assert.match(integration, /employee executed Stripe project provisioning/);
  assert.match(integration, /employee project creation for an assigned client was allowed/);
  assert.match(integration, /assigned employee cannot read the administrator-created project/);
});

test("the authorization integration test isolates request identity on PostgreSQL 17", () => {
  assert.match(integration, /pg_policy\.polwithcheck are both pg_node_tree/);
  assert.match(integration, /pg_get_expr\(pol\.polwithcheck, pol\.polrelid\)/);
  assert.doesNotMatch(integration, /polwithcheck\[/);
  assert.match(integration, /set_config\('request\.jwt\.claim\.role', 'service_role', true\)/);
  assert.match(integration, /service-role claim leaked/);
  assert.match(integration, /set_config\('request\.jwt\.claim\.role', 'authenticated', true\)/);
  assert.match(integration, /employee identity lost before self-promotion/);
  assert.match(integration, /Those account fields cannot be changed here/);
  assert.match(integration, /Administrator access is required\./);
  assert.match(integration, /RETURNED_SQLSTATE/);
  assert.match(integration, /42501/);
  assert.doesNotMatch(integration, /\bCOMMIT\b/);
  assert.match(integration, /ROLLBACK;\s*$/);
});

test("the admin project screen is the only browser insert and it is mounted for administrators", () => {
  assert.match(adminProjects, /from\("projects"\)\.insert/);
  assert.match(adminPortal, /if \(administrator && isAdminPortalEligible\(authState\)\)/);
  assert.match(adminPortal, /mountAdminProjects\(\)/);
  const staff = readFileSync(new URL("./staff-workspace.js", import.meta.url), "utf8");
  assert.doesNotMatch(staff, /from\("projects"\)\.insert/);
  assert.match(staff, /from\("files"\)/);
  assert.match(staff, /from\("reports"\)/);
  assert.match(staff, /from\("support_requests"\)|from\("support_messages"\)/);
});
