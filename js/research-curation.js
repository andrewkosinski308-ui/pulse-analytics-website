import { getAuthState, getSupabase, initAuth, signOut } from "./pulse-auth.js";

const PUBLISHABLE_RIGHTS = new Set([
  "metadata",
  "source_link",
  "permitted_description",
  "open_access_link",
  "dataset_values_permitted",
  "pulse_summary",
  "provider_analysis"
]);

const MESSAGES = {
  unauthorized: "Sign in with an administrator account to continue.",
  forbidden: "This account is not allowed to curate research.",
  invalid_query: "That request is not valid. Check the search text and the selected topics.",
  invalid_taxonomy: "Choose an active Pulse category and topics that belong to it. Deprecated and unknown topics cannot be assigned.",
  rights_rejected: "This work cannot be published because its rights class is not publishable.",
  provenance_incomplete: "Publication needs a title, provider, source URL, external ID, and retrieval time.",
  duplicate_work: "This work matches an existing catalog record. A second copy was not created.",
  access_rejected: "Only public-library drafts can be published from this workflow.",
  not_found: "That research record was not found.",
  provider_disabled: "OpenAlex is disabled.",
  provider_rate_limited: "OpenAlex is rate limited. Try again later.",
  provider_unavailable: "OpenAlex could not be reached.",
  provider_auth_failed: "The research provider rejected the server request.",
  provider_not_configured: "The research provider is not configured.",
  catalog_unavailable: "The catalog request failed. Nothing new was published.",
  network: "The network request failed."
};

const message = document.querySelector("#curation-message");
const authPanel = document.querySelector("#curation-auth");
const workspace = document.querySelector("#curation-workspace");
const results = document.querySelector("#curation-results");
const review = document.querySelector("#curation-review");
const facts = document.querySelector("#curation-facts");
const rights = document.querySelector("#curation-rights");
const providerTopics = document.querySelector("#curation-provider-topics");
const categorySelect = document.querySelector("#curation-category");
const topicBox = document.querySelector("#curation-topics");
const draftFlag = document.querySelector("#curation-draft-flag");
const drafts = document.querySelector("#curation-drafts");

let taxonomy = { categories: [], topics: [] };
let candidate = null;
let chosenTopics = new Set();

document.querySelector("#curation-login").addEventListener("submit", onSignIn);
document.querySelector("#curation-sign-out").addEventListener("click", onSignOut);
document.querySelector("#curation-discover").addEventListener("submit", onDiscover);
document.querySelector("#curation-category").addEventListener("change", onCategoryChange);
document.querySelector("#curation-stage").addEventListener("click", () => stageCandidate(false));
document.querySelector("#curation-stage-unclassified").addEventListener("click", () => stageCandidate(true));

init().catch((error) => setMessage(error?.message ? "network" : "network"));

async function init() {
  await initAuth();
  const state = getAuthState();
  if (isAdmin(state)) showWorkspace();
}

async function onSignIn(event) {
  event.preventDefault();
  setMessage("");
  const email = document.querySelector("#curation-email").value;
  const password = document.querySelector("#curation-password").value;
  try {
    await initAuth();
    const client = getSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email).trim(),
      password
    });
    if (error || !data?.user) {
      setMessage("unauthorized");
      return;
    }
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("role,is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError || !profile || profile.role !== "admin" || profile.is_active === false) {
      await signOut();
      setMessage("forbidden");
      return;
    }
    showWorkspace();
  } catch {
    setMessage("network");
  }
}

async function onSignOut() {
  await signOut();
  candidate = null;
  workspace.hidden = true;
  authPanel.hidden = false;
  review.hidden = true;
  results.replaceChildren();
  setMessage("");
}

function showWorkspace() {
  authPanel.hidden = true;
  workspace.hidden = false;
  loadTaxonomy();
  loadDrafts();
}

