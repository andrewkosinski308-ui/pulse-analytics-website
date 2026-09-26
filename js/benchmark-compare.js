/**
 * Compare a visitor's temporary result with one selected published observation.
 * The only calculation is that result minus the stored benchmark.
 */

export const COMPARE_LABEL = "Compare";
export const COMPARING_LABEL = "Comparing...";
export const SELECT_BENCHMARK_MESSAGE = "Select a benchmark before comparing.";
export const NUMBER_MESSAGE = "Enter a valid number.";
export const PERCENT_MESSAGE = "Enter a percentage between 0 and 100.";
export const CURRENCY_MESSAGE = "Enter a value of $0 or greater.";
export const COUNT_MESSAGE = "Enter a value of 0 or greater.";
export const COMPARE_HELPER = "Enter your result to compare it with the selected published benchmark.";
export const COMPARE_SECONDARY = "This comparison is provided for context. It does not determine whether your performance is good or bad.";
export const REPORT_NAME_HELPER = "Optional. This name appears on your downloaded report.";
export const CONTEXT_STATUS = "CONTEXT STATISTIC";
export const CONTEXT_ONLY_MESSAGE = "This statistic provides market context and is not a direct measure of business performance.";
export const COMPARISON_NOTICE = "Benchmarks provide context, not a universal target. Results can vary based on industry, audience, geography, device, channel, business model, and measurement method. Your result may not be directly comparable to the published benchmark.";
export const COMPARISON_REVIEW = "Review the source and methodology before drawing conclusions from the comparison.";
export const PDF_ERROR_MESSAGE = "Your comparison was created, but the report could not be generated. Please try again.";
export const COST_DIRECTION_NOTE = "Lower is generally less costly for this metric.";

const COMPARISON_DIRECTION = {
  "website-conversion-rate": "higher",
  "lead-conversion-rate": "higher",
  "landing-page-conversion": "higher",
  "open-rate": "higher",
  "click-rate": "higher",
  "click-to-open-rate": "higher",
  "unsubscribe-rate": "lower",
  "ctr": "higher",
  "cpc": "lower",
  "search-ad-conversion-rate": "higher",
  "cost-per-lead-conversion": "lower",
  "organic-ctr-by-search-position": "higher",
  "organic-search-conversion-rate": "higher",
  "local-search-use-rate": "context-only",
  "engagement-rate": "higher",
  "reach-rate": "higher",
  "paid-social-ctr": "higher",
  "ecommerce-conversion-rate": "higher",
  "cart-abandonment-rate": "lower",
  "average-order-value": "higher",
};

const COST_METRICS = new Set(["cpc", "cost-per-lead-conversion"]);

export function comparisonDirection(metricId) {
  return COMPARISON_DIRECTION[metricId] || "";
}

export function isContextOnly(metric) {
  return comparisonDirection(metric?.id) === "context-only";
}

export function directionNote(metricId) {
  return COST_METRICS.has(metricId) ? COST_DIRECTION_NOTE : "";
}

export function unitKind(unit) {
  if (unit === "percent") return "percent";
  if (unit === "USD") return "currency";
  return "count";
}

export function unitSymbol(unit) {
  const kind = unitKind(unit);
  if (kind === "percent") return "%";
  if (kind === "currency") return "$";
  return "count / number";
}

function toHundredths(raw) {
  const match = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const negative = match[0].startsWith("-");
  const [whole, fraction = ""] = match[0].slice(negative ? 1 : 0).split(".");
  const digits = `${fraction}000`.slice(0, 3);
  let hundredths = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (digits[2] >= "5") hundredths += 1;
  if (!Number.isSafeInteger(hundredths)) return null;
  return negative ? -hundredths : hundredths;
}

function formatHundredths(hundredths) {
  const negative = hundredths < 0;
  const absolute = Math.abs(hundredths);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function parseUserNumber(raw) {
  const text = String(raw ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: NUMBER_MESSAGE };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: NUMBER_MESSAGE };
  const hundredths = toHundredths(text);
  if (hundredths === null) return { ok: false, error: NUMBER_MESSAGE };
  return { ok: true, hundredths };
}

export function parseBenchmarkValue(value) {
  const text = String(value).trim();
  const range = text.match(/(\d+(?:\.\d+)?)\s*%?\s*[\u2013-]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    return {
      kind: "range",
      low: toHundredths(range[1]),
      high: toHundredths(range[2]),
      display: text,
    };
  }
  const single = text.match(/\d+(?:\.\d+)?/);
  if (!single) return null;
  return { kind: "single", value: toHundredths(single[0]), display: text };
}

function formatUser(hundredths, kind) {
  if (kind === "percent") return `${formatHundredths(hundredths)}%`;
  if (kind === "currency") return `$${formatHundredths(hundredths)}`;
  const absolute = Math.abs(hundredths);
  if (absolute % 100 === 0) return String(absolute / 100);
  return formatHundredths(hundredths);
}

