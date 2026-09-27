import { STRIPE_CATALOG } from "./catalog.js";

/**
 * Cart id → existing public.services.slug.
 * Stripe Price IDs stay in STRIPE_CATALOG. Names are not matched.
 */
const CART_SERVICE_SLUG = {
  "seo-startup": "seo",
  "seo-pro": "seo",
  "seo-growth": "seo",
  "google-ads-starter": "google-ads",
  "google-ads-growth": "google-ads",
  "google-ads-pro": "google-ads",
  "google-ads-scale": "google-ads",
  "ai-starter": "ai-marketing",
  "ai-growth": "ai-marketing",
  "ai-pro": "ai-marketing",
  "social-media-starter": "social-media",
  "social-media-growth": "social-media",
  "social-media-professional": "social-media",
  "social-profile-setup": "social-media",
  "website-startup": "web-design",
  "website-business": "web-design",
  "website-professional": "web-design",
  "ecommerce-basic": "web-design"
};

export function serviceSlugForPriceId(priceId) {
  const cartId = Object.keys(STRIPE_CATALOG).find((id) => STRIPE_CATALOG[id].priceId === priceId);
  if (!cartId) return null;
  return CART_SERVICE_SLUG[cartId] || null;
}

export function unmappedCatalogIds() {
  return Object.keys(STRIPE_CATALOG).filter((id) => !CART_SERVICE_SLUG[id]);
}
