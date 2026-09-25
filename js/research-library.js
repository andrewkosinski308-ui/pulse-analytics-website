const state = {
  q: "",
  type: "",
  topic: "",
  sort: "publication_date",
  page: 1
};

const results = document.getElementById("research-results");
const status = document.getElementById("research-status");
const typeFilters = document.getElementById("research-type-filters");
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
  renderFilterGroup(topicFilters, (facets.topics || []).map((topic) => ({
    value: topic.slug,
    label: topic.name,
    count: topic.count
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
      state.page = 1;
      load();
    });
    container.append(button);
  });
}

function renderResults(body) {
  const rows = body.results || [];
  if (!rows.length) {
    status.textContent = state.q || state.type || state.topic
      ? "No published works match this search."
      : "The Industry Research Library does not have any published works yet.";
    return;
  }
  status.textContent = `${body.total} published ${body.total === 1 ? "work" : "works"}.`;
  rows.forEach((work) => results.append(card(work)));
  const pages = Math.ceil(body.total / body.pageSize);
  if (pages > 1) {
    pager.append(pageButton("Previous", state.page > 1, state.page - 1));
    pager.append(pageButton("Next", state.page < pages, state.page + 1));
  }
}

function card(work) {
  const article = document.createElement("article");
  article.className = "resource-card";
  const type = document.createElement("span");
  type.className = "resource-type";
  type.textContent = work.resourceType || "Research";
  const title = document.createElement("h3");
  title.textContent = work.title;
  const copy = document.createElement("p");
  const authors = (work.contributors || []).join(", ");
  copy.textContent = [authors, work.publicationDate, work.venue].filter(Boolean).join(" · ");
  const actions = document.createElement("div");
  actions.className = "resource-card-actions";
  const link = document.createElement("a");
  link.href = `research-detail.html?slug=${encodeURIComponent(work.slug)}`;
  link.textContent = "View record →";
  actions.append(link);
  article.append(type, title, copy, actions);
  return article;
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

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
