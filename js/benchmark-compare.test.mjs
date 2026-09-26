import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { benchmarkCatalog } from "../workers/benchmarks/catalog.js";
import { filterBenchmarks, renderBenchmarkCards } from "./benchmarks-state.js";
import {
  COMPARISON_NOTICE,
  COMPARISON_REVIEW,
  CONTEXT_ONLY_MESSAGE,
  CONTEXT_STATUS,
  COST_DIRECTION_NOTE,
  buildComparison,
  clearComparisonState,
  comparisonDirection,
  formatReportDate,
  parseBenchmarkValue,
  renderComparePanel,
  reportFilename,
} from "./benchmark-compare.js";
import { buildReportDownload } from "./benchmark-pdf.js";

const dash = "\u2013";
const catalog = benchmarkCatalog();
const metricById = (id) => catalog.metrics.find((metric) => metric.id === id);
const observationByLabel = (metric, label) => metric.observations.find((observation) => observation.label === label);

const openRate = metricById("open-rate");
const openObservation = openRate.observations[0];
const ctr = metricById("ctr");
const cpc = metricById("cpc");
const organic = metricById("organic-ctr-by-search-position");
const position1 = observationByLabel(organic, "Position 1");
const engagement = metricById("engagement-rate");
const instagram = observationByLabel(engagement, "Instagram");
const linkedin = observationByLabel(engagement, "LinkedIn");
const clickToOpen = metricById("click-to-open-rate");
const clickRange = observationByLabel(clickToOpen, "Industry range");
const localSearch = metricById("local-search-use-rate");

const countMetric = {
  id: "count-fixture",
  name: "Count fixture",
  observations: [],
};
const countObservation = {
  id: "count-fixture-1",
  label: "Items",
  value: "12",
  unit: "count",
  provider: "Fixture",
  period: "2026",
  segment: "Fixture",
  geography: "Fixture",
  report: "Fixture",
  definition: "A test count.",
  methodology: "Fixture methodology.",
  limitations: "Fixture limitations.",
  sourceUrl: "https://example.com/count",
};

function compared(metric, observation, input) {
  const outcome = buildComparison(metric, observation, input);
  assert.equal(outcome.ok, true, outcome.error || "comparison failed");
  return outcome.comparison;
}

const emailComparison = compared(openRate, openObservation, "31.20");
const rangeComparison = compared(clickToOpen, clickRange, "8.10");
const emailReport = {
  ...emailComparison,
  reportName: "Test Business",
  reportDate: "September 26, 2026",
};
const rangeReport = {
  ...rangeComparison,
  reportName: "",
  reportDate: "September 26, 2026",
};
const emailPdf = buildReportDownload(emailReport);
const rangePdf = buildReportDownload(rangeReport);

function pdfText(bytes) {
  return new TextDecoder().decode(bytes);
}

const emailPdfText = pdfText(emailPdf.bytes);
const rangePdfText = pdfText(rangePdf.bytes);

function assertValidPdf(bytes) {
  const text = pdfText(bytes);
  assert.match(text, /^%PDF-1\.4/);
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.match(text.slice(start), /^xref/);
  for (const match of text.matchAll(/^(\d{10}) 00000 n /gm)) {
    const offset = Number(match[1]);
    assert.match(text.slice(offset, offset + 12), /^\d+ 0 obj/);
  }
  for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)) {
    assert.equal(Buffer.byteLength(match[2]), Number(match[1]));
  }
}

test("below a single benchmark produces BELOW BENCHMARK", () => {
  assert.equal(emailComparison.status, "BELOW BENCHMARK");
  assert.equal(compared(ctr, ctr.observations[0], "4").status, "BELOW BENCHMARK");
});

test("an equal result produces AT BENCHMARK", () => {
  assert.equal(compared(openRate, openObservation, "43.46").status, "AT BENCHMARK");
  assert.equal(
    compared(openRate, openObservation, "43.46").sentence,
    "Your result matches the selected published benchmark.",
  );
});

test("an above result produces ABOVE BENCHMARK", () => {
  assert.equal(compared(openRate, openObservation, "50").status, "ABOVE BENCHMARK");
  assert.equal(compared(ctr, ctr.observations[0], "8").status, "ABOVE BENCHMARK");
  assert.match(compared(openRate, openObservation, "48.86").sentence, /5\.40 percentage points above/);
});

