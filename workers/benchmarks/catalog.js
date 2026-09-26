/**
 * Approved Marketing Benchmarks source map.
 * Values are copied from the approved map. Nothing here is calculated,
 * averaged, or filled in when a source left it unstated.
 */

import { EMPTY_MESSAGE, ERROR_MESSAGE, LOADING_MESSAGE } from "../../js/benchmarks-state.js";

const NOT_STATED = "Not stated by the source.";
const DASH = "\u2013";

export { EMPTY_MESSAGE, ERROR_MESSAGE, LOADING_MESSAGE };

export const CATEGORIES = [
  { id: "website-conversion", name: "Website & Conversion" },
  { id: "email-marketing", name: "Email Marketing" },
  { id: "advertising", name: "Advertising" },
  { id: "search-seo", name: "Search & SEO" },
  { id: "social-media", name: "Social Media" },
  { id: "ecommerce", name: "Ecommerce" },
];

function observation(metric, index, fields) {
  return {
    id: `${metric.id}-${index + 1}`,
    label: fields.label || "",
    group: fields.group || "",
    value: fields.value,
    unit: fields.unit,
    provider: fields.provider || metric.provider,
    report: fields.report || NOT_STATED,
    sourceUrl: fields.sourceUrl || metric.sourceUrl,
    period: fields.period || metric.period,
    segment: fields.segment || metric.segment,
    geography: fields.geography || metric.geography,
    definition: metric.definition,
    methodology: fields.methodology || NOT_STATED,
    limitations: fields.limitations || metric.limitations,
    statement: fields.statement || "",
  };
}

function metric(spec) {
  const record = {
    id: spec.id,
    name: spec.name,
    categoryId: spec.categoryId,
    definition: spec.definition,
    limitations: spec.limitations,
    note: spec.note || "",
    provider: spec.provider,
    sourceUrl: spec.sourceUrl,
    period: spec.period,
    segment: spec.segment,
    geography: spec.geography,
    published: true,
  };
  record.observations = spec.observations.map((fields, index) => observation(record, index, fields));
  return record;
}

const mailerlite = {
  provider: "MailerLite",
  sourceUrl: "https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks",
  period: `December 2024${DASH}November 2025`,
  segment: "3.6M+ campaigns; 46 industries",
  geography: "Global",
};

const wordstream = {
  provider: "WordStream / LocaliQ",
  sourceUrl: "https://www.wordstream.com/ppc-benchmarks",
  period: `April 2025${DASH}March 2026`,
  segment: "13,000+ search campaigns; 23 industries",
  geography: "United States",
};

const dynamicYield = {
  provider: "Dynamic Yield",
  period: "Current rolling 12 months",
  geography: "Global",
};

