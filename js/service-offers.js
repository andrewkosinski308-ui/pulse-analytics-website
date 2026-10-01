/** Public service names for the Client Portal. Prices stay on the server. */

export const SERVICE_LADDERS = {
  seo: ["seo-startup", "seo-growth", "seo-pro"],
  "google-ads": ["google-ads-starter", "google-ads-growth", "google-ads-scale", "google-ads-pro"],
  ai: ["ai-starter", "ai-growth", "ai-pro"],
  "social-media": ["social-media-starter", "social-media-growth", "social-media-professional"]
};

export const SERVICE_OFFERS = [
  { id: "seo-startup", name: "Startup SEO", billing: "monthly" },
  { id: "seo-growth", name: "Growth SEO", billing: "monthly" },
  { id: "seo-pro", name: "Pro SEO", billing: "monthly" },
  { id: "google-ads-starter", name: "Google Ads Starter", billing: "monthly" },
  { id: "google-ads-growth", name: "Google Ads Growth", billing: "monthly" },
  { id: "google-ads-scale", name: "Google Ads Scale", billing: "monthly" },
  { id: "google-ads-pro", name: "Google Ads Pro", billing: "monthly" },
  { id: "ai-starter", name: "AI Starter", billing: "monthly" },
  { id: "ai-growth", name: "AI Growth", billing: "monthly" },
  { id: "ai-pro", name: "AI Pro", billing: "monthly" },
  { id: "social-media-starter", name: "Social Media Starter", billing: "monthly" },
  { id: "social-media-growth", name: "Social Media Growth", billing: "monthly" },
  { id: "social-media-professional", name: "Social Media Professional", billing: "monthly" },
  { id: "social-profile-setup", name: "Business Social Profile Setup & Optimization", billing: "one_time" },
  { id: "website-startup", name: "Startup Website", billing: "one_time" },
  { id: "website-professional", name: "Professional Website", billing: "one_time" },
  { id: "website-business", name: "Business Website", billing: "one_time" },
  { id: "ecommerce-basic", name: "E-Commerce Basic Package", billing: "one_time" }
];

export function offerName(id) {
  return SERVICE_OFFERS.find((item) => item.id === id)?.name || "";
}

export function ladderMoves(currentId) {
  const ladder = Object.values(SERVICE_LADDERS).find((ids) => ids.includes(currentId));
  if (!ladder) return { upgrades: [], downgrades: [] };
  const index = ladder.indexOf(currentId);
  return {
    upgrades: ladder.slice(index + 1),
    downgrades: ladder.slice(0, index)
  };
}
