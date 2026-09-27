import { INDUSTRIES, INTERESTS, MARKETS } from "./onboarding-catalog.js";
import { projectStatusLabel } from "./project-status.js";

export const CLIENT_STATUSES = ["onboarding", "lead", "active", "paused", "churned"];
export const CLIENT_SORTS = ["activity", "name", "contact", "status", "created"];
export const PAGE_SIZE = 20;

const STATUS_LABELS = {
  onboarding: "Onboarding",
  lead: "Lead",
  active: "Active",
  paused: "Paused",
  churned: "Churned"
};

const OPEN_PROJECT = new Set(["planned", "active", "on_hold"]);
const OPEN_RECURRING = new Set(["active", "trialing", "past_due"]);

const labelMap = (items) => new Map(items.map((item) => [item.id, item.label]));
const industryLabels = labelMap(INDUSTRIES);
const marketLabels = labelMap(MARKETS);
const interestLabels = labelMap(INTERESTS);

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || "Unknown";
}

export function choiceLabel(map, value) {
  if (!value) return "";
  return map.get(value) || String(value);
}

export function clientListRequest({ query = "", status = "all", sort = "activity", page = 1 } = {}) {
  const cleanStatus = status === "all" || CLIENT_STATUSES.includes(status) ? status : "all";
  return {
    p_query: String(query || "").trim().slice(0, 80),
    p_status: cleanStatus || "all",
    p_sort: CLIENT_SORTS.includes(sort) ? sort : "activity",
    p_page: Math.max(1, Number.parseInt(page, 10) || 1),
    p_page_size: PAGE_SIZE
  };
}

