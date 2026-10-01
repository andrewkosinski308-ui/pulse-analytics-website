import {
  initAuth,
  subscribeAuth,
  signOut,
  updatePassword,
  updateEmail,
  isClientPortalEligible,
  clientEntryPath,
  getAuthState,
  getSupabase,
  getSiteRootPrefix
} from "./pulse-auth.js";
import {
  FILE_CATEGORIES,
  assertAllowedFile,
  assertCategory,
  assertOptionalText,
  isUuid,
  reportDownloadLabel,
  sharedStoragePath
} from "./file-rules.js";
import { projectGroup, projectStatusLabel } from "./project-status.js";
import {
  businessFieldsHtml,
  businessPayload,
  emailChangeRequest,
  interestFieldsHtml,
  marketFieldsHtml,
  personalFieldsHtml,
  personalPayload,
  readInterestForm,
  readMarketForm,
  readPersonalForm,
  serviceChangeRequest
} from "./account-profile.js";
import { SERVICE_OFFERS, ladderMoves, offerName } from "./service-offers.js";

const loginHref = `${getSiteRootPrefix()}client-login.html`;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function fmtDay(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleDateString();
}

function pageHead(title, lead) {
  return `<div class="portal-page-head"><h2>${esc(title)}</h2>${lead ? `<p class="portal-lead">${esc(lead)}</p>` : ""}</div>`;
}

function statusBadge(value) {
  const raw = String(value || "");
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  return `<span class="portal-status" data-status="${esc(key)}">${statusLabel(raw || "—")}</span>`;
}

function shortDay(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function fmtPeriod(start, end) {
  const startDate = shortDay(start);
  const endDate = shortDay(end);
  if (!startDate || !endDate) return `${fmtDay(start)} – ${fmtDay(end)}`;
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    const month = startDate.toLocaleDateString(undefined, { month: "short" });
    return `${month} ${startDate.getDate()}–${endDate.getDate()}, ${endDate.getFullYear()}`;
  }
  if (sameYear) {
    const left = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const right = endDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${left} – ${right}, ${endDate.getFullYear()}`;
  }
  const full = { month: "short", day: "numeric", year: "numeric" };
  return `${startDate.toLocaleDateString(undefined, full)} – ${endDate.toLocaleDateString(undefined, full)}`;
}

function fmtPublished(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function money(cents, currency) {
  if (!Number.isFinite(cents)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase()
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ""}`.trim();
  }
}

function parseRoute() {
  const raw = (location.hash || "#dashboard").replace(/^#/, "");
  const [view, id] = raw.split("/");
  const allowed = new Set([
    "dashboard",
    "reports",
    "projects",
    "files",
    "billing",
    "support",
    "account",
    "notifications"
  ]);
  return { view: allowed.has(view) ? view : "dashboard", id: id || "" };
}

function isOwner() {
  return getAuthState().membership?.member_role === "owner";
}

function clientId() {
  return getAuthState().client?.id || "";
}

function showAlert(message, kind = "error") {
  const el = document.getElementById("portal-alert");
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = message;
}

function setViewHtml(html) {
  const view = document.getElementById("portal-view");
  view.innerHTML = html;
}

function statusLabel(value) {
  return esc(projectStatusLabel(value));
}

async function query(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message || "The portal could not load this information.");
  return data || [];
}

async function refreshUnread() {
  const badge = document.getElementById("unread-count");
  const { count, error } = await getSupabase()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error || !badge) return;
  badge.textContent = count ? String(count) : "";
  badge.hidden = !count;
}