test("percentage difference is the direct percentage-point gap", () => {
  assert.equal(emailComparison.userDisplay, "31.20%");
  assert.equal(emailComparison.benchmarkDisplay, "43.46%");
  assert.equal(emailComparison.differenceDisplay, "-12.26 percentage points");
  assert.equal(
    emailComparison.sentence,
    "Your result is 12.26 percentage points below the selected published benchmark.",
  );
  assert.equal(emailComparison.relativeDifference, undefined);
});

test("currency difference is the direct dollar gap", () => {
  const result = compared(cpc, cpc.observations[0], "4.80");
  assert.equal(result.benchmarkDisplay, "$5.42");
  assert.equal(result.userDisplay, "$4.80");
  assert.equal(result.differenceDisplay, "-$0.62");
  assert.equal(result.status, "BELOW BENCHMARK");
  assert.equal(compared(metricById("average-order-value"), observationByLabel(metricById("average-order-value"), "Global"), "192").userDisplay, "$192.00");
});

test("count difference is the direct numeric gap", () => {
  const below = compared(countMetric, countObservation, "10");
  assert.equal(below.status, "BELOW BENCHMARK");
  assert.equal(below.differenceDisplay, "-2");
  assert.equal(compared(countMetric, countObservation, "15").status, "ABOVE BENCHMARK");
  assert.equal(compared(countMetric, countObservation, "15").differenceDisplay, "3");
  assert.equal(compared(countMetric, countObservation, "12").status, "AT BENCHMARK");
});

test("a result below a published range produces BELOW BENCHMARK RANGE", () => {
  const result = compared(clickToOpen, clickRange, "1");
  assert.equal(result.status, "BELOW BENCHMARK RANGE");
  assert.equal(result.benchmarkDisplay, `2.96%${dash}14.82%`);
  assert.equal(result.midpoint, undefined);
});

test("a result inside a published range produces WITHIN BENCHMARK RANGE", () => {
  assert.equal(rangeComparison.status, "WITHIN BENCHMARK RANGE");
  assert.equal(rangeComparison.userDisplay, "8.10%");
  assert.equal(rangeComparison.benchmarkDisplay, `2.96%${dash}14.82%`);
  assert.equal(rangeComparison.sentence, "Your result falls within the selected published benchmark range.");
  assert.equal(compared(clickToOpen, clickRange, "2.96").status, "WITHIN BENCHMARK RANGE");
  assert.equal(compared(clickToOpen, clickRange, "14.82").status, "WITHIN BENCHMARK RANGE");
});

test("a result above a published range produces ABOVE BENCHMARK RANGE", () => {
  assert.equal(compared(clickToOpen, clickRange, "20").status, "ABOVE BENCHMARK RANGE");
});

test("empty input is rejected", () => {
  assert.equal(buildComparison(openRate, openObservation, "").error, "Enter a valid number.");
  assert.equal(buildComparison(openRate, openObservation, "   ").error, "Enter a valid number.");
});

test("non-numeric input is rejected", () => {
  for (const value of ["abc", "NaN", "Infinity", "31.2%", "12.2.2", "1e2"]) {
    assert.equal(buildComparison(openRate, openObservation, value).error, "Enter a valid number.", value);
  }
});

test("a percentage below zero is rejected", () => {
  assert.equal(buildComparison(openRate, openObservation, "-0.1").error, "Enter a percentage between 0 and 100.");
});

test("a percentage above 100 is rejected", () => {
  assert.equal(buildComparison(openRate, openObservation, "100.01").error, "Enter a percentage between 0 and 100.");
  assert.equal(buildComparison(openRate, openObservation, "100").ok, true);
  assert.equal(buildComparison(openRate, openObservation, "0").ok, true);
});

test("negative currency is rejected", () => {
  assert.equal(buildComparison(cpc, cpc.observations[0], "-0.01").error, "Enter a value of $0 or greater.");
});

test("a negative count is rejected", () => {
  assert.equal(buildComparison(countMetric, countObservation, "-1").error, "Enter a value of 0 or greater.");
});

test("the comparison uses the selected observation", () => {
  const result = compared(engagement, instagram, "4");
  assert.equal(result.observationId, instagram.id);
  assert.equal(result.benchmarkDisplay, "3%");
  assert.equal(result.observationLabel, "Instagram");
});

test("observations are not combined or averaged", () => {
  const result = compared(engagement, instagram, "4");
  assert.equal(result.benchmarkDisplay, instagram.value);
  assert.notEqual(result.benchmarkDisplay, engagement.observations.map((observation) => observation.value).join(", "));
  assert.equal(result.benchmarkHundredths, 300);
  assert.equal(JSON.stringify(result).includes("LinkedIn"), false);
  assert.equal(JSON.stringify(result).includes("1.82"), false);
});