export const METRICS = [
  metric({
    id: "website-conversion-rate",
    name: "Website Conversion Rate",
    categoryId: "website-conversion",
    provider: "Ruler Analytics",
    sourceUrl: "https://www.ruleranalytics.com/blog/insight/conversion-rate-by-industry/",
    period: "2026",
    segment: "13 industries; 110M+ sessions and 5M+ conversions",
    geography: "Not stated by source",
    definition: "Ruler defines a conversion as a qualified lead or sale.",
    limitations: "This is not a universal ecommerce purchase rate. It combines qualified leads and sales and varies by industry, traffic source, sales cycle, and offer value.",
    observations: [{ label: "Overall", value: "5.13%", unit: "percent" }],
  }),
  metric({
    id: "lead-conversion-rate",
    name: "Lead Conversion Rate",
    categoryId: "website-conversion",
    provider: "First Page Sage",
    sourceUrl: "https://firstpagesage.com/seo-blog/website-traffic-to-lead-conversion-rate/",
    period: "2026 report; data through 2025",
    segment: "Approximately 45% B2B, 20% B2C, 35% mixed",
    geography: "Not stated",
    definition: "Visitor action that results in becoming a lead, such as a contact, appointment, or demo.",
    limitations: "The range varies by page type and industry. It is not one universal lead-conversion benchmark.",
    observations: [{ label: "Across reported page types", value: `1.4%${DASH}3.3%`, unit: "percent" }],
  }),
  metric({
    id: "landing-page-conversion",
    name: "Landing-Page Conversion",
    categoryId: "website-conversion",
    provider: "Unbounce",
    sourceUrl: "https://unbounce.com/conversion-benchmark-report/",
    period: `Data July 23, 2023${DASH}July 23, 2024`,
    segment: "41K+ landing pages; 464M visitors; 57M conversions",
    geography: "Not stated",
    definition: "Conversions divided by landing-page visitors.",
    limitations: "Conversion definitions differ by page. Industry, device, traffic source, and offer affect results.",
    observations: [{ label: "Median overall", value: "6.6%", unit: "percent" }],
  }),
  metric({
    id: "open-rate",
    name: "Open Rate",
    categoryId: "email-marketing",
    ...mailerlite,
    definition: "Percentage of recipients recorded as opening an email.",
    limitations: "Apple Mail Privacy Protection can inflate recorded opens.",
    observations: [{ label: "Median", value: "43.46%", unit: "percent" }],
  }),
  metric({
    id: "click-rate",
    name: "Click Rate",
    categoryId: "email-marketing",
    ...mailerlite,
    definition: "Recipients clicking a link divided by recipients.",
    limitations: "Depends on email content and number/type of links. Industry variation is substantial.",
    observations: [
      { label: "Overall average", value: "2.09%", unit: "percent" },
      { label: "US & Canada", value: "2.14%", unit: "percent", geography: "US & Canada" },
    ],
  }),
  metric({
    id: "click-to-open-rate",
    name: "Click-to-Open Rate",
    categoryId: "email-marketing",
    ...mailerlite,
    definition: "Percentage of people who opened an email who then clicked.",
    limitations: "Open-rate measurement is affected by Apple Mail Privacy Protection, which also affects CTOR.",
    observations: [
      { label: "Median", value: "6.81%", unit: "percent" },
      { label: "Industry range", value: `2.96%${DASH}14.82%`, unit: "percent" },
    ],
  }),
  metric({
    id: "unsubscribe-rate",
    name: "Unsubscribe Rate",
    categoryId: "email-marketing",
    ...mailerlite,
    definition: "Recipients who unsubscribe divided by recipients.",
    limitations: "Varies with list composition, industry, and email practices.",
    observations: [
      { label: "Median", value: "0.22%", unit: "percent" },
      { label: "US & Canada", value: "0.20%", unit: "percent", geography: "US & Canada" },
      { label: "Industry range", value: `Approximately 0.09%${DASH}0.40%`, unit: "percent" },
    ],
  }),
  metric({
    id: "ctr",
    name: "CTR",
    categoryId: "advertising",
    ...wordstream,
    definition: "Clicks divided by impressions.",
    limitations: "Search advertising only. Industry variation is significant.",
    observations: [{ label: "Average", value: "6.64%", unit: "percent" }],
  }),
  metric({
    id: "cpc",
    name: "CPC",
    categoryId: "advertising",
    ...wordstream,
    definition: "Advertising spend divided by clicks.",
    limitations: "Varies by industry, competition, keyword, geography, and auction conditions.",
    observations: [{ label: "Average", value: "$5.42", unit: "USD" }],
  }),
  metric({
    id: "search-ad-conversion-rate",
    name: "Conversion Rate",
    categoryId: "advertising",
    ...wordstream,
    definition: "Conversions divided by ad clicks.",
    limitations: "Conversion definitions and campaign objectives vary.",
    observations: [{ label: "Average", value: "8.18%", unit: "percent" }],
  }),
  metric({
    id: "cost-per-lead-conversion",
    name: "Cost per Lead / Conversion",
    categoryId: "advertising",
    ...wordstream,
    sourceUrl: "https://www.wordstream.com/blog/2026-google-ads-benchmarks",
    definition: "Cost per lead/conversion for lead-oriented search campaigns.",
    limitations: "This is primarily a cost-per-lead benchmark. Do not present it as a universal cost per sale.",
    observations: [{ label: "Average cost per lead", value: "$66.69", unit: "USD" }],
  }),
  metric({
    id: "organic-ctr-by-search-position",
    name: "Organic CTR by Search Position",
    categoryId: "search-seo",
    provider: "Advanced Web Ranking",
    sourceUrl: "https://www.advancedwebranking.com/seo/organic-ctr",
    period: "July 2026",
    segment: "Google organic results",
    geography: "U.S. desktop",
    definition: "Organic clicks divided by organic impressions, segmented by ranking position.",
    limitations: "CTR varies significantly with SERP features, intent, device, industry, and query type. This is a position-based benchmark, not a single universal CTR.",
    observations: [
      { label: "Position 1", value: "20.02%", unit: "percent" },
      { label: "Position 2", value: "10.36%", unit: "percent" },
      { label: "Position 3", value: "3.89%", unit: "percent" },
    ],
  }),
  metric({
    id: "organic-search-conversion-rate",
    name: "Organic Search Conversion Rate",
    categoryId: "search-seo",
    provider: "Ruler Analytics",
    sourceUrl: "https://www.ruleranalytics.com/blog/insight/conversion-rate-by-industry/",
    period: "2026",
    segment: "13 industries",
    geography: "Not stated",
    definition: "Website conversions attributed to organic search traffic.",
    limitations: "This is a downstream conversion metric, not a Google ranking metric. Industry variation is substantial.",
    observations: [{ label: "Average", value: "4.9%", unit: "percent" }],
  }),
  metric({
    id: "local-search-use-rate",
    name: "Local Search Use Rate",
    categoryId: "search-seo",
    provider: "BrightLocal",
    sourceUrl: "https://www.brightlocal.com/research/consumer-search-behavior-channels/",
    period: "2026",
    segment: "Consumers searching for local businesses",
    geography: "Not stated in the selected source",
    definition: "Percentage of consumers reporting a recent online local-business search.",
    limitations: "It does not measure a business's local SEO performance.",
    note: "This describes consumer behavior. It is a search behavior statistic, not a business performance benchmark.",
    observations: [{
      label: "Consumers",
      value: "84%",
      unit: "percent",
      statement: "84% of consumers searched for a local business online in the previous three months",
    }],
  }),
  metric({
    id: "engagement-rate",
    name: "Engagement Rate",
    categoryId: "social-media",
    provider: "Hootsuite",
    sourceUrl: "https://blog.hootsuite.com/social-media-benchmarks/",
    period: "2026",
    segment: "All industries; platform-specific",
    geography: "Not stated",
    definition: "Engagement relative to the selected platform denominator.",
    limitations: "Calculation methods and denominators differ by platform.",
    observations: [
      { label: "Instagram", value: "3%", unit: "percent" },
      { label: "LinkedIn", value: "2%", unit: "percent" },
      { label: "X", value: "1.8%", unit: "percent" },
      { label: "TikTok", value: "1.5%", unit: "percent" },
      { label: "Facebook", value: "0.8%", unit: "percent" },
    ],
  }),
  metric({
    id: "reach-rate",
    name: "Reach Rate",
    categoryId: "social-media",
    provider: "Socialinsider",
    sourceUrl: "https://www.socialinsider.io/blog/social-media-reach/",
    period: "2026",
    segment: "Brand/social posts; platform and format specific",
    geography: "Global benchmark study",
    definition: "Reach relative to the account's audience/follower base.",
    limitations: "Varies by platform, account size, content format, and algorithm.",
    observations: [
      { group: "Instagram", label: "Images", value: "4.0%", unit: "percent" },
      { group: "Instagram", label: "Reels", value: "4.1%", unit: "percent" },
      { group: "Instagram", label: "Carousels", value: "4.5%", unit: "percent" },
      { group: "Facebook", label: "Images", value: "1.20%", unit: "percent" },
      { group: "Facebook", label: "Albums", value: "1.15%", unit: "percent" },
      { group: "Facebook", label: "Status", value: "0.80%", unit: "percent" },
      { group: "Facebook", label: "Reels", value: "0.55%", unit: "percent" },
      { group: "Facebook", label: "Links", value: "0.20%", unit: "percent" },
    ],
  }),
  metric({
    id: "paid-social-ctr",
    name: "Paid Social CTR",
    categoryId: "social-media",
    provider: "Shopify",
    sourceUrl: "https://www.shopify.com/blog/ctr-meaning",
    period: "Current 2025/2026 reference",
    segment: "Paid Facebook/Instagram ads",
    geography: "Not stated",
    definition: "Ad clicks divided by impressions.",
    limitations: "Creative, targeting, campaign objective, placement, and platform affect CTR. Do not compare this directly with Google Search CTR or organic social CTR.",
    observations: [{ label: "Facebook and Instagram ads", value: "Approximately 1.27%", unit: "percent" }],
  }),
  metric({
    id: "ecommerce-conversion-rate",
    name: "Ecommerce Conversion Rate",
    categoryId: "ecommerce",
    ...dynamicYield,
    provider: "Dynamic Yield",
    sourceUrl: "https://marketing.dynamicyield.com/benchmarks/conversion-rate/",
    segment: "Ecommerce visitors",
    definition: "Completed purchases divided by visitors.",
    limitations: "Varies by industry, device, traffic source, and region.",
    observations: [{ label: "Global average", value: "2.72%", unit: "percent" }],
  }),
  metric({
    id: "cart-abandonment-rate",
    name: "Cart Abandonment Rate",
    categoryId: "ecommerce",
    provider: "Baymard Institute",
    sourceUrl: "https://baymard.com/lists/cart-abandonment-rate",
    period: "Current published benchmark; 50-study compilation",
    segment: "Ecommerce checkout studies",
    geography: "Global/multi-study",
    definition: "Shopping carts that are abandoned rather than completed.",
    limitations: "Based on 50 studies with differing samples and methods. Abandonment also includes legitimate \"just browsing\" behavior.",
    observations: [{ label: "Average documented rate", value: "70.22%", unit: "percent" }],
  }),
  metric({
    id: "average-order-value",
    name: "Average Order Value",
    categoryId: "ecommerce",
    ...dynamicYield,
    provider: "Dynamic Yield",
    sourceUrl: "https://marketing.dynamicyield.com/benchmarks/average-order-value/",
    segment: "Ecommerce",
    definition: "Average value of completed purchases.",
    limitations: "Varies significantly by product category, device, and region.",
    observations: [
      { label: "Global", value: "$192", unit: "USD" },
      { label: "Desktop", value: "$265", unit: "USD" },
      { label: "Mobile", value: "$169", unit: "USD" },
    ],
  }),
];

