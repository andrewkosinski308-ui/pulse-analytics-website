import { STRIPE_CATALOG } from "../checkout/catalog.js";

/** Recurring plans that can move up or down. One-time services are added through checkout only. */
export const SERVICE_LADDERS = {
  seo: ["seo-startup", "seo-growth", "seo-pro"],
  "google-ads": ["google-ads-starter", "google-ads-growth", "google-ads-scale", "google-ads-pro"],
  ai: ["ai-starter", "ai-growth", "ai-pro"],
  "social-media": ["social-media-starter", "social-media-growth", "social-media-professional"]
};

export function catalogIdForPrice(priceId) {
  const match = Object.entries(STRIPE_CATALOG).find(([, item]) => item.priceId === priceId);
  return match ? match[0] : "";
}

/**
 * Decide a client service change from catalog ids.
 * The browser never supplies a Stripe price.
 */
export function planServiceChange({ action, catalogId, currentCatalogId }) {
  if (action === "add") {
    if (!STRIPE_CATALOG[catalogId]) return { error: "That service is not available." };
    return { kind: "checkout", catalogId, priceId: STRIPE_CATALOG[catalogId].priceId, billing: STRIPE_CATALOG[catalogId].billing };
  }
  if (action === "remove") return { kind: "cancel" };
  if (action !== "upgrade" && action !== "downgrade") return { error: "That service change is not available." };
  const ladder = Object.values(SERVICE_LADDERS).find((ids) => ids.includes(catalogId) && ids.includes(currentCatalogId));
  if (!ladder || !STRIPE_CATALOG[catalogId]) return { error: "That service change is not available." };
  const next = ladder.indexOf(catalogId);
  const current = ladder.indexOf(currentCatalogId);
  if (action === "upgrade" && next <= current) return { error: "Choose a higher plan to upgrade." };
  if (action === "downgrade" && next >= current) return { error: "Choose a lower plan to downgrade." };
  return { kind: "subscription", catalogId, priceId: STRIPE_CATALOG[catalogId].priceId };
}
