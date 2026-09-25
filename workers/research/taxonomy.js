// Pulse-owned research taxonomy. Slugs are stable identifiers.
// OpenAlex labels are not part of this list and must not create rows here.

export const CATEGORIES = [
  {
    slug: "search-seo",
    displayName: "Search & SEO",
    description: "Research on search engines, search behavior, organic visibility, SEO practices, and how people discover information online.",
    sortOrder: 1,
    topics: [
      ["seo", "SEO", "Research on search engine optimization, organic visibility, ranking systems, and search-oriented website practices."],
      ["search-behavior", "Search Behavior", "Research on how people search, choose results, refine queries, and interact with search systems."],
      ["local-search", "Local Search", "Research on local discovery, location-based search behavior, and how people find nearby businesses and services."],
      ["search-engines", "Search Engines", "Research concerning search engines, retrieval systems, indexing, ranking, and search result presentation."],
      ["information-retrieval", "Information Retrieval", "Research on methods for finding, organizing, ranking, and retrieving relevant information from large collections."]
    ]
  },
  {
    slug: "analytics-measurement",
    displayName: "Analytics & Measurement",
    description: "Research on marketing measurement, web analytics, attribution, experimentation, data quality, and methods for evaluating performance.",
    sortOrder: 2,
    topics: [
      ["web-analytics", "Web Analytics", "Research on measuring website behavior, traffic, engagement, conversions, and digital interactions."],
      ["marketing-measurement", "Marketing Measurement", "Research on evaluating marketing activity, outcomes, effectiveness, and performance."],
      ["attribution", "Attribution", "Research on methods for connecting marketing activity with customer actions and business outcomes."],
      ["experimentation", "Experimentation", "Research on controlled testing, A/B testing, causal inference, and methods for evaluating changes."],
      ["data-quality", "Data Quality", "Research on the accuracy, completeness, consistency, reliability, and usability of marketing and business data."]
    ]
  },
  {
    slug: "ai-marketing-technology",
    displayName: "AI & Marketing Technology",
    description: "Research on artificial intelligence, generative AI, marketing automation, martech systems, personalization, and human use of marketing technology.",
    sortOrder: 3,
    topics: [
      ["ai-in-marketing", "AI in Marketing", "Research examining how artificial intelligence is used in marketing activities, workflows, and decision support."],
      ["generative-ai", "Generative AI", "Research on systems that generate text, images, audio, video, code, or other marketing-related content."],
      ["marketing-automation", "Marketing Automation", "Research on automated marketing workflows, lead processes, customer communication, and campaign operations."],
      ["martech", "Marketing Technology", "Research on technologies and systems used to plan, execute, measure, and manage marketing activity."],
      ["personalization", "Personalization", "Research on tailoring digital experiences, content, recommendations, and communications to individuals or segments."]
    ]
  },
  {
    slug: "websites-ux-conversion",
    displayName: "Websites, UX & Conversion",
    description: "Research on website usability, user experience, conversion behavior, accessibility, landing pages, and digital performance.",
    sortOrder: 4,
    topics: [
      ["user-experience", "User Experience", "Research on how people experience, understand, navigate, and interact with digital products and websites."],
      ["usability", "Usability", "Research on ease of use, learnability, efficiency, error prevention, and user interaction with websites and software."],
      ["conversion-optimization", "Conversion Optimization", "Research on factors that influence desired actions such as inquiries, registrations, purchases, and sign-ups."],
      ["landing-pages", "Landing Pages", "Research on the design, messaging, structure, and performance of pages built around specific user actions."],
      ["accessibility", "Accessibility", "Research on making websites and digital experiences usable by people with disabilities and different access needs."],
      ["website-performance", "Website Performance", "Research on page speed, responsiveness, technical performance, and their relationship to digital experiences and outcomes."]
    ]
  }
];

export function taxonomyTopics() {
  return CATEGORIES.flatMap((category) => category.topics.map(([slug, displayName, description], index) => ({
    slug,
    displayName,
    description,
    sortOrder: index + 1,
    categorySlug: category.slug
  })));
}
