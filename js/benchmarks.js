import { ERROR_MESSAGE, LOADING_MESSAGE, filterBenchmarks, filterOptions, renderBenchmarkCards, selectionMessage } from "./benchmarks-state.js";
import {
  COMPARE_LABEL,
  COMPARING_LABEL,
  PDF_ERROR_MESSAGE,
  buildComparison,
  clearComparisonState,
  formatReportDate,
  renderComparePanel,
  renderComparisonResult,
  unitSymbol,
} from "./benchmark-compare.js";
import { buildReportDownload } from "./benchmark-pdf.js";

const status = document.querySelector("#benchmark-status");
const results = document.querySelector("#benchmark-results");
const form = document.querySelector("#benchmark-filters");
const categories = document.querySelector("#benchmark-categories");

const drafts = new Map();
let reportName = "";
let visibleMetrics = new Map();

status.textContent = LOADING_MESSAGE;

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function fillSelect(select, entries, allLabel) {
  const current = select.value;
  select.replaceChildren(option("", allLabel));
  for (const entry of entries) select.append(option(entry.value, entry.label));
  select.value = [...select.options].some((item) => item.value === current) ? current : "";
  select.disabled = false;
}

function currentFilters() {
  return {
    categoryId: form.category.value,
    metricId: form.metric.value,
    provider: form.source.value,
    period: form.period.value,
  };
}

function rememberDrafts() {
  const named = results.querySelector(".benchmark-report-name");
  if (named) reportName = named.value;
  for (const panel of results.querySelectorAll(".benchmark-compare")) {
    const existing = drafts.get(panel.dataset.metricId) || {};
    const input = panel.querySelector(".benchmark-result-input");
    const select = panel.querySelector(".benchmark-observation");
    drafts.set(panel.dataset.metricId, {
      ...existing,
      rawInput: input ? input.value : existing.rawInput || "",
      observationId: select ? select.value : panel.dataset.observationId || existing.observationId || "",
    });
  }
}

function selectedObservation(metric, panel) {
  if (metric.observations.length === 1) return metric.observations[0];
  const id = panel.querySelector(".benchmark-observation")?.value || "";
  return metric.observations.find((observation) => observation.id === id) || null;
}

function showOutcome(panel, comparison) {
  panel.querySelector(".benchmark-outcome")?.remove();
  panel.insertAdjacentHTML("beforeend", renderComparisonResult(comparison));
}

function show(catalog) {
  rememberDrafts();
  const metrics = filterBenchmarks(catalog, currentFilters());
  visibleMetrics = new Map(metrics.map((metric) => [metric.id, metric]));
  results.innerHTML = renderBenchmarkCards(metrics);
  for (const article of results.querySelectorAll(".benchmark-card")) {
    const metric = visibleMetrics.get(article.dataset.metricId);
    if (!metric) continue;
    article.insertAdjacentHTML("beforeend", renderComparePanel(metric));
    const panel = article.querySelector(".benchmark-compare");
    const draft = drafts.get(metric.id);
    const nameField = panel.querySelector(".benchmark-report-name");
    if (nameField) nameField.value = reportName;
    if (!draft) continue;
    const input = panel.querySelector(".benchmark-result-input");
    if (input && draft.rawInput) input.value = draft.rawInput;
    const select = panel.querySelector(".benchmark-observation");
    if (select && draft.observationId && [...select.options].some((item) => item.value === draft.observationId)) {
      select.value = draft.observationId;
    }
    if (draft.comparison && draft.comparison.observationId === (select?.value || panel.dataset.observationId)) {
      showOutcome(panel, draft.comparison);
    }
  }
  status.textContent = selectionMessage(metrics);
  for (const button of categories.querySelectorAll("button[data-category]")) {
    button.setAttribute("aria-pressed", button.dataset.category === form.category.value ? "true" : "false");
  }
}

