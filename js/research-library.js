const state = {
  q: "",
  type: "",
  category: "",
  topic: "",
  sort: "publication_date",
  page: 1
};

const TYPE_LABELS = {
  article: "Article",
  "conference-paper": "Conference Paper",
  "official-guide": "Official Guide"
};
const TYPE_ORDER = ["article", "conference-paper", "official-guide"];

const results = document.getElementById("research-results");
const status = document.getElementById("research-status");
const pager = document.getElementById("research-pager");
const search = document.getElementById("research-search");
const searchButton = document.getElementById("research-search-button");
const sort = document.getElementById("research-sort");
const categorySelect = document.getElementById("research-category");
const topicSelect = document.getElementById("research-topic");
const typeSelect = document.getElementById("research-type");
const activeFilters = document.getElementById("research-active-filters");
const filterPanel = document.getElementById("library-filter-panel");
const filterToggle = document.getElementById("library-filters-toggle");
let latestFacets = { types: [], categories: [], topics: [] };

function applySearch() {
  state.q = search.value.trim();
  state.page = 1;
  load();
}

search.addEventListener("input", debounce(applySearch, 300));
search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applySearch();
  }
});
searchButton.addEventListener("click", (event) => {
  event.preventDefault();
  applySearch();
});

categorySelect.addEventListener("change", () => {
  state.category = categorySelect.value;
  if (!topicFits(state.category, state.topic)) state.topic = "";
  const topics = latestFacets.topics.filter((topic) => !state.category || topic.categorySlug === state.category);
  state.topic = setOptions(topicSelect, [
    { value: "", label: "All Topics" },
    ...topics.map((topic) => ({ value: topic.slug, label: topic.name }))
  ], state.topic);
  state.page = 1;
  load();
});
topicSelect.addEventListener("change", () => {
  state.topic = topicSelect.value;
  state.page = 1;
  load();
});
typeSelect.addEventListener("change", () => {
  state.type = typeSelect.value;
  state.page = 1;
  load();
});
filterToggle.addEventListener("click", () => {
  const open = filterPanel.classList.toggle("is-open");
  filterToggle.setAttribute("aria-expanded", String(open));
});

sort.addEventListener("change", () => {
  state.sort = sort.value;
  state.page = 1;
  load();
});

load();

