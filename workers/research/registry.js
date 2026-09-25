import { createOpenAlexAdapter } from "./openalex.js";

export const PROVIDER_KEYS = ["openalex", "manual"];

export function adapterFor(key, env, fetchImpl) {
  if (key === "openalex") return createOpenAlexAdapter(env, fetchImpl);
  return null;
}
