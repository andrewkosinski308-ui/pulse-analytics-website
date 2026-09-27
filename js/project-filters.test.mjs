import assert from "node:assert/strict";
import test from "node:test";
import { filterProjects } from "./project-filters.js";
import { projectGroup } from "./project-status.js";

test("closed projects stay in the client history filter", () => {
  const projects = [
    { id: "open", client_id: "c", clientName: "A", name: "Open", status: "on_hold", starts_on: "2026-09-01", services: [] },
    { id: "done", client_id: "c", clientName: "A", name: "Done", status: "completed", starts_on: "2026-01-01", services: [] },
    { id: "stop", client_id: "c", clientName: "A", name: "Stop", status: "cancelled", starts_on: null, services: [] }
  ];
  assert.equal(projectGroup("on_hold"), "open");
  assert.equal(filterProjects(projects, { group: "all" }).length, 3);
  assert.deepEqual(filterProjects(projects, { group: "closed" }).map((row) => row.id), ["done", "stop"]);
  assert.deepEqual(filterProjects(projects, { from: "2026-09-01" }).map((row) => row.id), ["open"]);
});