async function load() {
  status.textContent = "Loading published research…";
  results.replaceChildren();
  pager.replaceChildren();
  syncControls();
  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: "12",
    sort: state.sort
  });
  if (state.q) params.set("q", state.q);
  if (state.type) params.set("type", state.type);
  if (state.category) params.set("category", state.category);
  if (state.topic) params.set("topic", state.topic);

  try {
    const response = await fetch(`/api/research/resources?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error("catalog");
    renderFilters(body.facets || { types: [], topics: [] });
    renderResults(body);
  } catch {
    status.textContent = "The research catalog could not be loaded. Please try again.";
  }
}

function topicFits(category, topicSlug) {
  if (!topicSlug || !category) return true;
  const topic = (latestFacets.topics || []).find((item) => item.slug === topicSlug);
  return Boolean(topic && topic.categorySlug === category);
}

function typeChoices(types) {
  const present = new Set((types || []).map((item) => item.value));
  const ordered = TYPE_ORDER.filter((value) => present.has(value)).map((value) => ({
    value,
    label: TYPE_LABELS[value]
  }));
  (types || []).forEach((item) => {
    if (!TYPE_ORDER.includes(item.value)) {
      ordered.push({ value: item.value, label: humanType(item.value) });
    }
  });
  return ordered;
}

function humanType(value) {
  if (TYPE_LABELS[value]) return TYPE_LABELS[value];
  return String(value || "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setOptions(select, options, selected) {
  const next = options.some((item) => item.value === selected) ? selected : "";
  select.replaceChildren();
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  });
  select.value = next;
  return next;
}

function facetLabel(kind, value) {
  if (kind === "category") {
    return (latestFacets.categories || []).find((item) => item.slug === value)?.name || value;
  }
  if (kind === "topic") {
    return (latestFacets.topics || []).find((item) => item.slug === value)?.name || value;
  }
  return humanType(value);
}

function renderFilters(facets) {
  latestFacets = {
    types: facets.types || [],
    categories: facets.categories || [],
    topics: facets.topics || []
  };
  state.category = setOptions(categorySelect, [
    { value: "", label: "All Categories" },
    ...latestFacets.categories.map((category) => ({ value: category.slug, label: category.name }))
  ], state.category);
  if (!topicFits(state.category, state.topic)) state.topic = "";
  const topics = latestFacets.topics.filter((topic) => !state.category || topic.categorySlug === state.category);
  state.topic = setOptions(topicSelect, [
    { value: "", label: "All Topics" },
    ...topics.map((topic) => ({ value: topic.slug, label: topic.name }))
  ], state.topic);
  state.type = setOptions(typeSelect, [
    { value: "", label: "All Types" },
    ...typeChoices(latestFacets.types)
  ], state.type);
  if ([...sort.options].some((option) => option.value === state.sort)) sort.value = state.sort;
  renderActiveFilters();
}

function syncControls() {
  if ([...categorySelect.options].some((option) => option.value === state.category)) {
    categorySelect.value = state.category;
  }
  const topics = latestFacets.topics.filter((topic) => !state.category || topic.categorySlug === state.category);
  if (latestFacets.topics.length || topicSelect.options.length) {
    state.topic = setOptions(topicSelect, [
      { value: "", label: "All Topics" },
      ...topics.map((topic) => ({ value: topic.slug, label: topic.name }))
    ], state.topic);
  }
  if ([...typeSelect.options].some((option) => option.value === state.type)) {
    typeSelect.value = state.type;
  }
  if ([...sort.options].some((option) => option.value === state.sort)) sort.value = state.sort;
  renderActiveFilters();
}

function renderActiveFilters() {
  activeFilters.replaceChildren();
  const chips = [];
  if (state.category) chips.push({ key: "category", label: facetLabel("category", state.category) });
  if (state.topic) chips.push({ key: "topic", label: facetLabel("topic", state.topic) });
  if (state.type) chips.push({ key: "type", label: facetLabel("type", state.type) });
  if (!chips.length) {
    activeFilters.hidden = true;
    return;
  }
  activeFilters.hidden = false;
  const label = document.createElement("span");
  label.className = "library-active-label";
  label.textContent = "Filters:";
  activeFilters.append(label);
  chips.forEach((chip) => {
    const item = document.createElement("span");
    item.className = "library-active-chip";
    const text = document.createElement("span");
    text.textContent = chip.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${chip.label} filter`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state[chip.key] = "";
      state.page = 1;
      load();
    });
    item.append(text, remove);
    activeFilters.append(item);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "library-clear-filters";
  clear.textContent = "Clear all";
  clear.addEventListener("click", () => {
    state.category = "";
    state.topic = "";
    state.type = "";
    state.page = 1;
    load();
  });
  activeFilters.append(clear);
}

function renderResults(body) {
  const rows = body.results || [];
  if (!rows.length) {
    status.textContent = state.q || state.type || state.category || state.topic
      ? "No published resources match this search."
      : "The Industry Research Library does not have any published resources yet.";
    return;
  }
  status.textContent = `${body.total} published ${body.total === 1 ? "resource" : "resources"}.`;
  rows.forEach((work) => results.append(card(work)));
  const pages = Math.ceil(body.total / body.pageSize);
  if (pages > 1) {
    pager.append(pageButton("Previous", state.page > 1, state.page - 1));
    pager.append(pageButton("Next", state.page < pages, state.page + 1));
  }
}

const EXTERNAL_LABELS = {
  google: "Official Google resource",
  w3c: "W3C Resource",
  webdev: "web.dev Resource",
  nng: "Nielsen Norman Group Resource",
  openai: "OpenAI Resource",
  ibm: "IBM Resource",
  salesforce: "Salesforce Resource",
  zapier: "Zapier Resource"
};