export function pageSummary({ page = 1, pageSize = PAGE_SIZE, total = 0 } = {}) {
  const size = Math.max(1, Number(pageSize) || PAGE_SIZE);
  const count = Math.max(0, Number(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return {
    page: current,
    pages,
    total: count,
    hasPrev: current > 1,
    hasNext: current < pages && count > 0
  };
}

export function safeAdminError(message) {
  const text = String(message || "");
  if (text.includes("Administrator access is required")) return "Administrator access is required.";
  if (text.includes("was not found")) return "That client account was not found.";
  if (text.includes("status filter")) return "Choose a client status filter.";
  if (text.includes("client sort")) return "Choose a client sort.";
  return "Clients could not be loaded. Try again.";
}

export function formatWhen(value) {
  if (!value) return "—";
  const text = String(value);
  const date = text.length <= 10 ? new Date(`${text.slice(0, 10)}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US");
}

export function formatMoney(cents, currency = "usd") {
  if (cents === null || cents === undefined || cents === "") return "—";
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "—";
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

export function onboardingLabel(step, completedAt) {
  if (Number(step) === 5) {
    return completedAt ? `Complete · ${formatWhen(completedAt)}` : "Complete";
  }
  if (!step) return "—";
  return `In progress · step ${step}`;
}

export function engagementSummary(row) {
  const labels = Array.isArray(row?.open_labels) ? row.open_labels.filter(Boolean) : [];
  if (labels.length) return labels.join(", ");
  if (row?.status === "lead") return "No active paid engagements";
  if (row?.status === "onboarding") return "Onboarding in progress";
  return "No recorded open engagement";
}

export function openEngagements(detail) {
  const oneTime = (detail?.engagements?.one_time || []).filter((item) => OPEN_PROJECT.has(item.project_status));
  const recurring = (detail?.engagements?.recurring || []).filter((item) => OPEN_RECURRING.has(item.status));
  return { oneTime, recurring };
}

export function lifecycleSummary(detail) {
  const status = detail?.status || "";
  const open = openEngagements(detail);
  const count = open.oneTime.length + open.recurring.length;
  const lines = [];
  if (status === "onboarding" && Number(detail?.onboarding_step) < 5) {
    lines.push("Onboarding is not complete.");
  }
  if (count === 0 && status === "lead") lines.push("No active paid engagements");
  else if (count === 0) lines.push("No open paid engagement is recorded for this account.");
  else lines.push(count === 1 ? "1 open paid engagement" : `${count} open paid engagements`);
  for (const item of open.oneTime) {
    const service = (item.services || []).filter(Boolean).join(", ") || item.project_name || "One-time service";
    lines.push(`${service} · One-time · ${projectStatusLabel(item.project_status)}`);
  }
  for (const item of open.recurring) {
    lines.push(`${item.product_name || "Recurring service"} · Recurring · ${String(item.status || "").replaceAll("_", " ")}`);
  }
  return { status, lines };
}

export function locationLine(detail) {
  const cityLine = [detail?.city, detail?.region, detail?.postal_code].filter(Boolean).join(", ");
  return [detail?.address_line, cityLine].filter(Boolean).join(" · ");
}

export function statusHtml(status) {
  const label = statusLabel(status);
  return `<span class="admin-status admin-status-${esc(status || "unknown")}"><span class="admin-status-mark" aria-hidden="true"></span>${esc(label)}</span>`;
}

function meta(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`;
}

export function clientCardHtml(row) {
  return `<article class="admin-client-card">
    <button type="button" class="admin-client-open" data-client="${esc(row.id)}">
      <span class="admin-client-name">${esc(row.name || "Account")}</span>
      <span class="admin-client-contact">${esc(row.contact_name || "No contact name")}</span>
    </button>
    <dl class="admin-client-meta">
      ${meta("Email", row.email)}
      ${meta("Phone", row.phone)}
      <div class="admin-client-status"><dt>Status</dt><dd>${statusHtml(row.status)}</dd></div>
      ${meta("Primary service", row.primary_service)}
      ${meta("Engagement", engagementSummary(row))}
      ${meta("Onboarding", onboardingLabel(row.onboarding_step, row.onboarding_completed_at))}
      ${meta("Created", formatWhen(row.created_at))}
      ${meta("Last activity", formatWhen(row.last_activity))}
    </dl>
  </article>`;
}

export function emptyClientsHtml({ query, status, error, loading }) {
  if (loading) return `<p class="admin-clients-note" role="status">Loading clients…</p>`;
  if (error) return `<p class="admin-clients-note" role="alert">${esc(error)}</p>`;
  if (query || (status && status !== "all")) {
    return `<p class="admin-clients-note">No accounts match this search.</p>`;
  }
  return `<p class="admin-clients-note">No client accounts yet.</p>`;
}

export function pagerHtml(summary) {
  const noun = summary.total === 1 ? "account" : "accounts";
  return `<nav class="admin-client-pager" aria-label="Client pages">
    <button type="button" class="secondary-button" id="admin-clients-prev" ${summary.hasPrev ? "" : "disabled"}>Previous</button>
    <p>Page ${summary.page} of ${summary.pages} · ${summary.total} ${noun}</p>
    <button type="button" class="secondary-button" id="admin-clients-next" ${summary.hasNext ? "" : "disabled"}>Next</button>
  </nav>`;
}

function interestLine(detail) {
  const items = detail?.interests || [];
  if (!items.length) return "—";
  return items.map((item) => {
    const label = interestLabels.get(item.slug) || item.name || item.slug;
    return item.is_primary ? `${label} (primary)` : label;
  }).join(", ");
}

function engagementCards(detail) {
  const oneTime = detail?.engagements?.one_time || [];
  const recurring = detail?.engagements?.recurring || [];
  const recurringProjects = detail?.engagements?.recurring_projects || [];
  if (!oneTime.length && !recurring.length && !recurringProjects.length) {
    return `<p class="admin-clients-note">No service engagements recorded for this account.</p>`;
  }
  const oneTimeHtml = oneTime.map((item) => `<article class="admin-card">
      <p class="admin-card-label">One-time</p>
      <h3>${esc((item.services || []).join(", ") || item.project_name || "Service")}</h3>
      <dl>
        ${meta("Project", item.project_name)}
        ${meta("Project status", projectStatusLabel(item.project_status))}
        ${meta("Payment", "Paid in full")}
        ${meta("Purchased", formatWhen(item.purchased_at))}
        ${meta("Start", formatWhen(item.starts_on))}
        ${meta("End", formatWhen(item.ends_on))}
        ${meta("Checkout", item.checkout_session_id)}
      </dl>
      <button type="button" class="admin-text-button" data-open-project="${esc(item.project_id)}">Open project</button>
    </article>`).join("");
  const recurringHtml = recurring.map((item) => `<article class="admin-card">
      <p class="admin-card-label">Recurring</p>
      <h3>${esc(item.product_name || "Recurring service")}</h3>
      <dl>
        ${meta("Subscription", String(item.status || "").replaceAll("_", " "))}
        ${meta("Renews or ends", formatWhen(item.current_period_end))}
        ${meta("Cancels at period end", item.cancel_at_period_end ? "Yes" : "No")}
        ${meta("Subscription reference", item.subscription_id)}
      </dl>
    </article>`).join("");
  const projectHtml = recurringProjects.map((item) => `<article class="admin-card">
      <p class="admin-card-label">Recurring project</p>
      <h3>${esc(item.project_name || "Project")}</h3>
      <dl>
        ${meta("Services", (item.services || []).join(", "))}
        ${meta("Project status", projectStatusLabel(item.project_status))}
        ${meta("Purchased", formatWhen(item.purchased_at))}
      </dl>
      <button type="button" class="admin-text-button" data-open-project="${esc(item.project_id)}">Open project</button>
    </article>`).join("");
  return `<div class="admin-client-stack">${oneTimeHtml}${recurringHtml}${projectHtml}</div>`;
}

export function detailHtml(detail) {
  const summary = lifecycleSummary(detail);
  const invoices = detail?.billing?.invoices || [];
  const projects = detail?.projects || [];
  const files = detail?.files || [];
  const reports = detail?.reports || [];
  return `<div class="admin-clients-head">
      <div>
        <button type="button" class="admin-text-button" id="admin-clients-back">All clients</button>
        <h1 id="admin-clients-title">${esc(detail.name || "Client")}</h1>
      </div>
      ${statusHtml(detail.status)}
    </div>
    <section class="admin-card" aria-labelledby="client-state-heading">
      <h2 id="client-state-heading">${esc(statusLabel(detail.status))}</h2>
      ${summary.lines.map((line) => `<p>${esc(line)}</p>`).join("")}
    </section>
    <div class="admin-client-actions">
      <button type="button" class="secondary-button" id="admin-client-projects">View projects</button>
      <a class="secondary-button" href="staff-workspace.html">View files and support</a>
    </div>
    <section class="admin-card" aria-labelledby="client-overview-heading">
      <h2 id="client-overview-heading">Overview</h2>
      <dl class="admin-client-meta">
        ${meta("Business", detail.name)}
        ${meta("Legal name", detail.legal_name)}
        ${meta("Website", detail.website)}
        ${meta("Created", formatWhen(detail.created_at))}
        ${meta("Onboarding", onboardingLabel(detail.onboarding_step, detail.onboarding_completed_at))}
        ${meta("Location", locationLine(detail))}
      </dl>
    </section>
    <section class="admin-card" aria-labelledby="client-contact-heading">
      <h2 id="client-contact-heading">Contact</h2>
      <dl class="admin-client-meta">
        ${meta("Name", detail.contact_name)}
        ${meta("Email", detail.email)}
        ${meta("Phone", detail.phone)}
      </dl>
    </section>
    <section class="admin-card" aria-labelledby="client-business-heading">
      <h2 id="client-business-heading">Business and industry</h2>
      <dl class="admin-client-meta">
        ${meta("Industry", detail.industry_detail || choiceLabel(industryLabels, detail.industry))}
        ${meta("Market", (detail.markets || []).map((slug) => choiceLabel(marketLabels, slug)).filter(Boolean).join(", "))}
        ${meta("Market description", detail.market_summary)}
      </dl>
    </section>
    <section class="admin-card" aria-labelledby="client-services-heading">
      <h2 id="client-services-heading">Services</h2>
      <dl class="admin-client-meta">
        ${meta("Interests", interestLine(detail))}
        ${meta("Other service note", detail.interest_note)}
      </dl>
    </section>
    <section aria-labelledby="client-engagements-heading">
      <h2 id="client-engagements-heading">Engagements</h2>
      ${engagementCards(detail)}
    </section>
    <section aria-labelledby="client-projects-heading">
      <h2 id="client-projects-heading">Projects</h2>
      ${projects.length ? `<div class="admin-client-stack">${projects.map((project) => `<article class="admin-card">
        <h3>${esc(project.name)}</h3>
        <dl>${meta("Status", projectStatusLabel(project.status))}${meta("Services", (project.services || []).join(", "))}${meta("Billing", project.billing === "recurring" ? "Recurring" : project.billing === "one_time" ? "One-time" : "—")}${meta("Updated", formatWhen(project.updated_at))}</dl>
        <button type="button" class="admin-text-button" data-open-project="${esc(project.id)}">Open project</button>
      </article>`).join("")}</div>` : `<p class="admin-clients-note">No projects recorded for this account.</p>`}
    </section>
    <section aria-labelledby="client-files-heading">
      <h2 id="client-files-heading">Files</h2>
      ${files.length ? `<ul class="admin-client-records">${files.map((file) => `<li>${esc(file.file_name)} · ${esc(file.delivery_status || "file")} · ${esc(formatWhen(file.created_at))}</li>`).join("")}</ul>` : `<p class="admin-clients-note">No files recorded for this account.</p>`}
    </section>
    <section aria-labelledby="client-reports-heading">
      <h2 id="client-reports-heading">Reports</h2>
      ${reports.length ? `<ul class="admin-client-records">${reports.map((report) => `<li>${esc(report.title)} · ${esc(report.status)} · ${esc(formatWhen(report.period_start))}</li>`).join("")}</ul>` : `<p class="admin-clients-note">No reports recorded for this account.</p>`}
    </section>
    <section aria-labelledby="client-billing-heading">
      <h2 id="client-billing-heading">Billing</h2>
      <dl class="admin-client-meta">
        ${meta("Stripe customer", detail.billing?.stripe_customer_id || (detail.billing?.customer_on_file ? "On file" : "Not on file"))}
      </dl>
      ${invoices.length ? `<ul class="admin-client-records">${invoices.map((invoice) => `<li>${esc(invoice.status || "invoice")} · ${esc(formatMoney(invoice.amount_paid, invoice.currency))} paid · ${esc(formatWhen(invoice.created_at))}</li>`).join("")}</ul>` : `<p class="admin-clients-note">No invoices recorded for this account.</p>`}
      <p class="admin-clients-note">Payment state comes from Stripe. This screen does not mark invoices paid.</p>
    </section>`;
}
