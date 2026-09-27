export const PROJECT_STATUS_LABELS = {
  planned: "Planning",
  active: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled"
};

export const OPEN_PROJECT_STATUSES = ["planned", "active", "on_hold"];
export const CLOSED_PROJECT_STATUSES = ["completed", "cancelled"];

export function projectStatusLabel(value) {
  const key = String(value || "").toLowerCase();
  return PROJECT_STATUS_LABELS[key] || String(value || "—").replaceAll("_", " ");
}

export function projectGroup(status) {
  if (OPEN_PROJECT_STATUSES.includes(status)) return "open";
  if (CLOSED_PROJECT_STATUSES.includes(status)) return "closed";
  return "unknown";
}
