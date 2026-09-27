import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  clientCardHtml,
  clientListRequest,
  detailHtml,
  emptyClientsHtml,
  engagementSummary,
  lifecycleSummary,
  onboardingLabel,
  pageSummary,
  safeAdminError,
  statusLabel
} from "./admin-clients-view.js";

const directorySql = readFileSync(new URL("../supabase/migrations/20260927080000_admin_client_directory.sql", import.meta.url), "utf8");
const clientsJs = readFileSync(new URL("./admin-clients.js", import.meta.url), "utf8");
const portalHtml = readFileSync(new URL("../admin-portal.html", import.meta.url), "utf8");
const lifecycleSql = readFileSync(new URL("../supabase/migrations/20260927070000_client_lifecycle.sql", import.meta.url), "utf8");

const mixedAccount = {
  name: "Northwind Studio",
  status: "active",
  onboarding_step: 5,
  engagements: {
    one_time: [{
      project_id: "project-a",
      project_name: "Website",
      project_status: "completed",
      billing: "one_time",
      services: ["Website Development"],
      purchased_at: "2026-01-01",
      checkout_session_id: "cs_test_one"
    }],
    recurring: [{
      product_name: "SEO",
      status: "active",
      subscription_id: "sub_test",
      cancel_at_period_end: false
    }],
    recurring_projects: [{
      project_id: "project-b",
      project_name: "SEO retainer",
      project_status: "active",
      billing: "recurring",
      services: ["SEO"]
    }]
  },
  projects: [
    { id: "project-a", name: "Website", status: "completed", services: ["Website Development"], billing: "one_time" },
    { id: "project-b", name: "SEO retainer", status: "active", services: ["SEO"], billing: "recurring" }
  ],
  files: [{ file_name: "brief.pdf", delivery_status: "sent", created_at: "2026-02-01" }],
  reports: [{ title: "January report", status: "published", period_start: "2026-01-01" }],
  billing: {
    stripe_customer_id: "cus_test",
    invoices: [{ status: "paid", amount_paid: 29900, currency: "usd", created_at: "2026-03-01" }, { status: "paid", amount_paid: 29900, currency: "usd", created_at: "2026-04-01" }]
  },
  interests: [{ slug: "seo", name: "SEO", is_primary: true }]
};

test("unauthenticated and non-admin calls are rejected by the directory functions", () => {
  assert.match(directorySql, /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\)/);
  assert.match(directorySql, /Administrator access is required\./);
  assert.equal(portalHtml.includes("requireAdminPortal"), true);
  assert.equal(portalHtml.includes('id="nav-clients"'), true);
  assert.equal(portalHtml.includes("mountAdminClients"), true);
});

test("the clients screen loads through the admin list function and paginates", () => {
  assert.deepEqual(clientListRequest({ query: "  North ", status: "lead", sort: "name", page: 2 }), {
    p_query: "North",
    p_status: "lead",
    p_sort: "name",
    p_page: 2,
    p_page_size: 20
  });
  assert.equal(clientListRequest({ status: "nope", sort: "nope", page: 0 }).p_status, "all");
  assert.equal(pageSummary({ page: 2, pageSize: 20, total: 45 }).pages, 3);
  assert.equal(pageSummary({ page: 2, pageSize: 20, total: 45 }).hasPrev, true);
  assert.equal(pageSummary({ page: 3, pageSize: 20, total: 45 }).hasNext, false);
  assert.match(clientsJs, /admin_client_list/);
  assert.match(clientsJs, /admin_client_detail/);
});

test("search, filters, and empty results stay distinct from errors", () => {
  assert.match(emptyClientsHtml({ query: "missing", status: "all" }), /No accounts match this search/);
  assert.match(emptyClientsHtml({}), /No client accounts yet/);
  assert.match(emptyClientsHtml({ loading: true }), /Loading clients/);
  assert.match(emptyClientsHtml({ error: "Clients could not be loaded. Try again." }), /could not be loaded/);
  assert.equal(safeAdminError("ERROR: 42501: Administrator access is required."), "Administrator access is required.");
  assert.equal(safeAdminError("duplicate key value"), "Clients could not be loaded. Try again.");
});

test("status labels come from the account record and the screen cannot write status", () => {
  for (const [status, label] of [["lead", "Lead"], ["active", "Active"], ["paused", "Paused"], ["churned", "Churned"], ["onboarding", "Onboarding"]]) {
    assert.equal(statusLabel(status), label);
    assert.match(clientCardHtml({ id: "1", name: "Example", status, open_labels: [] }), new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(clientsJs, /\.from\(["']clients["']\)/);
  assert.doesNotMatch(clientsJs, /clients\.status|Make Active|Make Lead|Mark Paid|Verify Payment/);
  assert.doesNotMatch(directorySql, /UPDATE public\.clients/);
  assert.match(lifecycleSql, /Client status is assigned by the server/);
  assert.match(detailHtml(mixedAccount), /This screen does not mark invoices paid/);
});

test("detail keeps completed history, recurring renewals, and the server status", () => {
  const html = detailHtml(mixedAccount);
  assert.match(html, /Website Development/);
  assert.match(html, /Paid in full/);
  assert.match(html, /Completed/);
  assert.match(html, /SEO/);
  assert.match(html, />Active</);
  assert.match(html, /brief\.pdf/);
  assert.match(html, /January report/);
  assert.match(html, /\$299\.00 paid/);
  assert.equal((html.match(/SEO retainer/g) || []).length >= 1, true);
  const summary = lifecycleSummary(mixedAccount);
  assert.equal(summary.status, "active");
  assert.equal(summary.lines.some((line) => /therefore this is a lead/i.test(line)), false);
  assert.match(summary.lines.join(" "), /SEO/);
  assert.equal(engagementSummary({ status: "lead", open_labels: [] }), "No active paid engagements");
  assert.equal(onboardingLabel(5, "2026-01-02"), "Complete · 1/2/2026");
});

test("an account with one completed and one active engagement stays Active", () => {
  const summary = lifecycleSummary(mixedAccount);
  assert.equal(summary.status, "active");
  assert.match(summary.lines.join("\n"), /1 open paid engagement/);
  assert.match(summary.lines.join("\n"), /Recurring/);
  assert.match(detailHtml(mixedAccount), /One-time/);
  assert.equal(summary.lines.some((line) => line.startsWith("Website Development")), false);
});

test("the directory does not create a leads table or change lifecycle guards", () => {
  assert.doesNotMatch(directorySql, /CREATE TABLE public\.leads/i);
  assert.doesNotMatch(directorySql, /sync_client_engagement_status/);
  assert.equal(directorySql.includes("DROP TABLE"), false);
  assert.match(directorySql, /pp\.billing = 'one_time'/);
  assert.match(directorySql, /pp\.billing = 'recurring'/);
});
