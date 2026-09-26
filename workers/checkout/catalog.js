/**
 * Approved Stripe catalog for Pulse Analytics checkout.
 * Amounts are defined by the Stripe Price IDs, not by the browser.
 * Cart product ids match the existing pricing-page data-product-id values.
 * ecommerce-basic is in the catalog but is not an Add to Cart item on the pricing page.
 */

/** @typedef {"monthly" | "one_time"} BillingType */

/**
 * @typedef {Object} CatalogItem
 * @property {string} name
 * @property {string} productId
 * @property {string} priceId
 * @property {BillingType} billing
 */

/** @type {Record<string, CatalogItem>} */
export const STRIPE_CATALOG = {
  "seo-startup": {
    name: "Startup SEO",
    productId: "prod_VKSmByA4W7xMiU",
    priceId: "price_1UJrK6FPF2SIqMND1EIRsqqE",
    billing: "monthly"
  },
  "google-ads-growth": {
    name: "Google Ads Growth",
    productId: "prod_VKTcOkG3TaKsDJ",
    priceId: "price_1UJrK5FPF2SIqMND66d3VyaH",
    billing: "monthly"
  },
  "google-ads-scale": {
    name: "Google Ads Scale",
    productId: "prod_VKTkQ14Burij4l",
    priceId: "price_1UJrK4FPF2SIqMNDowTWvqyM",
    billing: "monthly"
  },
  "google-ads-starter": {
    name: "Google Ads Starter",
    productId: "prod_VKTY8vs7Zovs2A",
    priceId: "price_1UJrK3FPF2SIqMNDv2f8EACe",
    billing: "monthly"
  },
  "seo-pro": {
    name: "Pro SEO",
    productId: "prod_VKSw0rW1uIOMdY",
    priceId: "price_1UJrK0FPF2SIqMNDZktUhfDN",
    billing: "monthly"
  },
  "ai-starter": {
    name: "AI Starter",
    productId: "prod_VKTnNm1wx9ROhH",
    priceId: "price_1UJrK2FPF2SIqMNDU6HW1G8p",
    billing: "monthly"
  },
  "google-ads-pro": {
    name: "Google Ads Pro",
    productId: "prod_VKThGJN7CUC2cs",
    priceId: "price_1UJrK0FPF2SIqMND1beRlIckK",
    billing: "monthly"
  },
  "ai-pro": {
    name: "AI Pro",
    productId: "prod_VKTszOQlI28WGP",
    priceId: "price_1UJrJzFPF2SIqMND4P3cRYBe",
    billing: "monthly"
  },
  "social-media-growth": {
    name: "Social Media Growth",
    productId: "prod_VKVpepMVGc8PY6",
    priceId: "price_1UJrJzFPF2SIqMNDQxKGWbJF",
    billing: "monthly"
  },
  "social-profile-setup": {
    name: "Business Social Profile Setup & Optimization",
    productId: "prod_VKVjjbUW9dQ9AF",
    priceId: "price_1UJrJzFPF2SIqMNDSiL5vXBo",
    billing: "one_time"
  },
  "website-professional": {
    name: "Professional Website",
    productId: "prod_VKU42OwoDblgBn",
    priceId: "price_1UJrJzFPF2SIqMNDIcaPYqPY",
    billing: "one_time"
  },
  "ai-growth": {
    name: "AI Growth",
    productId: "prod_VKTp16O1x4YDih",
    priceId: "price_1UJrJzFPF2SIqMNDhlr7POuE",
    billing: "monthly"
  },
  "website-startup": {
    name: "Startup Website",
    productId: "prod_VKTxF5FV6GZHAy",
    priceId: "price_1UJrJzFPF2SIqMND6LJHBZHd",
    billing: "one_time"
  },
  "social-media-professional": {
    name: "Social Media Professional",
    productId: "prod_VKVsIEQ105fB2S",
    priceId: "price_1UJrJyFPF2SIqMNDEowaiNY8",
    billing: "monthly"
  },
  "social-media-starter": {
    name: "Social Media Starter",
    productId: "prod_VKVmHxCF2onTDL",
    priceId: "price_1UJrJzFPF2SIqMNDSDy54phO",
    billing: "monthly"
  },
  "ecommerce-basic": {
    name: "E-Commerce Basic Package",
    productId: "prod_VKU8ggRszdaZui",
    priceId: "price_1UJrJxFPF2SIqMNDpXjL8GPE",
    billing: "one_time"
  },
  "website-business": {
    name: "Business Website",
    productId: "prod_VKU0sqFMgcf7H2",
    priceId: "price_1UJrJzFPF2SIqMNDNknqoROO",
    billing: "one_time"
  },
  "seo-growth": {
    name: "Growth SEO",
    productId: "prod_VKSrhlYPRVawnl",
    priceId: "price_1UJrK1FPF2SIqMND4Q5DQE7Y",
    billing: "monthly"
  }
};

const MAX_ITEMS = 20;
const MAX_QUANTITY = 99;

/**
 * Resolve browser cart items to Stripe line items.
 * Ignores any price, name, or billing value sent by the browser.
 * @param {unknown} items
 */
export function resolveCheckoutItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Your cart is empty." };
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, status: 400, error: "Please review your cart and try again." };
  }

  /** @type {Map<string, { priceId: string, quantity: number, billing: BillingType }>} */
  const merged = new Map();

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return { ok: false, status: 400, error: "Please review your cart and try again." };
    }
    const id = typeof item.id === "string" ? item.id : "";
    const catalogItem = STRIPE_CATALOG[id];
    if (!catalogItem) {
      return {
        ok: false,
        status: 400,
        error: "One of the selected services cannot be purchased online. Please contact Pulse Analytics."
      };
    }

    const quantity = item.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return { ok: false, status: 400, error: "Please review the quantity for each service." };
    }

    const existing = merged.get(id);
    const nextQuantity = (existing?.quantity || 0) + quantity;
    if (nextQuantity > MAX_QUANTITY) {
      return { ok: false, status: 400, error: "Please review the quantity for each service." };
    }
    merged.set(id, {
      priceId: catalogItem.priceId,
      quantity: nextQuantity,
      billing: catalogItem.billing
    });
  }

  const lineItems = [...merged.values()];
  const hasRecurring = lineItems.some((item) => item.billing === "monthly");
  return {
    ok: true,
    mode: hasRecurring ? "subscription" : "payment",
    lineItems
  };
}