function card(work) {
  const article = document.createElement("article");
  article.className = "resource-card";
  const type = document.createElement("span");
  type.className = "resource-type";
  const title = document.createElement("h3");
  title.textContent = work.title;
  const copy = document.createElement("p");
  const actions = document.createElement("div");
  actions.className = "resource-card-actions";
  const link = document.createElement("a");
  if (EXTERNAL_LABELS[work.sourceType]) {
    type.textContent = EXTERNAL_LABELS[work.sourceType];
    copy.textContent = work.summary || "";
    link.href = safeHttps(work.sourceUrl) || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View Resource";
    actions.append(link);
    article.append(type, title, copy, actions);
    return article;
  }
  type.textContent = work.resourceType || "Research";
    const authors = (work.contributors || []).join(", ");
    copy.textContent = [authors, work.publicationDate, work.venue].filter(Boolean).join(" · ");
    link.href = `research-detail.html?slug=${encodeURIComponent(work.slug)}`;
    link.textContent = "View record →";
    actions.append(link);
    article.append(type, title, copy);
    if (work.summary) {
      const about = document.createElement("p");
      about.textContent = work.summary;
      article.append(about);
    }
    article.append(actions);
    return article;
}

function safeHttps(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function pageButton(label, enabled, page) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "resource-filter";
  button.textContent = label;
  button.disabled = !enabled;
  button.addEventListener("click", () => {
    state.page = page;
    load();
  });
  return button;
}

const scholarForm = document.getElementById("scholar-search-form");
const scholarSearch = document.getElementById("scholar-search");
const scholarStatus = document.getElementById("scholar-status");
const scholarResults = document.getElementById("scholar-results");

if (scholarForm) {
  scholarForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchScholarly();
  });
}

async function searchScholarly() {
  const q = scholarSearch.value.trim();
  scholarResults.replaceChildren();
  if (q.length < 2) {
    scholarStatus.textContent = "Enter a search of at least 2 characters.";
    return;
  }
  scholarStatus.textContent = "Searching scholarly research…";
  try {
    const response = await fetch(`/api/research/search?${new URLSearchParams({ q })}`);
    const body = await response.json();
    if (!response.ok) {
      scholarStatus.textContent = response.status === 400
        ? "Enter a search of at least 2 characters."
        : "Scholarly research search is temporarily unavailable. Please try again.";
      return;
    }
    const rows = body.results || [];
    if (!rows.length) {
      scholarStatus.textContent = "No scholarly research matched that search.";
      return;
    }
    scholarStatus.textContent = `${rows.length} scholarly ${rows.length === 1 ? "result" : "results"}.`;
    rows.forEach((item) => scholarResults.append(scholarCard(item)));
  } catch {
    scholarStatus.textContent = "Scholarly research search is temporarily unavailable. Please try again.";
  }
}

function scholarCard(item) {
  const article = document.createElement("article");
  article.className = "resource-card";
  const type = document.createElement("span");
  type.className = "resource-type";
  type.textContent = "Scholarly research";
  const title = document.createElement("h3");
  title.textContent = item.title || "";
  const meta = document.createElement("p");
  meta.textContent = [item.publicationYear, item.type].filter(Boolean).join(" · ");
  const authors = document.createElement("p");
  const names = Array.isArray(item.authors) ? item.authors.filter(Boolean) : [];
  authors.textContent = names.join(", ") + (item.moreAuthors ? " and others" : "");
  const source = document.createElement("p");
  source.textContent = item.sourceName || "";
  const actions = document.createElement("div");
  actions.className = "resource-card-actions";
  const link = document.createElement("a");
  link.href = safeHttps(item.sourceUrl) || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View Source";
  actions.append(link);
  if (/^[a-z0-9-]{1,96}$/.test(item.catalogSlug || "")) {
    const local = document.createElement("a");
    local.href = `research-detail.html?slug=${encodeURIComponent(item.catalogSlug)}`;
    local.textContent = "View record →";
    actions.append(local);
  }
  article.append(type, title);
  if (meta.textContent) article.append(meta);
  if (authors.textContent) article.append(authors);
  if (source.textContent) article.append(source);
  article.append(actions);
  return article;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
