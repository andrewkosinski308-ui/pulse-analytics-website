import { getSupabase } from "./pulse-auth.js";
import {
  businessFieldsHtml,
  businessPayload,
  interestFieldsHtml,
  marketFieldsHtml,
  readInterestForm,
  readMarketForm
} from "./account-profile.js";
import {
  CLIENT_SORTS,
  clientCardHtml,
  clientListRequest,
  detailHtml,
  emptyClientsHtml,
  pagerHtml,
  pageSummary,
  safeAdminError
} from "./admin-clients-view.js";

const FILTERS = [
  ["all", "All"],
  ["lead", "Leads"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["churned", "Churned"],
  ["onboarding", "Onboarding"]
];
const SORT_LABELS = {
  activity: "Last activity",
  name: "Business name",
  contact: "Contact name",
  status: "Status",
  created: "Created date"
};

function closeSidebar() {
  document.getElementById("admin-sidebar")?.classList.remove("is-open");
  document.body.classList.remove("admin-nav-open");
  const backdrop = document.getElementById("admin-backdrop");
  const toggle = document.getElementById("admin-menu-toggle");
  if (backdrop) backdrop.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
}

export function mountAdminClients() {
  const root = document.getElementById("admin-clients");
  const dashboard = document.getElementById("admin-dashboard");
  const projects = document.getElementById("admin-projects");
  const nav = document.getElementById("nav-clients");
  const dashNav = document.getElementById("nav-dashboard");
  const projectNav = document.getElementById("nav-projects");
  if (!root || !nav) return;

  const state = {
    mode: "list",
    query: "",
    status: "all",
    sort: "activity",
    page: 1,
    total: 0,
    pageSize: 20,
    rows: [],
    detail: null,
    clientId: "",
    loading: false,
    error: ""
  };
  let requestId = 0;
  let searchTimer = 0;

  function markCurrent() {
    for (const button of [dashNav, projectNav, nav]) {
      button?.classList.remove("is-current");
      button?.removeAttribute("aria-current");
    }
    nav.classList.add("is-current");
    nav.setAttribute("aria-current", "page");
  }

  function showClients() {
    if (dashboard) dashboard.hidden = true;
    if (projects) projects.hidden = true;
    const employees = document.getElementById("admin-employees");
    if (employees) employees.hidden = true;
    const account = document.getElementById("admin-account");
    if (account) account.hidden = true;
    root.hidden = false;
    markCurrent();
    closeSidebar();
    root.focus();
    loadList();
  }

  function showDashboard() {
    root.hidden = true;
    const employees = document.getElementById("admin-employees");
    if (employees) employees.hidden = true;
    const account = document.getElementById("admin-account");
    if (account) account.hidden = true;
    nav.classList.remove("is-current");
    nav.removeAttribute("aria-current");
  }

  nav.addEventListener("click", () => {
    state.mode = "list";
    showClients();
  });
  document.getElementById("admin-open-clients")?.addEventListener("click", () => {
    state.mode = "list";
    showClients();
  });
  dashNav?.addEventListener("click", showDashboard);
  projectNav?.addEventListener("click", showDashboard);

  async function loadList() {
    const ticket = ++requestId;
    state.loading = true;
    state.error = "";
    state.mode = "list";
    renderList();
    const sb = getSupabase();
    const response = await sb.rpc("admin_client_list", clientListRequest(state));
    if (ticket !== requestId) return;
    state.loading = false;
    if (response.error) {
      state.error = safeAdminError(response.error.message);
      state.rows = [];
      state.total = 0;
    } else {
      state.rows = response.data?.clients || [];
      state.total = Number(response.data?.total || 0);
      state.pageSize = Number(response.data?.page_size || 20);
      state.page = Number(response.data?.page || state.page);
    }
    renderList();
  }

  async function loadDetail(clientId) {
    const ticket = ++requestId;
    state.loading = true;
    state.error = "";
    state.mode = "detail";
    state.clientId = clientId;
    renderDetail();
    const sb = getSupabase();
    const response = await sb.rpc("admin_client_detail", { p_client_id: clientId });
    if (ticket !== requestId) return;
    state.loading = false;
    if (response.error) {
      state.error = safeAdminError(response.error.message);
      state.detail = null;
    } else {
      state.detail = response.data;
    }
    renderDetail();
  }

  function renderList() {
    const keepSearch = document.activeElement?.getAttribute?.("name") === "query";
    const summary = pageSummary({ page: state.page, pageSize: state.pageSize, total: state.total });
    const body = state.loading || state.error || !state.rows.length
      ? emptyClientsHtml({ query: state.query, status: state.status, error: state.error, loading: state.loading })
      : `<div class="admin-client-list">${state.rows.map(clientCardHtml).join("")}</div>${pagerHtml(summary)}`;
    root.innerHTML = `<div class="admin-clients-head">
        <div>
          <h1 id="admin-clients-title">Clients</h1>
          <p class="admin-lead">Manage client accounts, engagements, services, and relationship history.</p>
        </div>
      </div>
      <form class="admin-client-filters" id="admin-client-filters">
        <label>Search
          <input type="search" name="query" value="${escapeAttr(state.query)}" placeholder="Business, contact, email, or phone" autocomplete="off">
        </label>
        <div class="admin-project-groups" role="group" aria-label="Lifecycle status">
          ${FILTERS.map(([value, label]) => `<button type="button" class="admin-filter${state.status === value ? " is-current" : ""}" data-status="${value}" aria-pressed="${state.status === value ? "true" : "false"}">${label}</button>`).join("")}
        </div>
        <label>Sort
          <select name="sort">${CLIENT_SORTS.map((value) => `<option value="${value}"${state.sort === value ? " selected" : ""}>${SORT_LABELS[value]}</option>`).join("")}</select>
        </label>
      </form>
      ${body}`;
    bindList();
    if (keepSearch) root.querySelector('input[name="query"]')?.focus();
  }

  function renderDetail() {
    if (state.loading) {
      root.innerHTML = `<p class="admin-clients-note" role="status">Loading client…</p>`;
      return;
    }
    if (state.error || !state.detail) {
      root.innerHTML = `<button type="button" class="admin-text-button" id="admin-clients-back">All clients</button>
        <p class="admin-clients-note" role="alert">${escapeText(state.error || "That client account was not found.")}</p>`;
      document.getElementById("admin-clients-back")?.addEventListener("click", () => loadList());
      return;
    }
    root.innerHTML = detailHtml(state.detail);
    root.insertAdjacentHTML("beforeend", `<form class="admin-project-form" id="admin-client-business">
        <h2>Business information</h2>
        ${businessFieldsHtml(state.detail)}
        <button class="primary-button" type="submit">Save business information</button>
      </form>
      <form class="admin-project-form portal-choices" id="admin-client-interests">
        <h2>Service interests</h2>
        <p>Interests do not purchase a service or change billing.</p>
        ${interestFieldsHtml(state.detail.interests || [])}
        <button class="secondary-button" type="submit">Save interests</button>
      </form>
      <form class="admin-project-form portal-choices" id="admin-client-markets">
        <h2>Market focus</h2>
        ${marketFieldsHtml(state.detail.markets || [])}
        <button class="secondary-button" type="submit">Save market focus</button>
      </form>`);
    document.getElementById("admin-clients-back")?.addEventListener("click", () => loadList());
    document.getElementById("admin-client-projects")?.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("admin-open-project", { detail: { clientId: state.clientId } }));
    });
    root.querySelectorAll("[data-open-project]").forEach((button) => {
      button.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("admin-open-project", {
          detail: { clientId: state.clientId, projectId: button.getAttribute("data-open-project") }
        }));
      });
    });
    document.getElementById("admin-client-business")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = businessPayload(Object.fromEntries(new FormData(event.currentTarget).entries()));
      if (!payload.name) return;
      const updated = await getSupabase().rpc("admin_save_client_business", {
        p_client_id: state.clientId,
        p_fields: payload
      });
      if (!updated.error) await loadDetail(state.clientId);
    });
    document.getElementById("admin-client-interests")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const updated = await getSupabase().rpc("save_client_service_interests", {
        p_client_id: state.clientId,
        p_interests: readInterestForm(event.currentTarget)
      });
      if (!updated.error) await loadDetail(state.clientId);
    });
    document.getElementById("admin-client-markets")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const updated = await getSupabase().rpc("save_client_market_focus", {
        p_client_id: state.clientId,
        p_markets: readMarketForm(event.currentTarget)
      });
      if (!updated.error) await loadDetail(state.clientId);
    });
    root.focus();
  }

  function bindList() {
    const form = document.getElementById("admin-client-filters");
    form?.addEventListener("submit", (event) => event.preventDefault());
    form?.querySelector('input[name="query"]')?.addEventListener("input", (event) => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => {
        state.query = value;
        state.page = 1;
        loadList();
      }, 300);
    });
    form?.querySelector('select[name="sort"]')?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.page = 1;
      loadList();
    });
    root.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", () => {
        state.status = button.getAttribute("data-status") || "all";
        state.page = 1;
        loadList();
      });
    });
    root.querySelectorAll("[data-client]").forEach((button) => {
      button.addEventListener("click", () => loadDetail(button.getAttribute("data-client")));
    });
    document.getElementById("admin-clients-prev")?.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      loadList();
    });
    document.getElementById("admin-clients-next")?.addEventListener("click", () => {
      state.page += 1;
      loadList();
    });
  }
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeText(value) {
  return escapeAttr(value);
}
