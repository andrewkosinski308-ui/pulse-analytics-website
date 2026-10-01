import {
  signOut,
  getAuthState,
  getSupabase,
  requireAdminStaffPortal,
  subscribeAuth,
  isAdminPortalEligible,
  portalGuardDestination
} from "./pulse-auth.js";
import {
  FILE_CATEGORIES,
  assertAllowedFile,
  assertCategory,
  assertOptionalText,
  assertReportDocument,
  internalStoragePath,
  reportDownloadLabel,
  sharedStoragePath
} from "./file-rules.js";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showAlert(message, kind = "error") {
  const el = document.getElementById("staff-alert");
  el.hidden = !message;
  el.dataset.kind = kind;
  el.textContent = message || "";
}

async function downloadFile(path) {
  const { data, error } = await getSupabase().storage.from("client-files").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    showAlert(error?.message || "Download failed.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function loadClients() {
  const { data, error } = await getSupabase().from("clients").select("id,name,status").order("name");
  if (error) throw new Error(error.message);
  return data || [];
}

let activeClientId = "";

function selectedClientId() {
  return document.getElementById("staff-client")?.value || activeClientId || "";
}

function rememberClient() {
  const current = document.getElementById("staff-client")?.value;
  if (current) activeClientId = current;
}

async function renderFiles(clients) {
  const clientId = selectedClientId() || clients[0]?.id || "";
  const options = clients.map((client) => `<option value="${esc(client.id)}" ${client.id === clientId ? "selected" : ""}>${esc(client.name)}</option>`).join("");
  let rows = [];
  if (clientId) {
    const result = await getSupabase()
      .from("files")
      .select("id,file_name,category,delivery_status,direction,storage_path,created_at,client_message,description")
      .eq("client_id", clientId)
      .is("report_id", null)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    rows = result.data || [];
  }
  document.getElementById("staff-panel").innerHTML = `
    <form id="staff-upload" class="portal-form">
      <label>Client<select id="staff-client" name="client" required>${options || `<option value="">No assigned clients</option>`}</select></label>
      <label>Category<select name="category" required>${FILE_CATEGORIES.map((item) => `<option>${esc(item)}</option>`).join("")}</select></label>
      <label>Description<textarea name="description" maxlength="2000"></textarea></label>
      <label>Client message<textarea name="message" maxlength="2000"></textarea></label>
      <label>File<input name="file" type="file" required></label>
      <button class="primary-button" type="submit">Upload File</button>
      <p class="portal-empty">Upload keeps the file internal. Send to Client is a separate action.</p>
    </form>
    ${rows.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>File</th><th>Status</th><th>Direction</th><th></th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td>${esc(row.file_name)}<br><small>${esc(row.category || "")}</small></td>
        <td>${esc(row.delivery_status)}</td>
        <td>${esc(row.direction)}</td>
        <td>
          <button type="button" class="secondary-button" data-download="${esc(row.storage_path)}">Download</button>
          ${row.delivery_status === "internal" ? `<button type="button" class="primary-button" data-send="${esc(row.id)}" data-path="${esc(row.storage_path)}" data-name="${esc(row.file_name)}">Send to Client</button>` : ""}
        </td>
      </tr>`).join("")}
    </tbody></table></div>` : `<p class="portal-empty">${clientId ? "No files for this client yet." : "Choose a client."}</p>`}
  `;
  const select = document.getElementById("staff-client");
  if (clientId) select.value = clientId;
  select.addEventListener("change", () => renderFiles(clients).catch((error) => showAlert(error.message)));
  document.getElementById("staff-upload").addEventListener("submit", (event) => uploadStaffFile(event, clients));
  document.querySelectorAll("[data-download]").forEach((button) => {
    button.addEventListener("click", () => downloadFile(button.getAttribute("data-download")));
  });
  document.querySelectorAll("[data-send]").forEach((button) => {
    button.addEventListener("click", () => sendFile(button, clients));
  });
}