test("platform comparisons stay on the selected platform", () => {
  assert.equal(compared(engagement, instagram, "1").benchmarkDisplay, "3%");
  assert.equal(compared(engagement, linkedin, "1").benchmarkDisplay, "2%");
  assert.equal(compared(engagement, linkedin, "1").status, "BELOW BENCHMARK");
  const panel = renderComparePanel(engagement);
  assert.match(panel, new RegExp(`value="${instagram.id}"`));
  assert.match(panel, new RegExp(`value="${linkedin.id}"`));
  assert.match(panel, />Instagram — 3%</);
  assert.match(panel, />LinkedIn — 2%</);
});

test("search-position comparisons stay on the selected position", () => {
  const result = compared(organic, position1, "10");
  assert.equal(result.benchmarkDisplay, "20.02%");
  assert.equal(result.observationLabel, "Position 1");
  assert.equal(result.status, "BELOW BENCHMARK");
  assert.equal(JSON.stringify(result).includes("10.36"), false);
  assert.equal(JSON.stringify(result).includes("3.89"), false);
  assert.equal(compared(organic, observationByLabel(organic, "Position 2"), "10").benchmarkDisplay, "10.36%");
});

test("context-only statistics cannot be compared", () => {
  const outcome = buildComparison(localSearch, localSearch.observations[0], "50");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.contextOnly, true);
  assert.equal(outcome.comparison, undefined);
  const panel = renderComparePanel(localSearch);
  assert.equal(panel.includes("benchmark-result-input"), false);
  assert.equal(panel.includes("data-compare"), false);
});

test("context-only statistics display CONTEXT STATISTIC", () => {
  const outcome = buildComparison(localSearch, localSearch.observations[0], "84");
  assert.equal(outcome.status, CONTEXT_STATUS);
  assert.equal(outcome.message, CONTEXT_ONLY_MESSAGE);
  const panel = renderComparePanel(localSearch);
  assert.match(panel, /CONTEXT STATISTIC/);
  assert.match(panel, /This statistic provides market context and is not a direct measure of business performance\./);
});

test("the comparison shows the published source", () => {
  assert.equal(emailComparison.provider, "MailerLite");
  assert.equal(emailComparison.provider, openObservation.provider);
});

test("the comparison shows the published period", () => {
  assert.equal(emailComparison.period, `December 2024${dash}November 2025`);
  assert.equal(emailComparison.period, openObservation.period);
});

test("the comparison shows the published segment", () => {
  assert.equal(emailComparison.segment, "3.6M+ campaigns; 46 industries");
  assert.equal(emailComparison.segment, openObservation.segment);
});

test("the comparison shows the published geography", () => {
  assert.equal(emailComparison.geography, "Global");
  assert.equal(emailComparison.geography, openObservation.geography);
});

test("the comparison shows the published methodology", () => {
  assert.equal(emailComparison.methodology, openObservation.methodology);
  assert.equal(emailComparison.methodology, "Not stated by the source.");
});

test("the comparison shows the published limitations", () => {
  assert.equal(emailComparison.limitations, openObservation.limitations);
  assert.match(emailComparison.limitations, /Apple Mail Privacy Protection can inflate recorded opens\./);
});

