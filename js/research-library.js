const state = {
  q: "",
  type: "",
  category: "",
  topic: "",
  sort: "publication_date",
  page: 1
};

const results = document.getElementById("research-results");
const status = document.getElementById("research-status");
const typeFilters = document.getElementById("research-type-filters");
const categoryFilters = document.getElementById("research-category-filters");
const topicFilters = document.getElementById("research-topic-filters");
const pager = document.getElementById("research-pager");
const search = document.getElementById("research-search");
const searchButton = document.getElementById("research-search-button");
const sort = document.getElementById("research-sort");

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

function renderFilters(facets) {
  renderFilterGroup(typeFilters, facets.types || [], state.type, "type", "Resource type");
  renderFilterGroup(categoryFilters, (facets.categories || []).map((category) => ({
    value: category.slug,
    label: category.name
  })), state.category, "category", "Category");
  const topics = (facets.topics || []).filter((topic) => !state.category || topic.categorySlug === state.category);
  renderFilterGroup(topicFilters, topics.map((topic) => ({
    value: topic.slug,
    label: topic.name
  })), state.topic, "topic", "Topic");
}

function renderFilterGroup(container, items, active, key, label) {
  container.replaceChildren();
  if (!items.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.setAttribute("aria-label", label);
  const all = document.createElement("button");
  all.type = "button";
  all.className = `resource-filter${active ? "" : " is-active"}`;
  all.textContent = "All";
  all.addEventListener("click", () => {
    state[key] = "";
    if (key === "category") state.topic = "";
    state.page = 1;
    load();
  });
  container.append(all);
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `resource-filter${active === item.value ? " is-active" : ""}`;
    button.textContent = item.label || item.value;
    button.addEventListener("click", () => {
      state[key] = item.value;
      if (key === "category") state.topic = "";
      state.page = 1;
      load();
    });
    container.append(button);
  });
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