async function onDiscover(event) {
  event.preventDefault();
  setMessage("");
  const query = document.querySelector("#curation-query").value.trim();
  const payload = await staffJson("/api/research/staff/discover", {
    method: "POST",
    body: JSON.stringify({ query })
  });
  if (!payload) return;
  results.replaceChildren();
  const rows = Array.isArray(payload.results) ? payload.results : [];
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "No OpenAlex candidates matched that search.";
    results.append(empty);
    return;
  }
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = row.title || "Untitled candidate";
    button.addEventListener("click", () => selectCandidate(row));
    results.append(button);
  }
}

function selectCandidate(row) {
  candidate = row;
  chosenTopics = new Set();
  draftFlag.hidden = true;
  review.hidden = false;
  fillFacts(facts, [
    ["Title", row.title],
    ["Contributors", (row.contributors || []).join(", ") || "Not provided"],
    ["Publication date", row.publicationDate || "Not provided"],
    ["Type", row.resourceType || "Not provided"],
    ["DOI", row.doi || "Not provided"],
    ["Provider", row.provider || "openalex"],
    ["External ID", row.externalId || "Not provided"],
    ["Venue", row.venue || "Not provided"]
  ]);
  const source = document.createElement("dd");
  const href = safeHttps(row.sourceUrl);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = href;
    source.append(link);
  } else {
    source.textContent = "Not provided";
  }
  facts.append(term("Source"), source);
  if (row.summary) facts.append(term("Description"), textDd(row.summary));
  providerTopics.replaceChildren();
  const labels = Array.isArray(row.providerTopics) ? row.providerTopics : [];
  if (!labels.length) {
    const item = document.createElement("li");
    item.textContent = "None supplied.";
    providerTopics.append(item);
  }
  for (const label of labels) {
    const item = document.createElement("li");
    item.textContent = label;
    providerTopics.append(item);
  }
  fillFacts(rights, [
    ["Provider", row.provider || "openalex"],
    ["Rights class", row.rightsClass || "Not provided"],
    ["License", row.license?.name || "Not provided"],
    ["Open access", row.openAccess ? "Yes" : "No"],
    ["Stored by Pulse", "Metadata only. Description text is kept only when the provider permits it."],
    ["Full text", "Not stored. The original source is linked."]
  ]);
  renderTopics();
}

function onCategoryChange() {
  chosenTopics = new Set();
  renderTopics();
}

function renderTopics() {
  topicBox.replaceChildren();
  const category = categorySelect.value;
  const rows = taxonomy.topics.filter((topic) => topic.categorySlug === category);
  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "No active topics are available for this category.";
    topicBox.append(note);
    return;
  }
  for (const topic of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = topic.name;
    button.setAttribute("aria-pressed", chosenTopics.has(topic.slug) ? "true" : "false");
    button.addEventListener("click", () => {
      if (chosenTopics.has(topic.slug)) chosenTopics.delete(topic.slug);
      else chosenTopics.add(topic.slug);
      button.setAttribute("aria-pressed", chosenTopics.has(topic.slug) ? "true" : "false");
    });
    topicBox.append(button);
  }
}

async function stageCandidate(unclassified) {
  if (!candidate?.externalId) return;
  const categorySlug = categorySelect.value;
  const topicSlugs = unclassified ? [] : [...chosenTopics];
  if (!unclassified && (!categorySlug || !topicSlugs.length)) {
    setMessage("invalid_taxonomy");
    return;
  }
  const payload = await staffJson("/api/research/staff/stage", {
    method: "POST",
    body: JSON.stringify({
      externalId: candidate.externalId,
      categorySlug: unclassified ? "" : categorySlug,
      topicSlugs
    })
  });
  if (!payload) return;
  if (payload.duplicate) {
    setMessage("duplicate_work");
    return;
  }
  draftFlag.hidden = false;
  setMessage("");
  const note = document.createElement("p");
  note.className = "status-banner";
  note.textContent = "DRAFT / NOT PUBLISHED";
  message.append(note);
  await loadDrafts();
}