export function benchmarkCatalog() {
  return {
    categories: CATEGORIES,
    metrics: METRICS.filter((item) => item.published),
  };
}

function quote(value) {
  const text = String(value ?? "");
  if (text.includes("$pulse$")) throw new Error("benchmark text cannot include the SQL delimiter");
  return `$pulse$${text}$pulse$`;
}

export function benchmarkMigrationSql() {
  const metricRows = METRICS.map((item) => {
    const category = CATEGORIES.find((entry) => entry.id === item.categoryId);
    return `    (${quote(item.id)}, ${quote(item.name)}, ${quote(item.categoryId)}, ${quote(category.name)}, ${quote(item.definition)}, ${quote(item.limitations)}, ${quote(item.note)}, ${item.published}, ${METRICS.indexOf(item) + 1})`;
  }).join(",\n");
  const observationRows = METRICS.flatMap((item) => item.observations.map((entry, index) =>
    `    (${quote(entry.id)}, ${quote(item.id)}, ${quote(entry.label)}, ${quote(entry.group)}, ${quote(entry.value)}, ${quote(entry.unit)}, ${quote(entry.provider)}, ${quote(entry.report)}, ${quote(entry.sourceUrl)}, ${quote(entry.period)}, ${quote(entry.segment)}, ${quote(entry.geography)}, ${quote(entry.definition)}, ${quote(entry.methodology)}, ${quote(entry.limitations)}, ${quote(entry.statement || "")}, ${index + 1})`
  )).join(",\n");

  return `-- Approved Marketing Benchmarks source map.
-- Values are the approved observations. No averages or filled-in gaps are stored.

CREATE TABLE public.benchmark_metrics (
    id text PRIMARY KEY,
    name text NOT NULL,
    category_id text NOT NULL,
    category_name text NOT NULL,
    definition text NOT NULL,
    limitations text NOT NULL,
    note text NOT NULL DEFAULT '',
    published boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL,
    CONSTRAINT benchmark_metrics_name_present CHECK (length(trim(name)) > 0),
    CONSTRAINT benchmark_metrics_category CHECK (category_id IN (
        'website-conversion',
        'email-marketing',
        'advertising',
        'search-seo',
        'social-media',
        'ecommerce'
    ))
);

CREATE TABLE public.benchmark_observations (
    id text PRIMARY KEY,
    metric_id text NOT NULL REFERENCES public.benchmark_metrics (id),
    label text NOT NULL DEFAULT '',
    group_label text NOT NULL DEFAULT '',
    value_text text NOT NULL,
    unit text NOT NULL,
    provider text NOT NULL,
    report_name text NOT NULL,
    source_url text NOT NULL,
    period_text text NOT NULL,
    segment text NOT NULL,
    geography text NOT NULL,
    definition text NOT NULL,
    methodology text NOT NULL,
    limitations text NOT NULL,
    statement text NOT NULL DEFAULT '',
    sort_order integer NOT NULL,
    CONSTRAINT benchmark_observations_value_present CHECK (length(trim(value_text)) > 0),
    CONSTRAINT benchmark_observations_https CHECK (source_url ~ '^https://'),
    CONSTRAINT benchmark_observations_order UNIQUE (metric_id, sort_order)
);

ALTER TABLE public.benchmark_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmark_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY benchmark_metrics_select
    ON public.benchmark_metrics
    FOR SELECT
    TO anon, authenticated
    USING (published = true);

CREATE POLICY benchmark_observations_select
    ON public.benchmark_observations
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.benchmark_metrics metric
            WHERE metric.id = metric_id
              AND metric.published = true
        )
    );

REVOKE ALL ON TABLE
    public.benchmark_metrics,
    public.benchmark_observations
FROM PUBLIC, anon;

GRANT SELECT ON TABLE
    public.benchmark_metrics,
    public.benchmark_observations
TO anon, authenticated;

INSERT INTO public.benchmark_metrics (
    id, name, category_id, category_name, definition, limitations, note, published, sort_order
) VALUES
${metricRows};

INSERT INTO public.benchmark_observations (
    id, metric_id, label, group_label, value_text, unit, provider, report_name, source_url,
    period_text, segment, geography, definition, methodology, limitations, statement, sort_order
) VALUES
${observationRows};
`;
}