function formatDifference(hundredths, kind) {
  if (kind === "percent") return `${formatHundredths(hundredths)} percentage points`;
  if (kind === "currency") {
    const negative = hundredths < 0;
    return `${negative ? "-" : ""}$${formatHundredths(Math.abs(hundredths))}`;
  }
  const negative = hundredths < 0;
  return `${negative ? "-" : ""}${formatUser(Math.abs(hundredths), "count")}`;
}

function plainAmount(hundredths, kind) {
  if (kind === "count") return formatUser(hundredths, "count");
  return formatHundredths(hundredths);
}

function relationshipSentence(amount, kind, direction, range) {
  const place = range ? "selected published benchmark range" : "selected published benchmark";
  if (direction === "equal") return "Your result matches the selected published benchmark.";
  if (direction === "within") return "Your result falls within the selected published benchmark range.";
  const word = direction === "below" ? "below" : "above";
  if (kind === "percent") return `Your result is ${amount} percentage points ${word} the ${place}.`;
  if (kind === "currency") return `Your result is $${amount} ${word} the ${place}.`;
  return `Your result is ${amount} ${word} the ${place}.`;
}

function contextFields(metric, observation) {
  return {
    metricId: metric.id,
    metricName: metric.name,
    observationId: observation.id,
    observationLabel: observation.label || "",
    provider: observation.provider,
    period: observation.period,
    segment: observation.segment,
    geography: observation.geography,
    report: observation.report,
    definition: observation.definition,
    methodology: observation.methodology,
    limitations: observation.limitations,
    sourceUrl: observation.sourceUrl,
    direction: comparisonDirection(metric.id),
    directionNote: directionNote(metric.id),
    notice: COMPARISON_NOTICE,
    review: COMPARISON_REVIEW,
  };
}

export function buildComparison(metric, observation, rawInput) {
  if (isContextOnly(metric)) {
    return { ok: false, contextOnly: true, status: CONTEXT_STATUS, message: CONTEXT_ONLY_MESSAGE };
  }
  if (!observation) return { ok: false, error: SELECT_BENCHMARK_MESSAGE };

  const parsed = parseUserNumber(rawInput);
  if (!parsed.ok) return parsed;

  const kind = unitKind(observation.unit);
  if (kind === "percent" && (parsed.hundredths < 0 || parsed.hundredths > 10000)) {
    return { ok: false, error: PERCENT_MESSAGE };
  }
  if (kind === "currency" && parsed.hundredths < 0) return { ok: false, error: CURRENCY_MESSAGE };
  if (kind === "count" && parsed.hundredths < 0) return { ok: false, error: COUNT_MESSAGE };

  const benchmark = parseBenchmarkValue(observation.value);
  if (!benchmark) return { ok: false, error: NUMBER_MESSAGE };

  const userHundredths = parsed.hundredths;
  let status = "";
  let differenceHundredths = null;
  let sentence = "";

  if (benchmark.kind === "range") {
    if (userHundredths < benchmark.low) {
      status = "BELOW BENCHMARK RANGE";
      differenceHundredths = userHundredths - benchmark.low;
      sentence = relationshipSentence(plainAmount(Math.abs(differenceHundredths), kind), kind, "below", true);
    } else if (userHundredths > benchmark.high) {
      status = "ABOVE BENCHMARK RANGE";
      differenceHundredths = userHundredths - benchmark.high;
      sentence = relationshipSentence(plainAmount(Math.abs(differenceHundredths), kind), kind, "above", true);
    } else {
      status = "WITHIN BENCHMARK RANGE";
      sentence = relationshipSentence("", kind, "within", true);
    }
  } else if (userHundredths < benchmark.value) {
    status = "BELOW BENCHMARK";
    differenceHundredths = userHundredths - benchmark.value;
    sentence = relationshipSentence(plainAmount(Math.abs(differenceHundredths), kind), kind, "below", false);
  } else if (userHundredths > benchmark.value) {
    status = "ABOVE BENCHMARK";
    differenceHundredths = userHundredths - benchmark.value;
    sentence = relationshipSentence(plainAmount(Math.abs(differenceHundredths), kind), kind, "above", false);
  } else {
    status = "AT BENCHMARK";
    differenceHundredths = 0;
    sentence = relationshipSentence("", kind, "equal", false);
  }

  return {
    ok: true,
    comparison: {
      ...contextFields(metric, observation),
      kind: benchmark.kind,
      unitKind: kind,
      userDisplay: formatUser(userHundredths, kind),
      benchmarkDisplay: benchmark.display,
      status,
      differenceDisplay: differenceHundredths === null ? sentence : formatDifference(differenceHundredths, kind),
      sentence,
      userHundredths,
      benchmarkHundredths: benchmark.kind === "single" ? benchmark.value : null,
      rangeLowHundredths: benchmark.kind === "range" ? benchmark.low : null,
      rangeHighHundredths: benchmark.kind === "range" ? benchmark.high : null,
    },
  };
}

export function clearComparisonState(state) {
  return {
    observationId: state.observationId || "",
    rawInput: "",
    reportName: "",
    comparison: null,
  };
}