async function renderDashboard() {
  const id = clientId();
  const auth = getAuthState();
  const sb = getSupabase();
  const [reports, projects, files, subs] = await Promise.all([
    query(
      sb.from("reports")
        .select("id,title,report_type,published_at")
        .eq("client_id", id)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(5)
    ),
    query(
      sb.from("projects")
        .select("id,name,status,project_services(services(name))")
        .eq("client_id", id)
        .in("status", ["planned", "active", "on_hold"])
        .order("updated_at", { ascending: false })
        .limit(5)
    ),
    query(
      sb.from("files")
        .select("id,file_name,category,delivery_status,created_at")
        .eq("client_id", id)
        .in("delivery_status", ["sent", "received"])
        .order("created_at", { ascending: false })
        .limit(5)
    ),
    query(
      sb.from("client_subscriptions")
        .select("status,product_name,current_period_end")
        .eq("client_id", id)
        .order("updated_at", { ascending: false })
        .limit(3)
    )
  ]);
  const services = [
    ...new Set(
      projects.flatMap((project) =>
        (project.project_services || []).map((row) => row.services?.name).filter(Boolean)
      )
    )
  ];
  const cards = [
    ["Company", auth.client?.name || "—"],
    ["Account status", auth.client?.status || "—"],
    ["Membership", auth.membership?.member_role || "—"],
    ["Published reports", String(reports.length ? `${reports.length} recent` : "None yet")],
    ["Active work", String(projects.length ? `${projects.length} open` : "None yet")],
    ["Billing", subs[0]?.product_name || subs[0]?.status || "Not synced"]
  ];
  setViewHtml(`
    ${pageHead("Dashboard", `Signed in as ${auth.profile?.full_name || auth.profile?.email || "Client"}.`)}
    <div class="portal-stats">
      ${cards.map(([label, value]) => `<article class="portal-stat"><p>${esc(label)}</p><strong>${label === "Account status" ? statusBadge(value) : esc(value)}</strong></article>`).join("")}
    </div>
    <section class="portal-card portal-card-static">
      <h3>Active services</h3>
      ${services.length ? `<ul>${services.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>` : `<p class="portal-empty">No active project services are on file.</p>`}
    </section>
    <div class="portal-columns">
      ${listBlock("Recent reports", reports, (row) => `<a href="#reports/${esc(row.id)}">${esc(row.title)}</a>`, "No published reports yet.")}
      ${listBlock("Projects", projects, (row) => `<a href="#projects/${esc(row.id)}">${esc(row.name)}</a> ${statusBadge(row.status)}`, "No open projects yet.")}
      ${listBlock("Files", files, (row) => `<a href="#files">${esc(row.file_name)}</a>`, "No client files yet.")}
    </div>
    <div class="portal-button-row">
      ${["projects", "files", "reports", "billing", "support", "account"].map((item) => `<a class="secondary-button" href="#${item}">${esc(item[0].toUpperCase() + item.slice(1))}</a>`).join("")}
      ${isOwner() ? `<a class="primary-button" href="#files">Upload File</a>` : ""}
    </div>
  `);
}

function listBlock(title, rows, render, empty) {
  return `<section class="portal-card"><h3>${esc(title)}</h3>${
    rows.length
      ? `<ul>${rows.map((row) => `<li>${render(row)}</li>`).join("")}</ul>`
      : `<p class="portal-empty">${esc(empty)}</p>`
  }</section>`;
}

async function renderReports(reportId) {
  const sb = getSupabase();
  if (reportId) {
    const rows = await query(
      sb.from("reports")
        .select("id,title,report_type,period_start,period_end,published_at,summary,status")
        .eq("id", reportId)
        .eq("client_id", clientId())
        .eq("status", "published")
        .limit(1)
    );
    const report = rows[0];
    if (!report) {
      setViewHtml(`${pageHead("Report")}<p class="portal-empty">That report is not available.</p><p class="portal-back"><a href="#reports">Back to reports</a></p>`);
      return;
    }
    const files = await query(
      sb.from("files")
        .select("id,file_name,mime_type,delivery_status")
        .eq("client_id", clientId())
        .eq("report_id", report.id)
        .in("delivery_status", ["sent", "received"])
    );
    setViewHtml(`
      <p class="portal-back"><a href="#reports">All reports</a></p>
      ${pageHead(report.title, report.summary || "No summary was provided.")}
      ${reportCard(report, files, { omitHeading: true })}
    `);
    bindReportDownloads();
    return;
  }
  const rows = await query(
    sb.from("reports")
      .select("id,title,report_type,period_start,period_end,published_at,summary,files(id,file_name,mime_type,delivery_status)")
      .eq("client_id", clientId())
      .eq("status", "published")
      .order("period_end", { ascending: false })
  );
  setViewHtml(`
    ${pageHead("Reports", "Formal documents published by Pulse Analytics.")}
    ${rows.length ? `<div class="portal-stack">${rows.map((row) => reportCard(row, row.files || [])).join("")}</div>` : `<p class="portal-empty">No published reports are available yet.</p>`}
  `);
  bindReportDownloads();
}

function reportCard(report, files, options = {}) {
  const documents = (files || []).filter((file) => file.delivery_status === "sent" || file.delivery_status === "received");
  const downloads = documents.map((file) => {
    const label = reportDownloadLabel(file.file_name, file.mime_type);
    return label ? `<button type="button" class="secondary-button" data-report="${esc(report.id)}" data-report-file="${esc(file.id)}">${esc(label)}</button>` : "";
  }).filter(Boolean);
  return `<article class="portal-card">
    ${options.omitHeading ? "" : `<h3><a href="#reports/${esc(report.id)}">${esc(report.title)}</a></h3>
    <p class="portal-summary">${esc(report.summary || "No summary was provided.")}</p>`}
    <dl class="portal-meta portal-meta-grid">
      <div><dt>Type</dt><dd>${esc(report.report_type)}</dd></div>
      <div><dt>Period</dt><dd>${esc(fmtPeriod(report.period_start, report.period_end))}</dd></div>
      <div><dt>Published</dt><dd>${esc(fmtPublished(report.published_at))}</dd></div>
    </dl>
    <div class="portal-documents">
      <p class="portal-kicker">Available Documents</p>
      ${downloads.length ? `<div class="portal-button-row">${downloads.join("")}</div>` : `<p class="portal-empty">No document is available for download.</p>`}
    </div>
  </article>`;
}

function bindReportDownloads() {
  document.querySelectorAll("[data-report-file]").forEach((button) => {
    button.addEventListener("click", () => downloadReportDocument(button.getAttribute("data-report"), button.getAttribute("data-report-file")));
  });
}

async function downloadReportDocument(reportId, fileId) {
  showAlert("");
  if (!isUuid(reportId) || !isUuid(fileId)) {
    showAlert("This document could not be downloaded.");
    return;
  }
  const sb = getSupabase();
  const reports = await query(
    sb.from("reports").select("id").eq("id", reportId).eq("client_id", clientId()).eq("status", "published").limit(1)
  );
  if (!reports[0]) {
    showAlert("That report is not available.");
    return;
  }
  const files = await query(
    sb.from("files")
      .select("storage_path")
      .eq("id", fileId)
      .eq("report_id", reportId)
      .eq("client_id", clientId())
      .in("delivery_status", ["sent", "received"])
      .limit(1)
  );
  const path = files[0]?.storage_path;
  if (!path) {
    showAlert("This document could not be downloaded.");
    return;
  }
  const { data, error } = await sb.storage.from("client-files").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    showAlert(error?.message || "This document could not be downloaded.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

let projectListGroup = "all";

function projectCards(rows, emptyText) {
  if (!rows.length) return `<p class="portal-empty">${emptyText}</p>`;
  return `<div class="portal-project-list">${rows.map((row) => {
    const services = (row.project_services || []).map((item) => item.services?.name).filter(Boolean).join(", ");
    const group = projectGroup(row.status);
    return `<article class="portal-card portal-project-card">
      <p class="portal-kicker">${group === "closed" ? "History" : "Open work"}</p>
      <h3><a href="#projects/${esc(row.id)}">${esc(row.name)}</a></h3>
      <p>${statusBadge(row.status)}</p>
      <dl class="portal-meta portal-meta-grid">
        <div><dt>Services</dt><dd>${esc(services || "—")}</dd></div>
        <div><dt>Dates</dt><dd>${fmtDay(row.starts_on)} – ${fmtDay(row.ends_on)}</dd></div>
      </dl>
    </article>`;
  }).join("")}</div>`;
}

async function renderProjects(projectId) {
  const sb = getSupabase();
  if (projectId) {
    const rows = await query(
      sb.from("projects")
        .select("id,name,status,starts_on,ends_on,summary,project_services(services(name))")
        .eq("id", projectId)
        .eq("client_id", clientId())
        .limit(1)
    );
    const project = rows[0];
    if (!project) {
      setViewHtml(`${pageHead("Project")}<p class="portal-empty">That project is not available.</p>`);
      return;
    }
    const files = await query(
      sb.from("files")
        .select("id,file_name,storage_path")
        .eq("client_id", clientId())
        .eq("project_id", project.id)
        .in("delivery_status", ["sent", "received"])
    );
    const services = (project.project_services || []).map((row) => row.services?.name).filter(Boolean);
    setViewHtml(`
      <p class="portal-back"><a href="#projects">All projects</a></p>
      ${pageHead(project.name, project.summary || "No client summary was provided.")}
      <p class="portal-kicker">${projectGroup(project.status) === "closed" ? "Project history" : "Open work"}</p>
      <article class="portal-card portal-card-static">
        <dl class="portal-meta portal-meta-grid">
          <div><dt>Status</dt><dd>${statusBadge(project.status)}</dd></div>
          <div><dt>Dates</dt><dd>${fmtDay(project.starts_on)} – ${fmtDay(project.ends_on)}</dd></div>
          <div><dt>Services</dt><dd>${services.length ? esc(services.join(", ")) : "—"}</dd></div>
        </dl>
        <h3>Files</h3>
        ${files.length ? `<ul class="portal-file-list">${files.map((file) => `<li><span>${esc(file.file_name)}</span> <button type="button" class="secondary-button" data-download="${esc(file.storage_path)}">Download</button></li>`).join("")}</ul>` : `<p class="portal-empty">No client-visible files are attached.</p>`}
      </article>
    `);
    bindDownloads();
    return;
  }
  const rows = await query(
    sb.from("projects")
      .select("id,name,status,starts_on,ends_on,summary,project_services(services(name))")
      .eq("client_id", clientId())
      .order("updated_at", { ascending: false })
  );
  const visible = rows.filter((row) => projectListGroup === "all" || projectGroup(row.status) === projectListGroup);
  const openRows = visible.filter((row) => projectGroup(row.status) === "open");
  const historyRows = visible.filter((row) => projectGroup(row.status) === "closed");
  setViewHtml(`
    ${pageHead("Projects", "Open work stays separate from completed and cancelled history.")}
    <div class="portal-project-filters" role="group" aria-label="Project history">
      ${[["all", "All"], ["open", "Open"], ["closed", "History"]].map(([value, label]) => `<button type="button" class="portal-filter${projectListGroup === value ? " is-current" : ""}" data-project-group="${value}">${label}</button>`).join("")}
    </div>
    ${rows.length ? (projectListGroup === "all"
      ? `<section><h3>Open work</h3>${projectCards(openRows, "No open projects.")}</section><section><h3>History</h3>${projectCards(historyRows, "No completed or cancelled projects.")}</section>`
      : projectCards(visible, projectListGroup === "closed" ? "No completed or cancelled projects." : "No open projects.")) : `<p class="portal-empty">No projects are available yet.</p>`}
  `);
  document.querySelectorAll("[data-project-group]").forEach((button) => {
    button.addEventListener("click", () => {
      projectListGroup = button.getAttribute("data-project-group") || "all";
      renderProjects();
    });
  });
}

function bindDownloads() {
  document.querySelectorAll("[data-download]").forEach((button) => {
    button.addEventListener("click", () => downloadFile(button.getAttribute("data-download")));
  });
}

async function downloadFile(path) {
  showAlert("");
  const { data, error } = await getSupabase().storage.from("client-files").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    showAlert(error?.message || "This file could not be downloaded.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function renderFiles() {
  const rows = await query(
    getSupabase()
      .from("files")
      .select("id,file_name,category,description,client_message,delivery_status,direction,created_at,storage_path")
      .eq("client_id", clientId())
      .is("report_id", null)
      .in("delivery_status", ["sent", "received"])
      .order("created_at", { ascending: false })
  );
  const owner = isOwner();
  setViewHtml(`
    ${pageHead("Files", "Files Pulse Analytics has sent you, and files you have uploaded.")}
    ${owner ? `<form id="client-upload" class="portal-form portal-card portal-card-static">
      <label>Category<select name="category" required>${FILE_CATEGORIES.map((item) => `<option>${esc(item)}</option>`).join("")}</select></label>
      <label>Message<textarea name="message" maxlength="2000"></textarea></label>
      <label>File<input name="file" type="file" required></label>
      <button class="primary-button" type="submit">Upload File</button>
    </form>` : `<p class="portal-empty">Your membership is view-only, so you can download files but not upload them.</p>`}
    ${rows.length ? `<div class="portal-card portal-card-static"><div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>File</th><th>Category</th><th>Direction</th><th>When</th><th></th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td data-label="File"><span class="portal-file-name">${esc(row.file_name)}</span>${row.client_message || row.description ? `<small>${esc(row.client_message || row.description || "")}</small>` : ""}</td><td data-label="Category">${esc(row.category || "—")}</td><td data-label="Direction">${row.direction === "client_to_staff" ? "Uploaded by you" : "From Pulse Analytics"}</td><td data-label="When">${esc(fmtDate(row.created_at))}</td><td data-label="Download"><button type="button" class="secondary-button" data-download="${esc(row.storage_path)}">Download</button></td></tr>`).join("")}
    </tbody></table></div></div>` : `<p class="portal-empty">No files are available yet.</p>`}
  `);
  bindDownloads();
  document.getElementById("client-upload")?.addEventListener("submit", uploadClientFile);
}

async function uploadClientFile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  showAlert("");
  button.disabled = true;
  try {
    const file = form.file.files[0];
    const checked = assertAllowedFile(file);
    const category = assertCategory(form.category.value);
    const message = assertOptionalText(form.message.value, "Message");
    const id = crypto.randomUUID();
    const path = sharedStoragePath(clientId(), id, checked.safeName);
    const inserted = await getSupabase().from("files").insert({
      id,
      bucket: "client-files",
      storage_path: path,
      file_name: checked.safeName,
      mime_type: checked.mime,
      size_bytes: checked.size,
      uploaded_by: getAuthState().user.id,
      client_id: clientId(),
      direction: "client_to_staff",
      category,
      client_message: message,
      delivery_status: "received"
    });
    if (inserted.error) throw new Error(inserted.error.message);
    const uploaded = await getSupabase().storage.from("client-files").upload(path, file, {
      contentType: checked.mime,
      upsert: false
    });
    if (uploaded.error) {
      await getSupabase().from("files").delete().eq("id", id);
      throw new Error(uploaded.error.message);
    }
    showAlert("Your file was uploaded.", "success");
    await renderFiles();
  } catch (error) {
    showAlert(error.message || "The file could not be uploaded.");
    button.disabled = false;
  }
}

async function renderBilling() {
  setViewHtml(`${pageHead("Billing")}<p class="portal-loading-inline">Loading billing from Stripe…</p>`);
  const session = await getSupabase().auth.getSession();
  const token = session.data.session?.access_token;
  const response = await fetch("/api/billing/summary", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Billing could not be loaded.");
  const subs = body.subscriptions || [];
  const invoices = body.invoices || [];
  setViewHtml(`
    ${pageHead("Billing", `${body.clientName || "Your account"}. Stripe is the billing record.`)}
    ${body.memberRole === "owner" ? `<div class="portal-button-row"><button type="button" class="primary-button" id="open-portal">Manage billing in Stripe</button></div>` : `<p class="portal-empty">Billing management is available to the client owner. You can still review status below.</p>`}
    ${body.memberRole === "owner" ? serviceChangeHtml(subs) : ""}
    <section class="portal-card portal-card-static">
      <h3>Subscriptions</h3>
      ${subs.length ? `<ul class="portal-record-list">${subs.map((row) => `<li><span>${esc(row.productName || "Subscription")}</span> ${statusBadge(row.status)}${row.currentPeriodEnd ? `<span class="portal-time">through ${esc(fmtDate(row.currentPeriodEnd))}</span>` : ""}</li>`).join("")}</ul>` : `<p class="portal-empty">No subscription is synced for this client.</p>`}
    </section>
    <section class="portal-card portal-card-static">
      <h3>Invoices</h3>
      ${invoices.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Date</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>
        ${invoices.map((row) => `<tr><td data-label="Date">${esc(fmtDate(row.createdAt))}</td><td data-label="Status">${statusBadge(row.status)}</td><td data-label="Amount">${esc(money(row.amountDue, row.currency))}</td><td data-label="Invoice">${row.hostedInvoiceUrl ? `<a href="${esc(row.hostedInvoiceUrl)}" target="_blank" rel="noopener">View invoice</a>` : ""}${row.invoicePdf ? ` <a href="${esc(row.invoicePdf)}" target="_blank" rel="noopener">PDF</a>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="portal-empty">No invoices are synced yet.</p>`}
    </section>
  `);
  document.getElementById("open-portal")?.addEventListener("click", openBillingPortal);
  document.getElementById("service-add")?.addEventListener("submit", (event) => submitServiceChange(event, "add"));
  document.querySelectorAll("[data-service-change]").forEach((form) => {
    form.addEventListener("submit", (event) => submitServiceChange(event, form.getAttribute("data-service-change")));
  });
  document.querySelectorAll("[data-remove-service]").forEach((button) => {
    button.addEventListener("click", () => submitServiceChange(null, "remove", button.getAttribute("data-remove-service")));
  });
}

function serviceChangeHtml(subs) {
  const offers = SERVICE_OFFERS.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const plans = (subs || []).map((sub) => {
    const moves = ladderMoves(sub.catalogId);
    const options = (ids) => ids.map((id) => `<option value="${esc(id)}">${esc(offerName(id))}</option>`).join("");
    return `<li>
      <strong>${esc(sub.productName || "Subscription")}</strong> ${statusBadge(sub.status)}
      ${moves.upgrades.length ? `<form data-service-change="upgrade"><input type="hidden" name="subscriptionId" value="${esc(sub.id)}"><label>Upgrade<select name="catalogId">${options(moves.upgrades)}</select></label><button class="secondary-button" type="submit">Upgrade</button></form>` : ""}
      ${moves.downgrades.length ? `<form data-service-change="downgrade"><input type="hidden" name="subscriptionId" value="${esc(sub.id)}"><label>Downgrade<select name="catalogId">${options(moves.downgrades)}</select></label><button class="secondary-button" type="submit">Downgrade</button></form>` : ""}
      <button type="button" class="secondary-button" data-remove-service="${esc(sub.id)}">Remove at period end</button>
    </li>`;
  }).join("");
  return `<section class="portal-card portal-card-static">
    <h3>Change services</h3>
    <p>Stripe confirms each change. This page does not mark a service paid or active.</p>
    <form id="service-add" class="portal-form">
      <label>Add a service<select name="catalogId">${offers}</select></label>
      <button class="secondary-button" type="submit">Start checkout</button>
    </form>
    ${plans ? `<ul class="portal-record-list">${plans}</ul>` : `<p class="portal-empty">Plan changes appear here after a subscription is synced.</p>`}
  </section>`;
}

async function submitServiceChange(event, action, subscriptionId) {
  event?.preventDefault();
  showAlert("");
  const form = event?.currentTarget;
  const requested = serviceChangeRequest({
    action,
    catalogId: form?.catalogId?.value || "",
    subscriptionId: subscriptionId || form?.subscriptionId?.value || ""
  });
  if (requested.error) return showAlert(requested.error);
  const button = form?.querySelector("button") || event?.currentTarget;
  if (button) button.disabled = true;
  const session = await getSupabase().auth.getSession();
  const response = await fetch("/api/billing/service-change", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.data.session?.access_token || ""}`
    },
    body: JSON.stringify(requested)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (button) button.disabled = false;
    return showAlert(body.error || "That service could not be changed.");
  }
  if (body.url) {
    window.location.assign(body.url);
    return;
  }
  showAlert("Stripe is confirming that change. Billing will update after Stripe does.", "success");
  await renderBilling();
}

async function openBillingPortal() {
  showAlert("");
  const session = await getSupabase().auth.getSession();
  const response = await fetch("/api/billing/portal", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.data.session?.access_token}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) {
    showAlert(body.error || "Stripe billing management could not be opened.");
    return;
  }
  window.location.assign(body.url);
}

async function renderSupport(requestId) {
  const sb = getSupabase();
  if (requestId) {
    const requests = await query(
      sb.from("support_requests").select("id,subject,status,created_at").eq("id", requestId).eq("client_id", clientId()).limit(1)
    );
    const request = requests[0];
    if (!request) {
      setViewHtml(`${pageHead("Support")}<p class="portal-empty">That request is not available.</p>`);
      return;
    }
    const messages = await query(
      sb.from("support_messages").select("id,body,created_at,author_id").eq("request_id", request.id).order("created_at")
    );
    setViewHtml(`
      <p class="portal-back"><a href="#support">All requests</a></p>
      ${pageHead(request.subject)}
      <p class="portal-status-line">Status ${statusBadge(request.status)}</p>
      <ol class="portal-thread">${messages.map((message) => `<li class="portal-card portal-card-static"><span class="portal-time">${esc(fmtDate(message.created_at))}</span><p>${esc(message.body)}</p></li>`).join("")}</ol>
      ${isOwner() && request.status !== "resolved" ? `<form id="support-reply" class="portal-form portal-card portal-card-static"><label>Reply<textarea name="body" required maxlength="5000"></textarea></label><button class="primary-button" type="submit">Send reply</button></form>` : ""}
    `);
    document.getElementById("support-reply")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = assertOptionalText(event.currentTarget.body.value, "Reply", 5000);
      if (!body) return showAlert("Enter a message.");
      const inserted = await sb.from("support_messages").insert({
        request_id: request.id,
        author_id: getAuthState().user.id,
        body
      });
      if (inserted.error) return showAlert(inserted.error.message);
      await renderSupport(request.id);
    });
    return;
  }
  const rows = await query(
    sb.from("support_requests").select("id,subject,status,created_at").eq("client_id", clientId()).order("created_at", { ascending: false })
  );
  setViewHtml(`
    ${pageHead("Support")}
    ${isOwner() ? `<form id="support-new" class="portal-form portal-card portal-card-static">
      <label>Subject<input name="subject" required maxlength="200"></label>
      <label>Message<textarea name="body" required maxlength="5000"></textarea></label>
      <button class="primary-button" type="submit">Submit request</button>
    </form>` : `<p class="portal-empty">View-only members can read requests. The client owner can submit new ones.</p>`}
    ${rows.length ? `<ul class="portal-request-list">${rows.map((row) => `<li class="portal-card"><a href="#support/${esc(row.id)}">${esc(row.subject)}</a> ${statusBadge(row.status)}</li>`).join("")}</ul>` : `<p class="portal-empty">No support requests yet.</p>`}
  `);
  document.getElementById("support-new")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showAlert("");
    const subject = String(form.subject.value || "").trim();
    const body = String(form.body.value || "").trim();
    if (!subject || !body) return showAlert("Enter a subject and message.");
    const created = await sb.from("support_requests").insert({
      client_id: clientId(),
      created_by: getAuthState().user.id,
      subject,
      status: "open"
    }).select("id").single();
    if (created.error) return showAlert(created.error.message);
    const message = await sb.from("support_messages").insert({
      request_id: created.data.id,
      author_id: getAuthState().user.id,
      body
    });
    if (message.error) return showAlert(message.error.message);
    location.hash = `support/${created.data.id}`;
  });
}

async function renderAccount() {
  const auth = getAuthState();
  const sb = getSupabase();
  const profileRows = await query(
    sb.from("profiles")
      .select("first_name,last_name,full_name,phone,timezone,notification_preferences")
      .eq("id", auth.user.id)
      .limit(1)
  );
  const profile = profileRows[0] || {};
  let client = {};
  let interests = [];
  let markets = [];
  let services = [];
  if (clientId()) {
    const clients = await query(
      sb.from("clients")
        .select("id,name,legal_name,website,industry,phone,address_line,city,region,postal_code,market_summary,industry_detail,interest_note,status")
        .eq("id", clientId())
        .limit(1)
    );
    client = clients[0] || {};
    interests = await query(
      sb.from("client_service_interests").select("slug,is_primary").eq("client_id", clientId())
    );
    markets = (await query(
      sb.from("client_market_focus").select("slug").eq("client_id", clientId())
    )).map((row) => row.slug);
    const projects = await query(
      sb.from("projects")
        .select("name,project_services(services(name))")
        .eq("client_id", clientId())
        .in("status", ["planned", "active", "on_hold"])
    );
    services = [...new Set(projects.flatMap((project) => (project.project_services || []).map((row) => row.services?.name).filter(Boolean)))];
  }
  const owner = isOwner();
  setViewHtml(`
    ${pageHead("Account")}
    <form id="email-form" class="portal-form portal-card portal-card-static">
      <h3>Email</h3>
      <p>This is the email you use to sign in. Supabase sends a confirmation before it changes.</p>
      <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(auth.user?.email || "")}"></label>
      <button class="secondary-button" type="submit">Update email</button>
    </form>
    <form id="profile-form" class="portal-form portal-card portal-card-static">
      <h3>Personal information</h3>
      ${personalFieldsHtml(profile)}
      <button class="primary-button" type="submit">Save personal information</button>
    </form>
    <article class="portal-card portal-card-static">
      <h3>Business information</h3>
      ${owner ? `<form id="business-form" class="portal-form">${businessFieldsHtml(client)}<button class="primary-button" type="submit">Save business information</button></form>` : `<p class="portal-empty">The client owner can edit business information.</p><dl class="portal-meta"><div><dt>Business</dt><dd>${esc(client.name || "—")}</dd></div></dl>`}
    </article>
    <article class="portal-card portal-card-static">
      <h3>Service interests</h3>
      <p>Interests describe what you want to explore. They do not purchase a service or change billing.</p>
      ${owner ? `<form id="interest-form" class="portal-form portal-choices">${interestFieldsHtml(interests)}<button class="primary-button" type="submit">Save interests</button></form>` : `<p class="portal-empty">The client owner can edit service interests.</p>`}
    </article>
    <article class="portal-card portal-card-static">
      <h3>Market focus</h3>
      ${owner ? `<form id="market-form" class="portal-form portal-choices">${marketFieldsHtml(markets)}<button class="primary-button" type="submit">Save market focus</button></form>` : `<p class="portal-empty">The client owner can edit market focus.</p>`}
    </article>
    <article class="portal-card portal-card-static">
      <h3>Active services</h3>
      <p>These are purchased services on open projects. Manage upgrades and new services in Billing.</p>
      ${services.length ? `<ul>${services.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>` : `<p class="portal-empty">No active project services are on file.</p>`}
      <p><a href="#billing">Open billing</a></p>
    </article>
    <form id="password-form" class="portal-form portal-card portal-card-static">
      <h3>Password</h3>
      <label>New password<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>Confirm password<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="secondary-button" type="submit">Update password</button>
      <p class="portal-inline-link"><a href="client-forgot-password.html">Forgot password</a></p>
    </form>
  `);
  document.getElementById("email-form").addEventListener("submit", saveEmail);
  document.getElementById("profile-form").addEventListener("submit", saveProfile);
  document.getElementById("business-form")?.addEventListener("submit", saveBusiness);
  document.getElementById("interest-form")?.addEventListener("submit", saveInterests);
  document.getElementById("market-form")?.addEventListener("submit", saveMarkets);
  document.getElementById("password-form").addEventListener("submit", savePassword);
}

async function saveEmail(event) {
  event.preventDefault();
  showAlert("");
  const requested = emailChangeRequest(event.currentTarget.email.value);
  if (requested.error) return showAlert(requested.error);
  const current = String(getAuthState().user?.email || "").toLowerCase();
  if (requested.email === current) return showAlert("That is already your sign-in email.");
  try {
    await updateEmail(requested.email);
    showAlert("Check your inbox to confirm the new email. Your sign-in email changes after you confirm it.", "success");
  } catch (error) {
    showAlert(error.message || "The email change could not be started.");
  }
}

async function saveProfile(event) {
  event.preventDefault();
  showAlert("");
  const payload = personalPayload(readPersonalForm(event.currentTarget));
  if (!payload.full_name) return showAlert("Enter your name.");
  const updated = await getSupabase().from("profiles").update(payload).eq("id", getAuthState().user.id);
  if (updated.error) return showAlert("Personal information could not be saved.");
  await getSupabase().rpc("record_own_security_event", { p_kind: "profile_updated" });
  showAlert("Personal information saved.", "success");
}

async function saveBusiness(event) {
  event.preventDefault();
  showAlert("");
  const payload = businessPayload(Object.fromEntries(new FormData(event.currentTarget).entries()));
  if (!payload.name) return showAlert("Enter the business name.");
  const updated = await getSupabase().from("clients").update(payload).eq("id", clientId());
  if (updated.error) return showAlert("Business information could not be saved.");
  showAlert("Business information saved.", "success");
}

async function saveInterests(event) {
  event.preventDefault();
  showAlert("");
  const updated = await getSupabase().rpc("save_client_service_interests", {
    p_client_id: clientId(),
    p_interests: readInterestForm(event.currentTarget)
  });
  if (updated.error) return showAlert("Service interests could not be saved.");
  showAlert("Service interests saved. This does not change your purchased services.", "success");
}

async function saveMarkets(event) {
  event.preventDefault();
  showAlert("");
  const updated = await getSupabase().rpc("save_client_market_focus", {
    p_client_id: clientId(),
    p_markets: readMarketForm(event.currentTarget)
  });
  if (updated.error) return showAlert("Market focus could not be saved.");
  showAlert("Market focus saved.", "success");
}

async function savePassword(event) {
  event.preventDefault();
  showAlert("");
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) return showAlert("Passwords do not match.");
  try {
    await updatePassword(form.password.value);
    await getSupabase().rpc("record_own_security_event", { p_kind: "password_changed" });
    form.reset();
    showAlert("Password updated.", "success");
  } catch (error) {
    showAlert(error.message || "Password could not be updated.");
  }
}

async function renderNotifications() {
  const rows = await query(
    getSupabase()
      .from("notifications")
      .select("id,title,body,link_path,read_at,created_at,entity_type")
      .order("created_at", { ascending: false })
      .limit(50)
  );
  setViewHtml(`
    ${pageHead("Notifications")}
    ${rows.length ? `<ul class="portal-notes">${rows.map((row) => `<li class="portal-card portal-card-static${row.read_at ? "" : " is-unread"}"><a href="${esc(row.link_path || "#notifications")}" data-read="${esc(row.id)}">${esc(row.title)}</a><p>${esc(row.body || "")}</p><span class="portal-time">${esc(fmtDate(row.created_at))}</span></li>`).join("")}</ul>` : `<p class="portal-empty">No notifications yet.</p>`}
  `);
  document.querySelectorAll("[data-read]").forEach((link) => {
    link.addEventListener("click", async () => {
      const id = link.getAttribute("data-read");
      await getSupabase().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
      await refreshUnread();
    });
  });
}

async function render() {
  const route = parseRoute();
  document.querySelectorAll(".portal-nav button").forEach((button) => {
    if (button.dataset.view === route.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  showAlert("");
  setViewHtml(`<p class="portal-loading-inline">Loading…</p>`);
  try {
    if (route.view === "dashboard") await renderDashboard();
    else if (route.view === "reports") await renderReports(route.id);
    else if (route.view === "projects") await renderProjects(route.id);
    else if (route.view === "files") await renderFiles();
    else if (route.view === "billing") await renderBilling();
    else if (route.view === "support") await renderSupport(route.id);
    else if (route.view === "account") await renderAccount();
    else await renderNotifications();
    await refreshUnread();
  } catch (error) {
    setViewHtml(`${pageHead(route.view)}<p class="portal-empty">This section could not be loaded.</p>`);
    showAlert(error.message || "Something went wrong.");
  }
}

function setPortalMenuOpen(open) {
  const menu = document.getElementById("portal-menu");
  const nav = document.getElementById("portal-nav");
  if (!menu || !nav) return;
  nav.classList.toggle("is-open", open);
  menu.setAttribute("aria-expanded", open ? "true" : "false");
  menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
}

function mountShell(auth) {
  const name = auth.profile?.full_name || auth.profile?.email || "Client";
  document.getElementById("portal-loading").hidden = true;
  const app = document.getElementById("portal-app");
  app.hidden = false;
  document.getElementById("portal-who").textContent = `${name} · ${auth.client?.name || "Client"}`;
  if (!app.dataset.ready) {
    app.dataset.ready = "1";
    app.querySelector(".portal-nav").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-view]");
      if (!button) return;
      setPortalMenuOpen(false);
      location.hash = button.dataset.view;
    });
    document.getElementById("portal-menu").addEventListener("click", () => {
      const menu = document.getElementById("portal-menu");
      setPortalMenuOpen(menu.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setPortalMenuOpen(false);
    });
    document.getElementById("portal-sign-out").addEventListener("click", async () => {
      try {
        await signOut();
        window.location.replace(loginHref);
      } catch (error) {
        showAlert(error.message || "Sign-out failed.");
      }
    });
    window.addEventListener("hashchange", () => {
      render();
    });
    if (!location.hash) location.hash = "dashboard";
    else render();
  }
}

export async function startClientPortal() {
  try {
    await initAuth();
  } catch (error) {
    const loading = document.getElementById("portal-loading");
    loading.textContent = error.message || "Unable to load the Client Portal.";
    setTimeout(() => window.location.replace(loginHref), 1500);
    return;
  }
  subscribeAuth((auth) => {
    if (auth.loading) return;
    const destination = clientEntryPath(auth);
    if (destination && destination !== "/client-portal.html") {
      window.location.replace(destination);
      return;
    }
    if (!isClientPortalEligible(auth)) {
      window.location.replace(loginHref);
      return;
    }
    mountShell(auth);
  });
}
