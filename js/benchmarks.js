import { ERROR_MESSAGE, LOADING_MESSAGE } from "../workers/benchmarks/catalog.js";
import { filterBenchmarks, filterOptions, renderBenchmarkCards, selectionMessage } from "./benchmarks-state.js";

const status = document.querySelector("#benchmark-status");
const results = document.querySelector("#benchmark-results");
const form = document.querySelector("#benchmark-filters");
const categories = document.querySelector("#benchmark-categories");

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

function show(catalog) {
  const metrics = filterBenchmarks(catalog, currentFilters());
  results.innerHTML = renderBenchmarkCards(metrics);
  status.textContent = selectionMessage(metrics);
  for (const button of categories.querySelectorAll("button[data-category]")) {
    button.setAttribute("aria-pressed", button.dataset.category === form.category.value ? "true" : "false");
  }
}

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
