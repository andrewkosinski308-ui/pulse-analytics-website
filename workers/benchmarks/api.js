import { benchmarkCatalog } from "./catalog.js";

export function handleBenchmarksRequest(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/benchmarks") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(benchmarkCatalog(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
