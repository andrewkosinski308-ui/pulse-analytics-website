/** Structured choices for client onboarding. Billable service slugs stay aligned with public.services. */

export const INDUSTRIES = [
  { id: "professional-services", label: "Professional services", detail: "Consulting, agencies, and advisory firms." },
  { id: "healthcare", label: "Healthcare", detail: "Clinics, practices, and care providers." },
  { id: "home-services", label: "Home services", detail: "Local trades and home service companies." },
  { id: "legal", label: "Legal", detail: "Law firms and legal practices." },
  { id: "real-estate", label: "Real estate", detail: "Brokerages, property, and development." },
  { id: "financial-services", label: "Financial services", detail: "Advisors, lending, and insurance." },
  { id: "retail", label: "Retail", detail: "Stores and multi-location retail." },
  { id: "ecommerce", label: "E-commerce", detail: "Online stores and digital commerce." },
  { id: "hospitality", label: "Restaurant and hospitality", detail: "Dining, travel, and guest experiences." },
  { id: "manufacturing", label: "Manufacturing", detail: "Production and industrial businesses." },
  { id: "construction", label: "Construction", detail: "Builders, contractors, and trades." },
  { id: "automotive", label: "Automotive", detail: "Dealers, repair, and mobility." },
  { id: "education", label: "Education", detail: "Schools, training, and learning brands." },
  { id: "nonprofit", label: "Nonprofit", detail: "Causes, associations, and foundations." },
  { id: "technology", label: "Technology", detail: "Software, SaaS, and technical products." },
  { id: "beauty-wellness", label: "Beauty and wellness", detail: "Salons, fitness, and personal care." },
  { id: "other", label: "Other", detail: "An industry that is not listed here." }
];

export const MARKETS = [
  { id: "local", label: "Local" },
  { id: "regional", label: "Regional" },
  { id: "national", label: "National" },
  { id: "ecommerce", label: "E-commerce" },
  { id: "b2b", label: "B2B" },
  { id: "b2c", label: "B2C" },
  { id: "professional-services", label: "Professional services" },
  { id: "retail", label: "Retail" },
  { id: "manufacturing", label: "Manufacturing" },
  { id: "other", label: "Other" }
];

export const INTERESTS = [
  { id: "web-design", label: "Website Development", detail: "Responsive websites built to support search and conversion.", service: true },
  { id: "seo", label: "SEO", detail: "Organic search visibility and content growth.", service: true },
  { id: "local-seo", label: "Local SEO", detail: "Maps, local listings, and nearby-customer visibility.", service: true },
  { id: "technical-seo", label: "Technical SEO", detail: "Site health, indexing, and technical foundations.", service: false },
  { id: "social-media", label: "Social Media Marketing", detail: "Content, community, and social campaigns.", service: true },
  { id: "google-ads", label: "Google Ads", detail: "Paid search and performance campaigns.", service: true },
  { id: "meta-advertising", label: "Meta Advertising", detail: "Facebook and Instagram campaign measurement.", service: false },
  { id: "tiktok-advertising", label: "TikTok Advertising", detail: "Short-form paid reach and creative testing.", service: false },
  { id: "analytics-reporting", label: "Analytics & Reporting", detail: "Measurement, dashboards, and decision-ready reporting.", service: true },
  { id: "branding", label: "Branding", detail: "Positioning, identity, and message clarity.", service: true },
  { id: "ecommerce", label: "E-commerce", detail: "Online sales experiences and store performance.", service: false },
  { id: "content-marketing", label: "Content Marketing", detail: "Content that supports demand and search.", service: false },
  { id: "ai-marketing", label: "AI Marketing", detail: "Automation and AI-assisted marketing workflows.", service: true },
  { id: "other", label: "Other", detail: "A service interest that is not listed here.", service: false }
];

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"]
];

export const ONBOARDING_PAGES = {
  1: "/account/create",
  2: "/account/business",
  3: "/account/discovery",
  4: "/account/services",
  5: "/account/complete"
};