test("the entered result is not persisted", () => {
  const source = [
    readFileSync(new URL("./benchmarks.js", import.meta.url), "utf8"),
    readFileSync(new URL("./benchmark-compare.js", import.meta.url), "utf8"),
    readFileSync(new URL("./benchmark-pdf.js", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("document.cookie"), false);
  assert.equal(source.includes("indexedDB"), false);
  assert.equal(source.includes("supabase"), false);
  const cleared = clearComparisonState({ observationId: openObservation.id, rawInput: "31.20", reportName: "Test Business", comparison: emailComparison });
  assert.equal(cleared.rawInput, "");
  assert.equal(cleared.comparison, null);
  assert.equal(cleared.observationId, openObservation.id);
});

test("the business or report name is not persisted", () => {
  const cleared = clearComparisonState({ observationId: "open-rate-1", reportName: "Test Business" });
  assert.equal(cleared.reportName, "");
  assert.equal(readFileSync(new URL("./benchmarks.js", import.meta.url), "utf8").includes("localStorage"), false);
});

test("comparison data is not sent to the backend", () => {
  const page = readFileSync(new URL("./benchmarks.js", import.meta.url), "utf8");
  const compare = readFileSync(new URL("./benchmark-compare.js", import.meta.url), "utf8");
  const pdf = readFileSync(new URL("./benchmark-pdf.js", import.meta.url), "utf8");
  assert.equal(page.match(/fetch\(/g).length, 1);
  assert.match(page, /fetch\("\/api\/benchmarks"\)/);
  assert.equal(compare.includes("fetch("), false);
  assert.equal(pdf.includes("fetch("), false);
  assert.equal(readFileSync(new URL("../workers/benchmarks/api.js", import.meta.url), "utf8").includes("reportName"), false);
});

test("a PDF can be generated for a single-value benchmark", () => {
  assert.equal(emailPdf.ok, true);
  assertValidPdf(emailPdf.bytes);
  assert.match(emailPdfText, /%PDF-1\.4/);
});

test("a PDF can be generated for a range benchmark", () => {
  assert.equal(rangePdf.ok, true);
  assertValidPdf(rangePdf.bytes);
  assert.match(rangePdfText, /WITHIN BENCHMARK RANGE/);
  assert.match(rangePdfText, /2\.96%/);
  assert.match(rangePdfText, /14\.82%/);
  assert.equal(rangePdfText.includes("6.81%"), false);
});

test("the PDF contains the selected benchmark", () => {
  assert.match(emailPdfText, /Open Rate/);
  assert.match(emailPdfText, /43\.46%/);
  assert.match(emailPdfText, /Median/);
  assert.equal(emailPdfText.includes("20.02%"), false);
  assert.equal(emailPdfText.includes("6.64%"), false);
});

test("the PDF contains the user's result", () => {
  assert.match(emailPdfText, /31\.20%/);
});

test("the PDF contains the benchmark status", () => {
  assert.match(emailPdfText, /BELOW BENCHMARK/);
});

test("the PDF contains the difference", () => {
  assert.match(emailPdfText, /-12\.26 percentage points/);
  assert.match(emailPdfText, /Your result is 12\.26 percentage points below the selected published benchmark\./);
});

test("the PDF contains source information", () => {
  assert.match(emailPdfText, /MailerLite/);
  assert.match(emailPdfText, /December 2024/);
  assert.match(emailPdfText, /November 2025/);
  assert.match(emailPdfText, /3\.6M\+ campaigns; 46 industries/);
  assert.match(emailPdfText, /Global/);
  assert.match(emailPdfText, /\/URI \(https:\/\/www\.mailerlite\.com\/blog\/compare-your-email-performance-metrics-industry-benchmarks\)/);
});

test("the PDF contains methodology and limitations", () => {
  assert.match(emailPdfText, /Not stated by the source\./);
  assert.match(emailPdfText, /Apple Mail Privacy Protection can inflate recorded opens\./);
  assert.match(emailPdfText, /Percentage of recipients recorded as opening an email\./);
});

test("the PDF contains the benchmark notice", () => {
  assert.match(emailPdfText, /Benchmarks provide context, not a universal target\./);
  assert.match(emailPdfText, /Review the source and methodology before drawing conclusions from the comparison\./);
  assert.equal(emailComparison.notice, COMPARISON_NOTICE);
  assert.equal(emailComparison.review, COMPARISON_REVIEW);
});

test("the PDF does not contain unrelated benchmark observations", () => {
  assert.equal(emailPdfText.includes("Instagram"), false);
  assert.equal(emailPdfText.includes("Position 2"), false);
  assert.equal(emailPdfText.includes("$5.42"), false);
  assert.equal(rangePdfText.includes("43.46%"), false);
});

test("the PDF filename is valid", () => {
  assert.equal(emailPdf.filename, "pulse-analytics-benchmark-report-test-business.pdf");
  assert.equal(reportFilename(""), "pulse-analytics-benchmark-report.pdf");
  assert.equal(reportFilename("Test/Business:Name"), "pulse-analytics-benchmark-report-test-business-name.pdf");
  assert.equal(reportFilename("../etc/passwd"), "pulse-analytics-benchmark-report-etc-passwd.pdf");
  assert.equal(emailPdf.filename.includes("/"), false);
  assert.equal(emailPdf.filename.includes("\\"), false);
});

test("PDF generation failure does not break comparison", () => {
  const failed = buildReportDownload(emailReport, {
    createPdf() {
      throw new Error("library exploded");
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.message, "Your comparison was created, but the report could not be generated. Please try again.");
  assert.equal(failed.comparison.status, "BELOW BENCHMARK");
  assert.equal(compared(openRate, openObservation, "31.2").differenceDisplay, "-12.26 percentage points");
});

test("all 20 existing metrics remain available", () => {
  assert.equal(catalog.metrics.length, 20);
  assert.equal(new Set(catalog.metrics.map((metric) => metric.id)).size, 20);
  for (const metric of catalog.metrics) assert.ok(comparisonDirection(metric.id));
});

test("all 39 existing observations remain unchanged", () => {
  const approved = [
    "5.13%",
    `1.4%${dash}3.3%`,
    "6.6%",
    "43.46%",
    "2.09%",
    "2.14%",
    "6.81%",
    `2.96%${dash}14.82%`,
    "0.22%",
    "0.20%",
    `Approximately 0.09%${dash}0.40%`,
    "6.64%",
    "$5.42",
    "8.18%",
    "$66.69",
    "20.02%",
    "10.36%",
    "3.89%",
    "4.9%",
    "84%",
    "3%",
    "2%",
    "1.8%",
    "1.5%",
    "0.8%",
    "4.0%",
    "4.1%",
    "4.5%",
    "1.20%",
    "1.15%",
    "0.80%",
    "0.55%",
    "0.20%",
    "Approximately 1.27%",
    "2.72%",
    "70.22%",
    "$192",
    "$265",
    "$169",
  ];
  const values = catalog.metrics.flatMap((metric) => metric.observations.map((observation) => observation.value));
  assert.deepEqual([...values].sort(), [...approved].sort());
  assert.equal(parseBenchmarkValue("Approximately 1.27%").kind, "single");
  assert.equal(parseBenchmarkValue(`2.96%${dash}14.82%`).kind, "range");
});

test("existing category filters still work", () => {
  const email = filterBenchmarks(catalog, { categoryId: "email-marketing" });
  assert.ok(email.some((metric) => metric.id === "open-rate"));
  assert.equal(email.some((metric) => metric.id === "ctr"), false);
});

test("existing metric filters still work", () => {
  const selected = filterBenchmarks(catalog, { metricId: "open-rate" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].observations[0].value, "43.46%");
});

test("existing source filters still work", () => {
  const mailerlite = filterBenchmarks(catalog, { provider: "MailerLite" });
  assert.ok(mailerlite.every((metric) => metric.observations.every((observation) => observation.provider === "MailerLite")));
  assert.ok(mailerlite.some((metric) => metric.id === "open-rate"));
});

test("existing period filters still work", () => {
  const july = filterBenchmarks(catalog, { period: "July 2026" });
  assert.ok(july.some((metric) => metric.id === "organic-ctr-by-search-position"));
  assert.equal(filterBenchmarks(catalog, { categoryId: "email-marketing", period: "July 2026" }).length, 0);
});

test("existing View Source links still work", () => {
  const html = renderBenchmarkCards(catalog.metrics);
  assert.match(html, /https:\/\/www\.mailerlite\.com\/blog\/compare-your-email-performance-metrics-industry-benchmarks/);
  assert.match(html, /target="_blank"/);
  assert.equal(html.includes("localStorage"), false);
});

test("Research Library still works", () => {
  const router = readFileSync(new URL("../workers/router.js", import.meta.url), "utf8");
  const research = readFileSync(new URL("../workers/research/api.js", import.meta.url), "utf8");
  assert.match(router, /\/api\/research\//);
  assert.match(research, /export async function handleResearchRequest/);
});

test("Market Intelligence still works", () => {
  const router = readFileSync(new URL("../workers/router.js", import.meta.url), "utf8");
  const market = readFileSync(new URL("../workers/market-intelligence/api.js", import.meta.url), "utf8");
  assert.match(router, /\/api\/market-intelligence\//);
  assert.match(market, /handleMarketIntelligenceRequest/);
});

test("directional context stays descriptive", () => {
  assert.equal(comparisonDirection("ctr"), "higher");
  assert.equal(comparisonDirection("cpc"), "lower");
  assert.equal(comparisonDirection("local-search-use-rate"), "context-only");
  assert.equal(compared(cpc, cpc.observations[0], "4.80").directionNote, COST_DIRECTION_NOTE);
  assert.equal(compared(metricById("unsubscribe-rate"), metricById("unsubscribe-rate").observations[0], "0.10").directionNote, "");
  assert.equal(formatReportDate(new Date(2026, 8, 26)), "September 26, 2026");
  assert.match(emailPdfText, /Prepared for: Test Business/);
  assert.match(emailPdfText, /Report Date: September 26, 2026/);
  assert.match(emailPdfText, /Pulse Analytics Group LLC/);
  assert.match(emailPdfText, /Marketing Benchmark Comparison Report/);
  assert.equal(rangePdfText.includes("Prepared for:"), false);
});