export function reportFilename(name) {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `pulse-analytics-benchmark-report-${slug}.pdf` : "pulse-analytics-benchmark-report.pdf";
}

export function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function observationChoices(observations) {
  return observations.map((observation) => {
    const name = [observation.group, observation.label].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(observation.id)}">${escapeHtml(`${name} — ${observation.value}`)}</option>`;
  }).join("");
}

export function renderComparePanel(metric) {
  const headingId = `compare-heading-${metric.id}`;
  if (isContextOnly(metric)) {
    return `<section class="benchmark-compare" data-metric-id="${escapeHtml(metric.id)}" aria-labelledby="${headingId}">
      <h4 id="${headingId}">Compare Your Performance</h4>
      <p class="benchmark-status-label">Benchmark Status</p>
      <p class="benchmark-compare-status">${CONTEXT_STATUS}</p>
      <p>${CONTEXT_ONLY_MESSAGE}</p>
    </section>`;
  }

  const multiple = metric.observations.length > 1;
  const only = multiple ? "" : metric.observations[0];
  const selector = multiple
    ? `<label for="benchmark-observation-${metric.id}">Benchmark
        <select id="benchmark-observation-${metric.id}" class="benchmark-observation">
          <option value="">Select a benchmark</option>
          ${observationChoices(metric.observations)}
        </select>
      </label>`
    : "";
  const describedBy = `benchmark-unit-${metric.id} benchmark-helper-${metric.id} benchmark-context-note-${metric.id}`;

  return `<section class="benchmark-compare" data-metric-id="${escapeHtml(metric.id)}" ${only ? `data-observation-id="${escapeHtml(only.id)}"` : ""} aria-labelledby="${headingId}">
    <h4 id="${headingId}">Compare Your Performance</h4>
    <p id="benchmark-helper-${metric.id}">${COMPARE_HELPER}</p>
    <p id="benchmark-context-note-${metric.id}">${COMPARE_SECONDARY}</p>
    ${selector}
    <label for="benchmark-result-${metric.id}">Your Result</label>
    <div class="benchmark-unit">
      <input id="benchmark-result-${metric.id}" class="benchmark-result-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Enter your result" aria-describedby="${describedBy}">
      <span id="benchmark-unit-${metric.id}" class="benchmark-unit-symbol">${escapeHtml(unitSymbol(metric.observations[0].unit))}</span>
    </div>
    <label for="benchmark-report-name-${metric.id}">Business / Report Name</label>
    <input id="benchmark-report-name-${metric.id}" class="benchmark-report-name" type="text" autocomplete="off" placeholder="Enter a business or report name" aria-describedby="benchmark-report-help-${metric.id}">
    <p id="benchmark-report-help-${metric.id}" class="benchmark-help">${REPORT_NAME_HELPER}</p>
    <p class="benchmark-error" role="alert"></p>
    <div class="benchmark-actions">
      <button type="button" data-compare>${COMPARE_LABEL}</button>
      <button type="button" data-reset>Reset Comparison</button>
    </div>
  </section>`;
}

function row(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

export function renderComparisonResult(comparison) {
  const direction = comparison.directionNote ? `<p>${escapeHtml(comparison.directionNote)}</p>` : "";
  const selected = comparison.observationLabel ? row("Selected observation", comparison.observationLabel) : "";
  return `<div class="benchmark-outcome" aria-live="polite">
    <h4>YOUR COMPARISON</h4>
    <dl>
      ${row("Your Result", comparison.userDisplay)}
      ${row("Published Benchmark", comparison.benchmarkDisplay)}
      <dt>Benchmark Status</dt><dd class="benchmark-compare-status">${escapeHtml(comparison.status)}</dd>
      ${row("Difference", comparison.differenceDisplay)}
    </dl>
    <p>${escapeHtml(comparison.sentence)}</p>
    <h4>Benchmark Context</h4>
    <dl>
      ${row("Metric", comparison.metricName)}
      ${selected}
      ${row("Source", comparison.provider)}
      ${row("Period", comparison.period)}
      ${row("Segment", comparison.segment)}
      ${row("Geography", comparison.geography)}
      ${row("Dataset/report", comparison.report)}
    </dl>
    <h4>About This Benchmark</h4>
    <p>${escapeHtml(comparison.definition)}</p>
    <h5>Methodology</h5>
    <p>${escapeHtml(comparison.methodology)}</p>
    <h5>Limitations</h5>
    <p>${escapeHtml(comparison.limitations)}</p>
    ${direction}
    <p><a href="${escapeHtml(comparison.sourceUrl)}" target="_blank" rel="noopener noreferrer">View Source</a></p>
    <h4>About Benchmark Comparisons</h4>
    <p>${escapeHtml(comparison.notice)}</p>
    <p>${escapeHtml(comparison.review)}</p>
    <div class="benchmark-actions">
      <button type="button" data-download>Download Benchmark Report</button>
    </div>
    <p class="benchmark-pdf-error" role="alert"></p>
  </div>`;
}
