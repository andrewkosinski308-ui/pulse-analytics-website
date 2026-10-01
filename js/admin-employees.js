import { getAuthState, getSupabase } from "./pulse-auth.js";
import {
  CLIENT_ROLE_NOTE,
  EMPLOYEE_FILTERS,
  UNASSIGN_NOTE,
  accountStateLabel,
  auditLabel,
  employeeCardHtml,
  employeeListRequest,
  employmentPayload,
  esc,
  portalAccessText,
  relationshipBlockers,
  roleChoices,
  roleLabel,
  safeEmployeeError
} from "./admin-employees-view.js";

function closeSidebar() {
  document.getElementById("admin-sidebar")?.classList.remove("is-open");
  document.body.classList.remove("admin-nav-open");
  const backdrop = document.getElementById("admin-backdrop");
  const toggle = document.getElementById("admin-menu-toggle");
  if (backdrop) backdrop.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function detailOf(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formValues(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

export function mountAdminEmployees() {
  const root = document.getElementById("admin-employees");
  const dashboard = document.getElementById("admin-dashboard");
  const nav = document.getElementById("nav-employees");
  if (!root || !nav) return;

  const state = {
    mode: "list",
    query: "",
    filter: "employees",
    rows: [],
    detail: null,
    employeeId: "",
    clients: [],
    showInvite: false,
    pending: null,
    loading: false,
    busy: false,
    notice: "",
    error: ""
  };
  let requestId = 0;
  let searchTimer = 0;

  function hideOthers() {
    ["admin-clients", "admin-projects"].forEach((id) => {
      const section = document.getElementById(id);
      if (section) section.hidden = true;
    });
    ["nav-clients", "nav-projects", "nav-dashboard"].forEach((id) => {
      const button = document.getElementById(id);
      button?.classList.remove("is-current");
      button?.removeAttribute("aria-current");
    });
    if (dashboard) dashboard.hidden = true;
  }

  function hideSelf() {
    root.hidden = true;
    nav.classList.remove("is-current");
    nav.removeAttribute("aria-current");
  }

  function showEmployees() {
    closeSidebar();
    hideOthers();
    root.hidden = false;
    nav.classList.add("is-current");
    nav.setAttribute("aria-current", "page");
    state.mode = "list";
    loadList();
  }

  nav.addEventListener("click", showEmployees);
  document.getElementById("admin-open-employees")?.addEventListener("click", showEmployees);
  document.getElementById("nav-dashboard")?.addEventListener("click", hideSelf);
  document.getElementById("nav-clients")?.addEventListener("click", hideSelf);
  document.getElementById("nav-projects")?.addEventListener("click", hideSelf);
  document.addEventListener("admin-open-project", hideSelf);

  async function loadList() {
    const ticket = ++requestId;
    state.loading = true;
    state.error = "";
    state.mode = "list";
    state.detail = null;
    render();
    const response = await getSupabase().rpc("admin_employee_list", employeeListRequest(state));
    if (ticket !== requestId) return;
    state.loading = false;
    if (response.error) state.error = safeEmployeeError(response.error.message);
    else state.rows = rowsOf(response.data);
    render();
  }

  async function loadDetail(id, notice = "") {
    const ticket = ++requestId;
    state.loading = true;
    state.error = "";
    state.notice = notice;
    state.pending = null;
    state.mode = "detail";
    state.employeeId = id;
    render();
    const response = await getSupabase().rpc("admin_employee_detail", { p_profile_id: id });
    if (ticket !== requestId) return;
    state.loading = false;
    if (response.error) {
      state.error = safeEmployeeError(response.error.message);
      state.detail = null;
    } else {
      state.detail = detailOf(response.data);
      if (!state.detail) state.error = "That employee account was not found.";
      else if (state.detail.role === "employee" && state.detail.is_active) await loadClients();
    }
    if (ticket !== requestId) return;
    render();
  }

  async function loadClients() {
    if (state.clients.length) return;
    const response = await getSupabase().from("clients").select("id,name").order("name");
    if (!response.error) state.clients = response.data || [];
  }

  function render() {
    if (state.mode === "detail") renderDetail();
    else renderList();
  }

  function renderList() {
    const keepSearch = document.activeElement?.getAttribute?.("name") === "query";
    const directoryError = state.showInvite ? "" : state.error;
    const body = state.loading
      ? `<p class="admin-clients-note" role="status">Loading employees…</p>`
      : directoryError
        ? `<p class="admin-clients-note" role="alert">${esc(directoryError)}</p>`
        : state.rows.length
          ? `<div class="admin-client-list">${state.rows.map(employeeCardHtml).join("")}</div>`
          : `<p class="admin-clients-note">${state.query ? "No employees match this search." : "No employee accounts yet."}</p>`;
    root.innerHTML = `<div class="admin-clients-head">
        <div>
          <h1 id="admin-employees-title">Employees</h1>
          <p class="admin-lead">Invite staff, manage employment, and assign employees to clients.</p>
        </div>
        <button type="button" class="secondary-button" id="admin-employee-add">Add Employee</button>
      </div>
      ${state.notice ? `<p class="admin-clients-note" role="status">${esc(state.notice)}</p>` : ""}
      ${state.showInvite ? inviteForm() : ""}
      <form class="admin-client-filters" id="admin-employee-filters">
        <label>Search
          <input type="search" name="query" value="${esc(state.query)}" placeholder="Name, email, job title, or department" autocomplete="off">
        </label>
        <div class="admin-project-groups" role="group" aria-label="Employee directory">
          ${EMPLOYEE_FILTERS.map(([value, label]) => `<button type="button" class="admin-filter${state.filter === value ? " is-current" : ""}" data-filter="${value}" aria-pressed="${state.filter === value ? "true" : "false"}">${label}</button>`).join("")}
        </div>
      </form>
      ${body}`;
    bindList();
    if (keepSearch) root.querySelector('input[name="query"]')?.focus();
  }

  function inviteForm() {
    const values = state.invite || {};
    return `<form class="admin-project-form" id="admin-employee-invite">
      <h2>Add employee</h2>
      <p>The employee sets their own password from the invitation email.</p>
      <label>First name <input name="first_name" value="${esc(values.first_name)}" required autocomplete="given-name"></label>
      <label>Last name <input name="last_name" value="${esc(values.last_name)}" required autocomplete="family-name"></label>
      <label>Email <input name="email" type="email" value="${esc(values.email)}" required autocomplete="off"></label>
      <label>Job title <input name="job_title" value="${esc(values.job_title)}" autocomplete="off"></label>
      <label>Department <input name="department" value="${esc(values.department)}" autocomplete="off"></label>
      <label>Started on <input name="started_on" type="date" value="${esc(values.started_on)}"></label>
      <p>
        <button type="submit" class="primary-button" ${state.busy ? "disabled" : ""}>Send invitation</button>
        <button type="button" class="secondary-button" id="admin-employee-invite-cancel" ${state.busy ? "disabled" : ""}>Cancel</button>
      </p>
      ${state.error && state.showInvite ? `<p class="admin-clients-note" role="alert">${esc(state.error)}</p>` : ""}
    </form>`;
  }

  function renderDetail() {
    if (state.loading) {
      root.innerHTML = `<p class="admin-clients-note" role="status">Loading employee…</p>`;
      return;
    }
    if (state.error && !state.detail) {
      root.innerHTML = `<button type="button" class="admin-text-button" id="admin-employees-back">All employees</button>
        <p class="admin-clients-note" role="alert">${esc(state.error)}</p>`;
      document.getElementById("admin-employees-back")?.addEventListener("click", () => loadList());
      return;
    }
    const person = state.detail;
    const self = getAuthState()?.profile?.id === person.id;
    const blocked = relationshipBlockers(person);
    const assigned = new Set((person.assignments || []).map((item) => item.client_id));
    const available = state.clients.filter((client) => !assigned.has(client.id));
    root.innerHTML = `<button type="button" class="admin-text-button" id="admin-employees-back">All employees</button>
      ${state.notice ? `<p class="admin-clients-note" role="status">${esc(state.notice)}</p>` : ""}
      ${state.error ? `<p class="admin-clients-note" role="alert">${esc(state.error)}</p>` : ""}
      <article class="admin-card">
        <p class="admin-card-label">Identity</p>
        <h2>${esc(person.full_name || "Employee")}</h2>
        ${person.avatar_url ? `<img src="${esc(person.avatar_url)}" alt="" width="64" height="64">` : ""}
        <dl>${meta("Email", person.email)}${meta("Phone", person.phone)}</dl>
      </article>
      <form class="admin-project-form" id="admin-employee-profile">
        <h2>Employment</h2>
        <label>First name <input name="first_name" value="${esc(person.first_name)}" autocomplete="off"></label>
        <label>Last name <input name="last_name" value="${esc(person.last_name)}" autocomplete="off"></label>
        <label>Display name <input name="full_name" value="${esc(person.full_name)}" autocomplete="off"></label>
        <label>Phone <input name="phone" value="${esc(person.phone)}" autocomplete="off"></label>
        <label>Job title <input name="job_title" value="${esc(person.job_title)}" autocomplete="off"></label>
        <label>Department <input name="department" value="${esc(person.department)}" autocomplete="off"></label>
        <label>Started on <input name="started_on" type="date" value="${esc(String(person.started_on || "").slice(0, 10))}"></label>
        <p><button type="submit" class="primary-button" ${state.busy ? "disabled" : ""}>Save employment</button></p>
        <dl>
          ${meta("Account status", accountStateLabel(person.account_state))}
          ${meta("Role", roleLabel(person.role))}
          ${meta("Staff portal access", portalAccessText(person))}
        </dl>
      </form>
      ${self ? "" : authorizationHtml(person, blocked)}
      <article class="admin-card">
        <p class="admin-card-label">Assigned clients</p>
        <h2>Client assignments</h2>
        ${assignmentHtml(person, available)}
      </article>
      <article class="admin-card">
        <p class="admin-card-label">Activity</p>
        <h2>Administrative history</h2>
        ${auditHtml(person.audit)}
      </article>`;
    bindDetail();
    root.focus();
  }

  function authorizationHtml(person, blocked) {
    if (person.role !== "employee" && person.role !== "client") return "";
    const choices = roleChoices().map((choice) => {
      const disabled = choice.value === "client" && person.role === "employee" && blocked ? " disabled" : "";
      const selected = person.role === choice.value ? " selected" : "";
      return `<option value="${choice.value}"${selected}${disabled}>${choice.label}</option>`;
    }).join("");
    const active = person.role === "employee" && person.is_active;
    return `<form class="admin-project-form" id="admin-employee-access">
      <h2>Authorization</h2>
      <p>Role: ${esc(roleLabel(person.role))}. Account status: ${esc(person.is_active ? "Active" : "Inactive")}. Staff portal access: ${esc(portalAccessText(person))}.</p>
      ${blocked && person.role === "employee" ? `<p>${esc(CLIENT_ROLE_NOTE)}</p>` : ""}
      <label>Role
        <select name="role">${choices}</select>
      </label>
      <p>
        <button type="submit" class="secondary-button" ${state.busy ? "disabled" : ""}>Change role</button>
        ${person.role === "employee" ? `<button type="button" class="secondary-button" id="admin-employee-status" data-active="${active ? "false" : "true"}" ${state.busy ? "disabled" : ""}>${active ? "Deactivate" : "Activate"}</button>` : ""}
      </p>
      ${confirmHtml()}
    </form>`;
  }

  function confirmHtml() {
    if (!state.pending) return "";
    const copy = {
      status: state.pending.active
        ? "Activate this employee so they can sign in to the Staff Workspace."
        : "Deactivating this employee keeps the account and its history. They will not be able to enter the Staff Workspace.",
      role: `Change this account to ${roleLabel(state.pending.role)}. Existing records are kept.`,
      unassign: `${UNASSIGN_NOTE} Remove ${state.pending.clientName || "this client"}?`
    }[state.pending.action];
    return `<p role="status">${esc(copy || "")}</p>
      <p>
        <button type="button" class="primary-button" id="admin-employee-confirm" ${state.busy ? "disabled" : ""}>Confirm</button>
        <button type="button" class="secondary-button" id="admin-employee-cancel">Cancel</button>
      </p>`;
  }

  function assignmentHtml(person, available) {
    const rows = person.assignments || [];
    const list = rows.length
      ? `<ul>${rows.map((item) => `<li>${esc(item.client_name || "Client")} · ${esc(item.assignment_type || "staff")} · Assigned ${esc(String(item.assigned_at || "").slice(0, 10) || "—")}
          <button type="button" class="admin-text-button" data-unassign="${esc(item.client_id)}" data-client-name="${esc(item.client_name || "this client")}" ${state.busy ? "disabled" : ""}>Remove assignment</button>
        </li>`).join("")}</ul>`
      : `<p class="admin-clients-note">No clients are assigned.</p>`;
    if (person.role !== "employee" || !person.is_active) {
      return `${list}<p class="admin-clients-note">Activate an employee account before assigning clients.</p>`;
    }
    const options = available.map((client) => `<option value="${esc(client.id)}">${esc(client.name || "Client")}</option>`).join("");
    return `${list}
      <form id="admin-employee-assign">
        <label>Assign client
          <select name="client_id" ${options ? "" : "disabled"}>
            <option value="">Select a client</option>
            ${options}
          </select>
        </label>
        <p class="admin-clients-note">Assignment type: Staff</p>
        <button type="submit" class="secondary-button" ${state.busy || !options ? "disabled" : ""}>Assign client</button>
      </form>`;
  }

  function auditHtml(rows) {
    const items = rows || [];
    if (!items.length) return `<p class="admin-clients-note">No administrative history yet.</p>`;
    return `<ul>${items.map((item) => `<li>${esc(auditLabel(item.action))} · ${esc(String(item.created_at || "").slice(0, 10))}</li>`).join("")}</ul>`;
  }

  function meta(label, value) {
    return `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`;
  }

  function bindList() {
    document.getElementById("admin-employee-add")?.addEventListener("click", () => {
      state.showInvite = true;
      state.error = "";
      state.notice = "";
      render();
    });
    document.getElementById("admin-employee-invite-cancel")?.addEventListener("click", () => {
      state.showInvite = false;
      state.invite = null;
      state.error = "";
      render();
    });
    document.getElementById("admin-employee-invite")?.addEventListener("submit", (event) => {
      event.preventDefault();
      sendInvite(formValues(event.currentTarget));
    });
    const form = document.getElementById("admin-employee-filters");
    form?.addEventListener("submit", (event) => event.preventDefault());
    form?.querySelector('input[name="query"]')?.addEventListener("input", (event) => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => {
        state.query = value;
        loadList();
      }, 300);
    });
    root.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.getAttribute("data-filter") || "employees";
        loadList();
      });
    });
    root.querySelectorAll("[data-employee]").forEach((button) => {
      button.addEventListener("click", () => loadDetail(button.getAttribute("data-employee")));
    });
  }

  function bindDetail() {
    document.getElementById("admin-employees-back")?.addEventListener("click", () => {
      state.notice = "";
      loadList();
    });
    document.getElementById("admin-employee-profile")?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveEmployment(formValues(event.currentTarget));
    });
    document.getElementById("admin-employee-access")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const role = formValues(event.currentTarget).role;
      if (role === state.detail?.role) return;
      if (role === "client" && relationshipBlockers(state.detail)) {
        state.error = CLIENT_ROLE_NOTE;
        render();
        return;
      }
      state.pending = { action: "role", role };
      state.error = "";
      render();
    });
    document.getElementById("admin-employee-status")?.addEventListener("click", () => {
      const active = document.getElementById("admin-employee-status")?.getAttribute("data-active") === "true";
      if (!active && state.detail && !state.detail.is_active) {
        state.error = "This employee cannot be deactivated because the account is already inactive.";
        render();
        return;
      }
      state.pending = { action: "status", active };
      state.error = "";
      render();
    });
    document.getElementById("admin-employee-assign")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const clientId = formValues(event.currentTarget).client_id;
      if (!clientId) {
        state.error = "Choose a client account.";
        render();
        return;
      }
      assignClient(clientId);
    });
    root.querySelectorAll("[data-unassign]").forEach((button) => {
      button.addEventListener("click", () => {
        state.pending = {
          action: "unassign",
          clientId: button.getAttribute("data-unassign"),
          clientName: button.getAttribute("data-client-name")
        };
        state.error = "";
        render();
      });
    });
    document.getElementById("admin-employee-cancel")?.addEventListener("click", () => {
      state.pending = null;
      render();
    });
    document.getElementById("admin-employee-confirm")?.addEventListener("click", () => confirmPending());
  }

  async function sendInvite(input) {
    if (state.busy) return;
    state.busy = true;
    state.invite = input;
    state.error = "";
    render();
    const session = await getSupabase().auth.getSession();
    const token = session.data.session?.access_token || "";
    let response;
    try {
      response = await fetch("/api/staff/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          job_title: input.job_title,
          department: input.department,
          started_on: input.started_on
        })
      });
    } catch {
      state.busy = false;
      state.error = "The invitation could not be sent. Please try again.";
      render();
      return;
    }
    const body = await response.json().catch(() => ({}));
    state.busy = false;
    if (!response.ok) {
      state.error = body.error || "The invitation could not be sent. Please try again.";
      render();
      return;
    }
    state.showInvite = false;
    state.invite = null;
    state.notice = "Invitation sent. The employee sets their own password from the email.";
    loadList();
  }

  async function saveEmployment(input) {
    if (state.busy || !state.employeeId) return;
    state.busy = true;
    state.error = "";
    render();
    const payload = employmentPayload(input);
    const response = await getSupabase().from("profiles").update(payload).eq("id", state.employeeId);
    state.busy = false;
    if (response.error) {
      state.error = safeEmployeeError(response.error.message);
      render();
      return;
    }
    loadDetail(state.employeeId, "Employment details saved.");
  }

  async function assignClient(clientId) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    const response = await getSupabase().rpc("admin_assign_employee_client", {
      p_employee_id: state.employeeId,
      p_client_id: clientId
    });
    state.busy = false;
    if (response.error) {
      state.error = safeEmployeeError(response.error.message);
      render();
      return;
    }
    loadDetail(state.employeeId, "Client assigned.");
  }

  async function confirmPending() {
    if (state.busy || !state.pending) return;
    const pending = state.pending;
    state.busy = true;
    state.error = "";
    render();
    let response;
    if (pending.action === "status") {
      response = await getSupabase().rpc("admin_set_employee_active", {
        p_profile_id: state.employeeId,
        p_active: pending.active
      });
    } else if (pending.action === "role") {
      response = await getSupabase().rpc("admin_set_staff_role", {
        p_profile_id: state.employeeId,
        p_role: pending.role
      });
    } else if (pending.action === "unassign") {
      response = await getSupabase().rpc("admin_unassign_employee_client", {
        p_employee_id: state.employeeId,
        p_client_id: pending.clientId
      });
    }
    state.busy = false;
    state.pending = null;
    if (response?.error) {
      state.error = safeEmployeeError(response.error.message);
      render();
      return;
    }
    const notice = pending.action === "unassign"
      ? "Assignment removed. Project membership is unchanged."
      : pending.action === "status"
        ? (pending.active ? "Employee activated." : "Employee deactivated.")
        : "Role updated.";
    loadDetail(state.employeeId, notice);
  }
}