async function loadTaxonomy() {
  try {
    const response = await fetch("/api/research/resources?pageSize=1");
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "catalog_unavailable");
      return;
    }
    taxonomy = {
      categories: payload.facets?.categories || [],
      topics: payload.facets?.topics || []
    };
    categorySelect.replaceChildren();
    for (const category of taxonomy.categories) {
      const option = document.createElement("option");
      option.value = category.slug;
      option.textContent = category.name;
      categorySelect.append(option);
    }
    renderTopics();
  } catch {
    setMessage("network");
  }
}

async function loadDrafts() {
  const payload = await staffJson("/api/research/staff/drafts");
  if (!payload) return;
  drafts.replaceChildren();
  const rows = Array.isArray(payload.results) ? payload.results : [];
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "No public-library drafts are waiting.";
    drafts.append(empty);
    return;
  }
  for (const row of rows) drafts.append(draftCard(row));
}

function draftCard(row) {
  const card = document.createElement("article");
  card.className = "card";
  const flag = document.createElement("p");
  flag.className = "status-banner";
  flag.textContent = "DRAFT / NOT PUBLISHED";
  const title = document.createElement("h3");
  title.textContent = row.title || "Untitled draft";
  const list = document.createElement("dl");
  fillFacts(list, [
    ["Type", row.resourceType],
    ["Publication date", row.publicationDate || "Not provided"],
    ["Contributors", (row.contributors || []).join(", ") || "Not provided"],
    ["Provider", row.provider || "Not provided"],
    ["DOI", row.doi || "Not provided"],
    ["External ID", row.externalId || "Not provided"],
    ["Categories", (row.categories || []).map((category) => category.name).join(", ") || "Not classified"],
    ["Topics", (row.topics || []).map((topic) => topic.name).join(", ") || "Not classified"],
    ["Rights class", row.rightsClass || "Not provided"],
    ["Access tier", row.accessTier || "Not provided"],
    ["Retrieved", row.retrievedAt || "Not provided"]
  ]);
  const source = document.createElement("dd");
  const href = safeHttps(row.sourceUrl);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = href;
    source.append(link);
  } else source.textContent = "Not provided";
  list.append(term("Source"), source);
  const publish = document.createElement("button");
  publish.type = "button";
  publish.textContent = "Publish";
  const ready = row.accessTier === "public"
    && PUBLISHABLE_RIGHTS.has(row.rightsClass)
    && Array.isArray(row.topics)
    && row.topics.length > 0
    && row.topics.every((topic) => topic.status === "active" && topic.categorySlug);
  publish.disabled = !ready;
  publish.addEventListener("click", () => publishDraft(row.slug, row.title));
  card.append(flag, title, list, publish);
  return card;
}

async function publishDraft(slug, title) {
  if (!window.confirm(`Publish "${title}" to the public research library?`)) return;
  const payload = await staffJson("/api/research/staff/publish", {
    method: "POST",
    body: JSON.stringify({ slug })
  });
  if (!payload) return;
  setMessage("");
  const note = document.createElement("p");
  note.textContent = "Published to the public catalog.";
  message.append(note);
  await loadDrafts();
}

async function staffJson(path, options = {}) {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token || getAuthState().session?.access_token;
  if (!token) {
    setMessage("unauthorized");
    return null;
  }
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error || "catalog_unavailable");
      return null;
    }
    return payload;
  } catch {
    setMessage("network");
    return null;
  }
}

function fillFacts(list, pairs) {
  list.replaceChildren();
  for (const [name, value] of pairs) {
    list.append(term(name), textDd(value || "Not provided"));
  }
}

function term(name) {
  const node = document.createElement("dt");
  node.textContent = name;
  return node;
}

function textDd(value) {
  const node = document.createElement("dd");
  node.textContent = value;
  return node;
}

function safeHttps(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function isAdmin(state) {
  return Boolean(state?.authenticated && state.profile?.role === "admin" && state.profile?.is_active !== false && state.session?.access_token);
}

function setMessage(code) {
  message.replaceChildren();
  if (!code) return;
  message.textContent = MESSAGES[code] || "The curation request could not be completed.";
}