async function uploadStaffFile(event, clients) {
  event.preventDefault();
  const form = event.currentTarget;
  showAlert("");
  try {
    const destination = selectedClientId();
    if (!destination) throw new Error("Choose a client.");
    const file = form.file.files[0];
    const checked = assertAllowedFile(file);
    const category = assertCategory(form.category.value);
    const description = assertOptionalText(form.description.value, "Description");
    const message = assertOptionalText(form.message.value, "Client message");
    const id = crypto.randomUUID();
    const path = internalStoragePath(destination, id, checked.safeName);
    const inserted = await getSupabase().from("files").insert({
      id,
      bucket: "client-files",
      storage_path: path,
      file_name: checked.safeName,
      mime_type: checked.mime,
      size_bytes: checked.size,
      uploaded_by: getAuthState().user.id,
      client_id: destination,
      direction: "staff_to_client",
      category,
      description,
      client_message: message,
      delivery_status: "internal",
      notify_client: false
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
    showAlert("File uploaded and kept internal.", "success");
    await renderFiles(clients);
  } catch (error) {
    showAlert(error.message || "Upload failed.");
  }
}

async function sendFile(button, clients) {
  const notify = window.confirm("Notify the client about this file?");
  showAlert("");
  button.disabled = true;
  try {
    const id = button.getAttribute("data-send");
    const from = button.getAttribute("data-path");
    const name = button.getAttribute("data-name");
    const destination = selectedClientId();
    const shared = sharedStoragePath(destination, id, name);
    const moved = await getSupabase().storage.from("client-files").move(from, shared);
    if (moved.error) throw new Error(moved.error.message);
    const updated = await getSupabase().from("files").update({
      storage_path: shared,
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      notify_client: notify
    }).eq("id", id).eq("client_id", destination);
    if (updated.error) throw new Error(updated.error.message);
    showAlert(notify ? "File sent and the client was notified." : "File sent without a notification.", "success");
    await renderFiles(clients);
  } catch (error) {
    showAlert(error.message || "Send failed.");
    button.disabled = false;
  }
}

async function renderSupport(clients) {
  const clientId = selectedClientId() || clients[0]?.id || "";
  const options = clients.map((client) => `<option value="${esc(client.id)}" ${client.id === clientId ? "selected" : ""}>${esc(client.name)}</option>`).join("");
  let requests = [];
  if (clientId) {
    const result = await getSupabase()
      .from("support_requests")
      .select("id,subject,status,created_at,support_messages(id,body,created_at,author_id)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    requests = result.data || [];
  }
  document.getElementById("staff-panel").innerHTML = `
    <label>Client<select id="staff-client">${options || `<option value="">No assigned clients</option>`}</select></label>
    ${requests.length ? requests.map((request) => `
      <article class="portal-block">
        <h3>${esc(request.subject)}</h3>
        <p>Status: ${esc(request.status)}</p>
        <ul>${(request.support_messages || []).map((message) => `<li>${esc(message.body)}</li>`).join("")}</ul>
        <form data-reply="${esc(request.id)}">
          <label>Reply<textarea name="body" required maxlength="5000"></textarea></label>
          <label>Status<select name="status">
            <option value="open">Open</option>
            <option value="waiting_on_client">Waiting on client</option>
            <option value="resolved">Resolved</option>
          </select></label>
          <button class="primary-button" type="submit">Send reply</button>
        </form>
      </article>
    `).join("") : `<p class="portal-empty">No support requests for this client.</p>`}
  `;
  document.getElementById("staff-client").addEventListener("change", () => renderSupport(clients).catch((error) => showAlert(error.message)));
  document.querySelectorAll("[data-reply]").forEach((form) => {
    form.status.value = requests.find((request) => request.id === form.getAttribute("data-reply"))?.status || "open";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = String(form.body.value || "").trim();
      if (!body) return;
      const requestId = form.getAttribute("data-reply");
      const message = await getSupabase().from("support_messages").insert({
        request_id: requestId,
        author_id: getAuthState().user.id,
        body
      });
      if (message.error) return showAlert(message.error.message);
      const status = await getSupabase().from("support_requests").update({ status: form.status.value }).eq("id", requestId);
      if (status.error) return showAlert(status.error.message);
      showAlert("Reply sent.", "success");
      await renderSupport(clients);
    });
  });
}

function clientIdFor(clients) {
  const id = document.getElementById("staff-client")?.value || activeClientId || clients[0]?.id || "";
  if (id) activeClientId = id;
  return id;
}

function clientOptions(clients, clientId) {
  return clients.map((client) => `<option value="${esc(client.id)}" ${client.id === clientId ? "selected" : ""}>${esc(client.name)}</option>`).join("");
}

async function renderReports(clients) {
  const clientId = clientIdFor(clients);
  const options = clientOptions(clients, clientId);
  let reports = [];
  if (clientId) {
    const result = await getSupabase()
      .from("reports")
      .select("id,title,report_type,period_start,period_end,summary,status,published_at,files(id,file_name,mime_type,delivery_status)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    reports = result.data || [];
  }
  document.getElementById("staff-panel").innerHTML = `
    <form id="staff-report" class="portal-form">
      <label>Client<select id="staff-client" name="client" required>${options || `<option value="">No assigned clients</option>`}</select></label>
      <label>Title<input name="title" required maxlength="200"></label>
      <label>Type<input name="report_type" required maxlength="80"></label>
      <label>Period start<input name="period_start" type="date"></label>
      <label>Period end<input name="period_end" type="date"></label>
      <label>Summary<textarea name="summary" maxlength="5000"></textarea></label>
      <label>PDF<input name="pdf" type="file" accept=".pdf,application/pdf"></label>
      <label>Word DOCX<input name="docx" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
      <button class="primary-button" type="submit">Save internal report</button>
      <p class="portal-empty">The report stays internal until you publish it. Clients do not upload reports here.</p>
    </form>
    ${reports.length ? reports.map((report) => {
      const documents = report.files || [];
      const ready = documents.some((file) => file.delivery_status === "internal" || file.delivery_status === "sent");
      return `<article class="portal-block">
        <h3>${esc(report.title)}</h3>
        <p>Status: ${esc(report.status)}</p>
        <p>${esc(report.report_type)} · ${esc(report.period_start || "—")} – ${esc(report.period_end || "—")}</p>
        <p>${esc(report.summary || "")}</p>
        <ul>${documents.map((file) => `<li>${esc(reportDownloadLabel(file.file_name, file.mime_type).replace("Download ", "") || file.file_name)} · ${esc(file.delivery_status)}</li>`).join("") || "<li>No document attached</li>"}</ul>
        ${report.status !== "published" && ready ? `<button type="button" class="primary-button" data-publish="${esc(report.id)}">Publish</button>` : ""}
      </article>`;
    }).join("") : `<p class="portal-empty">${clientId ? "No reports for this client yet." : "Choose a client."}</p>`}
  `;
  document.getElementById("staff-client").addEventListener("change", () => {
    rememberClient();
    renderReports(clients).catch((error) => showAlert(error.message));
  });
  document.getElementById("staff-report").addEventListener("submit", (event) => createReport(event, clients));
  document.querySelectorAll("[data-publish]").forEach((button) => {
    button.addEventListener("click", () => publishReport(button, clients));
  });
}

async function attachReportDocument(reportId, clientId, file) {
  const checked = assertReportDocument(file);
  const id = crypto.randomUUID();
  const path = internalStoragePath(clientId, id, checked.safeName);
  const inserted = await getSupabase().from("files").insert({
    id,
    bucket: "client-files",
    storage_path: path,
    file_name: checked.safeName,
    mime_type: checked.mime,
    size_bytes: checked.size,
    uploaded_by: getAuthState().user.id,
    client_id: clientId,
    report_id: reportId,
    direction: "staff_to_client",
    delivery_status: "internal",
    notify_client: false
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
}

async function createReport(event, clients) {
  event.preventDefault();
  const form = event.currentTarget;
  showAlert("");
  const button = form.querySelector("button");
  button.disabled = true;
  let reportId = "";
  try {
    const destination = selectedClientId();
    if (!destination) throw new Error("Choose a client.");
    const title = String(form.title.value || "").trim();
    const reportType = String(form.report_type.value || "").trim();
    if (!title || !reportType) throw new Error("Enter a title and report type.");
    const summary = assertOptionalText(form.summary.value, "Summary", 5000);
    const pdf = form.pdf.files[0] || null;
    const docx = form.docx.files[0] || null;
    if (!pdf && !docx) throw new Error("Attach a PDF or Word document.");
    if (pdf) assertReportDocument(pdf);
    if (docx) assertReportDocument(docx);
    const created = await getSupabase().from("reports").insert({
      client_id: destination,
      title,
      report_type: reportType,
      period_start: form.period_start.value || null,
      period_end: form.period_end.value || null,
      summary,
      status: "draft",
      created_by: getAuthState().user.id
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    reportId = created.data.id;
    if (pdf) await attachReportDocument(reportId, destination, pdf);
    if (docx) await attachReportDocument(reportId, destination, docx);
    showAlert("Report saved and kept internal.", "success");
    await renderReports(clients);
  } catch (error) {
    if (reportId) await getSupabase().from("reports").delete().eq("id", reportId);
    showAlert(error.message || "The report could not be saved.");
    button.disabled = false;
  }
}

async function publishReport(button, clients) {
  showAlert("");
  button.disabled = true;
  try {
    const reportId = button.getAttribute("data-publish");
    const destination = selectedClientId();
    const existing = await getSupabase()
      .from("files")
      .select("id,file_name,storage_path,delivery_status")
      .eq("report_id", reportId)
      .eq("client_id", destination);
    if (existing.error) throw new Error(existing.error.message);
    const documents = (existing.data || []).filter((file) => file.delivery_status === "internal");
    if (!documents.length) throw new Error("Attach a document before publishing.");
    for (const file of documents) {
      const shared = sharedStoragePath(destination, file.id, file.file_name);
      const moved = await getSupabase().storage.from("client-files").move(file.storage_path, shared);
      if (moved.error) throw new Error(moved.error.message);
      const updated = await getSupabase().from("files").update({
        storage_path: shared,
        delivery_status: "sent",
        sent_at: new Date().toISOString(),
        notify_client: false
      }).eq("id", file.id).eq("client_id", destination).eq("delivery_status", "internal");
      if (updated.error) throw new Error(updated.error.message);
    }
    const published = await getSupabase().from("reports").update({
      status: "published",
      published_at: new Date().toISOString()
    }).eq("id", reportId).eq("client_id", destination).eq("status", "draft");
    if (published.error) throw new Error(published.error.message);
    showAlert("Report published.", "success");
    await renderReports(clients);
  } catch (error) {
    showAlert(error.message || "Publish failed.");
    button.disabled = false;
  }
}

async function showWorkspace() {
  document.getElementById("staff-app").hidden = false;
  const clients = await loadClients();
  const tabs = document.getElementById("staff-tabs");
  const show = () => {
    const tab = location.hash === "#support" ? "support" : location.hash === "#reports" ? "reports" : "files";
    const run = tab === "support" ? renderSupport : tab === "reports" ? renderReports : renderFiles;
    run(clients).catch((error) => showAlert(error.message));
  };
  tabs.onclick = (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    location.hash = button.dataset.tab;
  };
  window.onhashchange = show;
  document.getElementById("staff-sign-out").onclick = async () => {
    try {
      await signOut();
      window.location.replace("admin-login.html");
    } catch (error) {
      showAlert(error.message || "Sign-out failed.");
    }
  };
  show();
}

function showAdminLink(auth) {
  const link = document.getElementById("staff-admin-link");
  if (link) link.hidden = !isAdminPortalEligible(auth);
}

export async function startStaffWorkspace() {
  const gate = document.getElementById("staff-gate");
  try {
    const auth = await requireAdminStaffPortal();
    if (!auth) return;
    if (gate) gate.hidden = true;
    showAdminLink(auth);
    await showWorkspace();
    subscribeAuth((next) => {
      if (next.loading) return;
      const destination = portalGuardDestination(next, "staff");
      if (destination) {
        window.location.replace(destination);
        return;
      }
      showAdminLink(next);
    });
  } catch (error) {
    if (gate) {
      gate.hidden = false;
      gate.textContent = error.message || "Unable to verify portal access.";
    }
  }
}
