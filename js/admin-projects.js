import { getSupabase } from "./pulse-auth.js";
import { filterProjects } from "./project-filters.js";
import { PROJECT_STATUS_LABELS, projectStatusLabel } from "./project-status.js";

const STATUSES = Object.keys(PROJECT_STATUS_LABELS);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function fmtDay(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function fmtUpdated(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function normalize(row) {
  const services = (row.project_services || []).map((item) => item.services).filter((service) => service?.id);
  const purchase = Array.isArray(row.project_purchases) ? row.project_purchases[0] : null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    updated_at: row.updated_at,
    summary: row.summary || "",
    source: row.source || "manual",
    client_id: row.client_id,
    owner_id: row.owner_id || "",
    clientName: row.clients?.name || "Client",
    services,
    memberIds: (row.project_members || []).map((member) => member.profile_id),
    purchase
  };
}

function staffLabel(person) {
  return person.full_name?.trim() || person.email || "Staff";
}

export function mountAdminProjects() {
  const root = document.getElementById("admin-projects");
  const dashboard = document.getElementById("admin-dashboard");
  const dashNav = document.getElementById("nav-dashboard");
  const nav = document.getElementById("nav-projects");
  if (!root || !nav) return;

  const state = {
    mode: "list",
    clientId: "",
    projectId: "",
    group: "all",
    serviceId: "",
    search: "",
    from: "",
    to: "",
    showForm: false,
    projects: [],
    clients: [],
    services: [],
    staff: [],
    message: "",
    error: ""
  };

  function hideClients() {
    const clients = document.getElementById("admin-clients");
    const clientsNav = document.getElementById("nav-clients");
    if (clients) clients.hidden = true;
    clientsNav?.classList.remove("is-current");
    clientsNav?.removeAttribute("aria-current");
  }

  function showProjects() {
    hideClients();
    if (dashboard) dashboard.hidden = true;
    root.hidden = false;
    dashNav?.classList.remove("is-current");
    dashNav?.removeAttribute("aria-current");
    nav.classList.add("is-current");
    nav.setAttribute("aria-current", "page");
    root.focus();
    load();
  }

  function showDashboard() {
    hideClients();
    root.hidden = true;
    if (dashboard) dashboard.hidden = false;
    nav.classList.remove("is-current");
    nav.removeAttribute("aria-current");
    dashNav?.classList.add("is-current");
    dashNav?.setAttribute("aria-current", "page");
  }

  document.addEventListener("admin-open-project", (event) => {
    const clientId = event.detail?.clientId || "";
    if (!clientId) return;
    state.mode = "client";
    state.clientId = clientId;
    state.projectId = event.detail?.projectId || "";
    state.showForm = Boolean(event.detail?.projectId);
    showProjects();
  });

  nav.addEventListener("click", showProjects);
  document.getElementById("admin-open-projects")?.addEventListener("click", showProjects);
  dashNav?.addEventListener("click", showDashboard);

  async function load() {
    state.error = "";
    const sb = getSupabase();
    const [projects, staffFields, clients, services, staff] = await Promise.all([
      sb.from("projects").select("id,name,status,starts_on,ends_on,updated_at,summary,client_id,clients!projects_client_id_fkey(name),project_services(service_id,services(id,name)),project_members(profile_id),project_purchases(stripe_checkout_session_id,stripe_price_ids)").order("updated_at", { ascending: false }),
      sb.rpc("project_staff_fields"),
      sb.from("clients").select("id,name").order("name"),
      sb.from("services").select("id,name").eq("is_active", true).order("sort_order"),
      sb.from("profiles").select("id,full_name,email,role").in("role", ["admin", "employee"]).eq("is_active", true).order("full_name")
    ]);
    if (projects.error || staffFields.error || clients.error || services.error || staff.error) {
      state.error = projects.error?.message || staffFields.error?.message || clients.error?.message || services.error?.message || staff.error?.message || "Projects could not be loaded.";
      state.projects = [];
    } else {
      const internal = new Map((staffFields.data || []).map((row) => [row.id, row]));
      state.projects = (projects.data || []).map((row) => {
        const fields = internal.get(row.id);
        return normalize({ ...row, owner_id: fields?.owner_id || null, source: fields?.source || null });
      });
      state.clients = clients.data || [];
      state.services = services.data || [];
      state.staff = staff.data || [];
    }
    render();
  }

  function currentFilters() {
    return {
      group: state.group,
      serviceId: state.serviceId,
      search: state.search,
      from: state.from,
      to: state.to,
      clientId: state.mode === "client" ? state.clientId : ""
    };
  }

  function selectedProject() {
    return state.projects.find((project) => project.id === state.projectId) || null;
  }

  function render() {
    const filters = currentFilters();
    const visible = filterProjects(state.projects, filters);
    const client = state.clients.find((item) => item.id === state.clientId);
    const title = state.mode === "client"
      ? `Projects for ${client?.name || "client"}`
      : "Projects";
    root.innerHTML = `
      <div class="admin-projects-head">
        <div>
          ${state.mode === "client" ? `<button type="button" class="admin-text-button" id="admin-projects-back">All projects</button>` : ""}
          <h1 id="admin-projects-title">${esc(title)}</h1>
        </div>
        <button type="button" class="primary-button" id="admin-new-project">${state.showForm ? "Close form" : "New Project"}</button>
      </div>
      <p class="admin-projects-note">${state.error ? esc(state.error) : esc(state.message || "Every client project is listed here. Open and closed are filters, not a separate status.")}</p>
      ${state.showForm ? formHtml(selectedProject()) : ""}
      <form class="admin-project-filters" id="admin-project-filters">
        <label>Search<input type="search" name="search" value="${esc(state.search)}" placeholder="Client, project, or service"></label>
        <div class="admin-project-groups" role="group" aria-label="Open or closed">
          ${[["all", "All"], ["open", "Open"], ["closed", "Closed"]].map(([value, label]) => `<button type="button" class="admin-filter${state.group === value ? " is-current" : ""}" data-group="${value}">${label}</button>`).join("")}
        </div>
        <label>Service<select name="serviceId"><option value="">All services</option>${state.services.map((service) => `<option value="${esc(service.id)}"${service.id === state.serviceId ? " selected" : ""}>${esc(service.name)}</option>`).join("")}</select></label>
        <label>Start from<input type="date" name="from" value="${esc(state.from)}"></label>
        <label>Start to<input type="date" name="to" value="${esc(state.to)}"></label>
      </form>
      <div class="admin-project-list">
        ${visible.length ? visible.map(cardHtml).join("") : `<p class="admin-projects-note">No projects match these filters.</p>`}
      </div>
      ${state.mode === "client" && selectedProject() ? detailHtml(selectedProject()) : ""}
    `;
    bind();
  }

  function cardHtml(project) {
    const services = project.services.map((service) => service.name).join(", ") || "—";
    return `<article class="admin-card admin-project-card" data-project="${esc(project.id)}" tabindex="0">
      <p class="admin-card-label">${esc(project.clientName)}</p>
      <h2>${esc(project.name)}</h2>
      <dl>
        <div><dt>Status</dt><dd>${esc(projectStatusLabel(project.status))}</dd></div>
        <div><dt>Service</dt><dd>${esc(services)}</dd></div>
        <div><dt>Start</dt><dd>${esc(fmtDay(project.starts_on))}</dd></div>
        <div><dt>End</dt><dd>${esc(fmtDay(project.ends_on))}</dd></div>
        <div><dt>Last updated</dt><dd>${esc(fmtUpdated(project.updated_at))}</dd></div>
      </dl>
    </article>`;
  }

  function formHtml(project) {
    const editing = Boolean(project && state.mode === "client");
    const selectedServices = new Set((project?.services || []).map((service) => service.id));
    const selectedMembers = new Set(project?.memberIds || []);
    return `<form class="admin-project-form" id="admin-project-form" data-project-id="${editing ? esc(project.id) : ""}">
      <h2>${editing ? "Edit project" : "New project"}</h2>
      <label>Client<select name="client_id" required ${editing ? "disabled" : ""}>${state.clients.map((client) => `<option value="${esc(client.id)}"${client.id === (project?.client_id || "") ? " selected" : ""}>${esc(client.name)}</option>`).join("")}</select></label>
      <label>Project name<input name="name" required maxlength="180" value="${esc(project?.name || "")}"></label>
      <label>Status<select name="status">${STATUSES.map((status) => `<option value="${status}"${(project?.status || "planned") === status ? " selected" : ""}>${esc(PROJECT_STATUS_LABELS[status])}</option>`).join("")}</select></label>
      <label>Summary<input name="summary" maxlength="2000" value="${esc(project?.summary || "")}" placeholder="Client-facing description"></label>
      <label>Start date<input type="date" name="starts_on" value="${esc(project?.starts_on || "")}"></label>
      <label>End date<input type="date" name="ends_on" value="${esc(project?.ends_on || "")}"></label>
      <label>Project owner<select name="owner_id"><option value="">Unassigned</option>${state.staff.map((person) => `<option value="${esc(person.id)}"${person.id === (project?.owner_id || "") ? " selected" : ""}>${esc(staffLabel(person))}</option>`).join("")}</select></label>
      <fieldset>
        <legend>Services</legend>
        ${state.services.map((service) => `<label><input type="checkbox" name="service_id" value="${esc(service.id)}"${selectedServices.has(service.id) ? " checked" : ""}> ${esc(service.name)}</label>`).join("")}
      </fieldset>
      <fieldset>
        <legend>Project members</legend>
        ${state.staff.map((person) => `<label><input type="checkbox" name="member_id" value="${esc(person.id)}"${selectedMembers.has(person.id) ? " checked" : ""}> ${esc(staffLabel(person))}</label>`).join("")}
      </fieldset>
      <button type="submit" class="primary-button">${editing ? "Save project" : "Create project"}</button>
    </form>`;
  }

  function detailHtml(project) {
    const purchase = project.purchase;
    const source = project.source === "stripe_checkout" ? "Stripe Checkout" : "Manual";
    return `<section class="admin-card admin-project-detail">
      <h2>Manage ${esc(project.name)}</h2>
      <p>Source: ${esc(source)}</p>
      ${purchase ? `<p>Checkout session: ${esc(purchase.stripe_checkout_session_id)}</p><p>Prices: ${esc((purchase.stripe_price_ids || []).join(", "))}</p>` : ""}
      <p>${esc(project.summary || "No client-facing summary.")}</p>
    </section>`;
  }

  function bind() {
    document.getElementById("admin-projects-back")?.addEventListener("click", () => {
      state.mode = "list";
      state.clientId = "";
      state.projectId = "";
      state.showForm = false;
      render();
    });
    document.getElementById("admin-new-project")?.addEventListener("click", () => {
      state.showForm = !state.showForm;
      if (state.showForm && state.mode !== "client") state.projectId = "";
      render();
    });
    root.querySelectorAll("[data-group]").forEach((button) => {
      button.addEventListener("click", () => {
        state.group = button.getAttribute("data-group") || "all";
        render();
      });
    });
    bindProjectCards(root);
    const filters = document.getElementById("admin-project-filters");
    filters?.addEventListener("submit", (event) => event.preventDefault());
    filters?.addEventListener("input", () => {
      const data = new FormData(filters);
      state.search = String(data.get("search") || "");
      state.serviceId = String(data.get("serviceId") || "");
      state.from = String(data.get("from") || "");
      state.to = String(data.get("to") || "");
      paintList();
    });
    document.getElementById("admin-project-form")?.addEventListener("submit", saveProject);
  }

  function paintList() {
    const list = root.querySelector(".admin-project-list");
    if (!list) return;
    const visible = filterProjects(state.projects, currentFilters());
    list.innerHTML = visible.length ? visible.map(cardHtml).join("") : `<p class="admin-projects-note">No projects match these filters.</p>`;
    bindProjectCards(list);
  }

  function bindProjectCards(scope) {
    scope.querySelectorAll("[data-project]").forEach((card) => {
      const open = () => {
        const project = state.projects.find((item) => item.id === card.getAttribute("data-project"));
        if (!project) return;
        state.mode = "client";
        state.clientId = project.client_id;
        state.projectId = project.id;
        state.showForm = true;
        render();
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  async function saveProject(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const editing = form.dataset.projectId || "";
    const data = new FormData(form);
    const clientId = editing
      ? state.projects.find((project) => project.id === editing)?.client_id
      : String(data.get("client_id") || "");
    const name = String(data.get("name") || "").trim();
    if (!clientId || !name) {
      state.error = "Choose a client and enter a project name.";
      render();
      return;
    }
    const payload = {
      client_id: clientId,
      name,
      status: String(data.get("status") || "planned"),
      summary: String(data.get("summary") || "").trim() || null,
      starts_on: String(data.get("starts_on") || "") || null,
      ends_on: String(data.get("ends_on") || "") || null,
      owner_id: String(data.get("owner_id") || "") || null
    };
    if (!STATUSES.includes(payload.status)) payload.status = "planned";
    const serviceIds = data.getAll("service_id").map(String);
    const memberIds = data.getAll("member_id").map(String);
    const sb = getSupabase();
    let projectId = editing;
    if (editing) {
      const updated = await sb.from("projects").update(payload).eq("id", editing).select("id").single();
      if (updated.error) {
        state.error = updated.error.message;
        render();
        return;
      }
      await sb.from("project_services").delete().eq("project_id", editing);
      await sb.from("project_members").delete().eq("project_id", editing);
    } else {
      const created = await sb.from("projects").insert({ ...payload, source: "manual" }).select("id").single();
      if (created.error || !created.data?.id) {
        state.error = created.error?.message || "The project could not be created.";
        render();
        return;
      }
      projectId = created.data.id;
    }
    if (serviceIds.length) {
      const services = await sb.from("project_services").insert(serviceIds.map((serviceId) => ({ project_id: projectId, service_id: serviceId })));
      if (services.error) {
        state.error = services.error.message;
        await load();
        return;
      }
    }
    if (memberIds.length) {
      const members = await sb.from("project_members").insert(memberIds.map((profileId) => ({ project_id: projectId, profile_id: profileId })));
      if (members.error) {
        state.error = members.error.message;
        await load();
        return;
      }
    }
    state.message = editing ? "Project saved." : "Project created.";
    state.error = "";
    state.mode = "client";
    state.clientId = clientId;
    state.projectId = projectId;
    state.showForm = true;
    await load();
  }
}