function savePdf(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

results.addEventListener("input", (event) => {
  const panel = event.target.closest(".benchmark-compare");
  if (!panel) return;
  const draft = drafts.get(panel.dataset.metricId) || {};
  if (event.target.classList.contains("benchmark-result-input")) draft.rawInput = event.target.value;
  if (event.target.classList.contains("benchmark-report-name")) {
    reportName = event.target.value;
    for (const field of results.querySelectorAll(".benchmark-report-name")) {
      if (field !== event.target) field.value = reportName;
    }
  }
  drafts.set(panel.dataset.metricId, draft);
});

results.addEventListener("change", (event) => {
  if (!event.target.classList.contains("benchmark-observation")) return;
  const panel = event.target.closest(".benchmark-compare");
  const draft = drafts.get(panel.dataset.metricId) || {};
  draft.observationId = event.target.value;
  draft.comparison = null;
  const metric = visibleMetrics.get(panel.dataset.metricId);
  const observation = metric?.observations.find((item) => item.id === event.target.value);
  const symbol = panel.querySelector(".benchmark-unit-symbol");
  if (observation && symbol) symbol.textContent = unitSymbol(observation.unit);
  drafts.set(panel.dataset.metricId, draft);
  panel.querySelector(".benchmark-outcome")?.remove();
});

results.addEventListener("click", async (event) => {
  const panel = event.target.closest(".benchmark-compare");
  if (!panel) return;
  const metric = visibleMetrics.get(panel.dataset.metricId);
  if (!metric) return;

  if (event.target.closest("[data-compare]")) {
    const button = event.target.closest("[data-compare]");
    const input = panel.querySelector(".benchmark-result-input");
    const error = panel.querySelector(".benchmark-error");
    button.disabled = true;
    button.textContent = COMPARING_LABEL;
    await new Promise((resolve) => {
      if (document.hidden) {
        resolve();
        return;
      }
      requestAnimationFrame(() => resolve());
    });
    try {
      const observation = selectedObservation(metric, panel);
      const outcome = buildComparison(metric, observation, input ? input.value : "");
      if (!outcome.ok) {
        if (error) error.textContent = outcome.error || "";
        if (input && observation) input.setAttribute("aria-invalid", "true");
        else input?.removeAttribute("aria-invalid");
        panel.querySelector(".benchmark-outcome")?.remove();
        const draft = drafts.get(metric.id) || {};
        draft.comparison = null;
        drafts.set(metric.id, draft);
        return;
      }
      input?.setAttribute("aria-invalid", "false");
      if (error) error.textContent = "";
      const comparison = outcome.comparison;
      const draft = drafts.get(metric.id) || {};
      draft.rawInput = input ? input.value : "";
      draft.observationId = comparison.observationId;
      draft.comparison = comparison;
      drafts.set(metric.id, draft);
      showOutcome(panel, comparison);
    } finally {
      button.disabled = false;
      button.textContent = COMPARE_LABEL;
    }
    return;
  }

  if (event.target.closest("[data-reset]")) {
    const select = panel.querySelector(".benchmark-observation");
    const cleared = clearComparisonState({
      observationId: select?.value || panel.dataset.observationId || "",
    });
    reportName = cleared.reportName;
    drafts.set(metric.id, cleared);
    const input = panel.querySelector(".benchmark-result-input");
    if (input) {
      input.value = "";
      input.removeAttribute("aria-invalid");
    }
    const error = panel.querySelector(".benchmark-error");
    if (error) error.textContent = "";
    panel.querySelector(".benchmark-outcome")?.remove();
    for (const field of results.querySelectorAll(".benchmark-report-name")) field.value = "";
    return;
  }

  if (event.target.closest("[data-download]")) {
    const draft = drafts.get(metric.id);
    const error = panel.querySelector(".benchmark-pdf-error");
    if (!draft?.comparison) return;
    const built = buildReportDownload({
      ...draft.comparison,
      reportName: reportName.trim(),
      reportDate: formatReportDate(new Date()),
    });
    if (!built.ok) {
      if (error) error.textContent = built.message || PDF_ERROR_MESSAGE;
      return;
    }
    if (error) error.textContent = "";
    savePdf(built.bytes, built.filename);
  }
});

try {
  const response = await fetch("/api/benchmarks");
  if (!response.ok) throw new Error("unavailable");
  const catalog = await response.json();
  const options = filterOptions(catalog);
  fillSelect(form.category, options.categories.map((category) => ({ value: category.id, label: category.name })), "All Categories");
  fillSelect(form.metric, options.metrics.map((metric) => ({ value: metric.id, label: metric.name })), "All Metrics");
  fillSelect(form.source, options.sources.map((source) => ({ value: source, label: source })), "All Sources");
  fillSelect(form.period, options.periods.map((period) => ({ value: period, label: period })), "All Periods");
  form.addEventListener("change", () => show(catalog));
  categories.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button) return;
    form.category.value = button.dataset.category;
    show(catalog);
  });
  show(catalog);
} catch {
  results.replaceChildren();
  status.textContent = ERROR_MESSAGE;
}
