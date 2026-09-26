export const LOADING_MESSAGE = "Loading benchmark data...";
export const ERROR_MESSAGE = "Benchmark data is temporarily unavailable. Please try again.";
export const EMPTY_MESSAGE = "No benchmark is available for this selection.";

export function filterBenchmarks(catalog, filters = {}) {
  const categoryId = filters.categoryId || "";
  const metricId = filters.metricId || "";
  const provider = filters.provider || "";
  const period = filters.period || "";
  const metrics = [];

  for (const metric of catalog.metrics) {
    if (!metric.published) continue;
    if (categoryId && metric.categoryId !== categoryId) continue;
    if (metricId && metric.id !== metricId) continue;
    const observations = metric.observations.filter((observation) => {
      if (provider && observation.provider !== provider) return false;
      if (period && observation.period !== period) return false;
      return true;
    });
    if (!observations.length) continue;
    metrics.push({ ...metric, observations });
  }

  return metrics;
}

export function filterOptions(catalog) {
  const metrics = catalog.metrics.filter((metric) => metric.published);
  const sources = [];
  const periods = [];
  for (const metric of metrics) {
    for (const observation of metric.observations) {
      if (!sources.includes(observation.provider)) sources.push(observation.provider);
      if (!periods.includes(observation.period)) periods.push(observation.period);
    }
  }
  return {
    categories: catalog.categories,
    metrics: metrics.map((metric) => ({ id: metric.id, name: metric.name })),
    sources,
    periods,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function same(observations, key) {
  return observations.every((observation) => observation[key] === observations[0][key]);
}

function metaLine(label, value) {
  return `<p><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</p>`;
}

function valueList(observations) {
  const mixedGeography = !same(observations, "geography");
  const groups = [];
  for (const observation of observations) {
    const key = observation.group || "";
    const current = groups[groups.length - 1];
    if (!current || current.name !== key) groups.push({ name: key, items: [observation] });
    else current.items.push(observation);
  }

  return groups.map((group) => {
    const items = group.items.map((observation) => {
      const geography = mixedGeography && observation.geography !== observation.label
        ? ` <small>${escapeHtml(observation.geography)}</small>`
        : "";
      return `<li><span>${escapeHtml(observation.label)}${geography}</span><strong>${escapeHtml(observation.value)}</strong></li>`;
    }).join("");
    const heading = group.name ? `<p>${escapeHtml(group.name)}</p>` : "";
    return `<div class="benchmark-group">${heading}<ul class="benchmark-values">${items}</ul></div>`;
  }).join("");
}

function detailBlock(observations) {
  const sharedKeys = ["provider", "report", "period", "segment", "geography", "definition", "methodology", "limitations"];
  if (sharedKeys.every((key) => same(observations, key))) {
    const observation = observations[0];
    return `<dl>
      <dt>Source</dt><dd>${escapeHtml(observation.provider)}</dd>
      <dt>Dataset/report</dt><dd>${escapeHtml(observation.report)}</dd>
      <dt>Year or period</dt><dd>${escapeHtml(observation.period)}</dd>
      <dt>Segment</dt><dd>${escapeHtml(observation.segment)}</dd>
      <dt>Geography</dt><dd>${escapeHtml(observation.geography)}</dd>
      <dt>Definition</dt><dd>${escapeHtml(observation.definition)}</dd>
      <dt>Methodology</dt><dd>${escapeHtml(observation.methodology)}</dd>
      <dt>Limitations</dt><dd>${escapeHtml(observation.limitations)}</dd>
    </dl>`;
  }

  return observations.map((observation) => `<section>
    <h4>${escapeHtml(observation.group ? `${observation.group} ${observation.label}` : observation.label)}</h4>
    <dl>
      <dt>Source</dt><dd>${escapeHtml(observation.provider)}</dd>
      <dt>Dataset/report</dt><dd>${escapeHtml(observation.report)}</dd>
      <dt>Year or period</dt><dd>${escapeHtml(observation.period)}</dd>
      <dt>Segment</dt><dd>${escapeHtml(observation.segment)}</dd>
      <dt>Geography</dt><dd>${escapeHtml(observation.geography)}</dd>
      <dt>Definition</dt><dd>${escapeHtml(observation.definition)}</dd>
      <dt>Methodology</dt><dd>${escapeHtml(observation.methodology)}</dd>
      <dt>Limitations</dt><dd>${escapeHtml(observation.limitations)}</dd>
    </dl>
  </section>`).join("");
}

export function renderBenchmarkCards(metrics) {
  return metrics.map((metric) => {
    const observations = metric.observations;
    const primary = observations.length === 1
      ? `<p class="benchmark-figure">${escapeHtml(observations[0].value)}${observations[0].label ? `<span class="benchmark-caption">${escapeHtml(observations[0].label)}</span>` : ""}</p>${observations[0].statement ? `<p class="benchmark-statement">${escapeHtml(observations[0].statement)}</p>` : ""}`
      : valueList(observations);
    const meta = [
      same(observations, "provider") ? metaLine("Source", observations[0].provider) : "",
      same(observations, "period") ? metaLine("Period", observations[0].period) : "",
      same(observations, "segment") ? metaLine("Segment", observations[0].segment) : "",
      same(observations, "geography") ? metaLine("Geography", observations[0].geography) : "",
    ].join("");
    const source = same(observations, "sourceUrl") && observations[0].sourceUrl.startsWith("https://")
      ? `<div class="resource-card-actions"><a href="${escapeHtml(observations[0].sourceUrl)}" target="_blank" rel="noopener noreferrer">View Source</a></div>`
      : "";
    const note = metric.note ? `<p class="benchmark-note">${escapeHtml(metric.note)}</p>` : "";

    return `<article class="resource-card benchmark-card">
      <h3>${escapeHtml(metric.name)}</h3>
      ${note}
      ${primary}
      <div class="benchmark-meta">${meta}</div>
      <p class="benchmark-definition">${escapeHtml(metric.definition)}</p>
      ${source}
      <details class="benchmark-details">
        <summary>Methodology &amp; Limitations</summary>
        ${detailBlock(observations)}
      </details>
    </article>`;
  }).join("");
}

export function selectionMessage(metrics) {
  return metrics.length ? "" : EMPTY_MESSAGE;
}
