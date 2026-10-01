export const EMPLOYEE_FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["inactive", "Inactive"],
  ["employees", "Employees"],
  ["clients", "Clients"]
];

const STATE_LABELS = {
  invited: "Invited",
  active: "Active",
  inactive: "Inactive",
  client: "Client"
};

const AUDIT_LABELS = {
  ADMIN_CREATED_EMPLOYEE: "Employee invited",
  ADMIN_CHANGED_EMPLOYEE_STATUS: "Account status changed",
  ADMIN_CHANGED_EMPLOYEE_ROLE: "Role changed",
  ADMIN_ASSIGNED_EMPLOYEE_TO_CLIENT: "Assigned to a client",
  ADMIN_REMOVED_EMPLOYEE_FROM_CLIENT: "Removed from a client"
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function employeeListRequest({ query = "", filter = "employees" } = {}) {
  const allowed = new Set(EMPLOYEE_FILTERS.map(([value]) => value));
  return {
    p_query: String(query || "").trim().slice(0, 80),
    p_filter: allowed.has(filter) ? filter : "employees"
  };
}

export function accountStateLabel(state) {
  return STATE_LABELS[state] || "Unknown";
}

export function roleLabel(role) {
  if (role === "employee") return "Employee";
  if (role === "client") return "Client";
  return "Unknown";
}

/** Portal access is role plus account status. There is no separate flag. */
export function portalAccessText(row) {
  if (row?.role === "employee" && row?.is_active) return "Enabled";
  return "Disabled";
}

export function roleChoices() {
  return [
    { value: "employee", label: "Employee" },
    { value: "client", label: "Client" }
  ];
}

export function employmentPayload(input = {}) {
  const first = String(input.first_name || "").trim();
  const last = String(input.last_name || "").trim();
  const full = String(input.full_name || "").trim() || `${first} ${last}`.trim();
  const started = String(input.started_on || "").trim();
  return {
    first_name: first || null,
    last_name: last || null,
    full_name: full || null,
    phone: String(input.phone || "").trim() || null,
    job_title: String(input.job_title || "").trim() || null,
    department: String(input.department || "").trim() || null,
    started_on: started || null
  };
}

export function relationshipBlockers(detail) {
  const blockers = detail?.blockers || {};
  return Number(blockers.assignments) > 0
    || Number(blockers.account_manager) > 0
    || Number(blockers.projects) > 0;
}

export function safeEmployeeError(message) {
  const text = String(message || "");
  if (text.includes("Administrator access is required") || text.includes("permission") || text.includes("row-level security")) {
    return "You do not have permission to perform this action.";
  }
  if (text.includes("Remove this employee")) {
    return "Remove this employee from client assignments and project staff before changing them to a client.";
  }
  if (text.includes("cannot change their own")) return "You cannot change your own administrator account here.";
  if (text.includes("was not found")) return "That employee account was not found.";
  if (text.includes("Choose an active employee")) return "Activate this employee before assigning a client.";
  if (text.includes("Choose an employee")) return "Choose an employee account.";
  if (text.includes("Choose a client")) return "Choose a client account.";
  if (text.includes("already exists")) return "An account with this email already exists.";
  if (text.includes("employee filter")) return "Choose an employee filter.";
  if (text.includes("already inactive")) return "This employee cannot be deactivated because the account is already inactive.";
  if (text.includes("already active")) return "This employee is already active.";
  return "Employee details could not be saved. Try again.";
}

export function auditLabel(action) {
  return AUDIT_LABELS[action] || "Administrative change";
}

function day(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function meta(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`;
}

export function employeeCardHtml(row) {
  const name = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Employee";
  return `<article class="admin-client-card">
    <button type="button" class="admin-client-open" data-employee="${esc(row.id)}">
      <span class="admin-client-name">${esc(name)}</span>
      <span class="admin-client-contact">${esc(row.email || "No email")}</span>
    </button>
    <dl class="admin-client-meta">
      ${meta("Job title", row.job_title)}
      ${meta("Department", row.department)}
      ${meta("Role", roleLabel(row.role))}
      ${meta("Status", accountStateLabel(row.account_state))}
      ${meta("Started on", day(row.started_on))}
      ${meta("Client assignments", String(row.assignment_count ?? 0))}
      ${meta("Portal access", portalAccessText(row))}
    </dl>
  </article>`;
}

export const UNASSIGN_NOTE = "Removing this direct assignment does not remove project membership. The employee may still have access through a project.";
export const CLIENT_ROLE_NOTE = "Remove this employee from client assignments and project staff before changing them to a client.";
