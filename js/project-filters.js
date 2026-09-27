import { projectGroup, projectStatusLabel } from "./project-status.js";

export function filterProjects(projects, filters = {}) {
  const group = filters.group || "all";
  const search = String(filters.search || "").trim().toLowerCase();
  const serviceId = filters.serviceId || "";
  const clientId = filters.clientId || "";
  const from = filters.from || "";
  const to = filters.to || "";

  return projects.filter((project) => {
    if (clientId && project.client_id !== clientId) return false;
    if (group === "open" && projectGroup(project.status) !== "open") return false;
    if (group === "closed" && projectGroup(project.status) !== "closed") return false;
    if (serviceId && !(project.services || []).some((service) => service.id === serviceId)) return false;
    if (from && (!project.starts_on || project.starts_on < from)) return false;
    if (to && (!project.starts_on || project.starts_on > to)) return false;
    if (search) {
      const haystack = [
        project.name,
        project.clientName,
        projectStatusLabel(project.status),
        ...(project.services || []).map((service) => service.name)
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
