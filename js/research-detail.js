const status = document.getElementById("research-detail-status");
const article = document.getElementById("research-detail");
const params = new URLSearchParams(window.location.search);
const slug = params.get("slug") || "";

if (!/^[a-z0-9-]{1,96}$/.test(slug)) {
  status.textContent = "Choose a published work from the Industry Research Library.";
} else {
  load(slug);
}

async function load(slug) {
  status.textContent = "Loading published research…";
  try {
    const response = await fetch(`/api/research/resources/${encodeURIComponent(slug)}`);
    const body = await response.json();
    if (!response.ok) {
      status.textContent = "This research record is not published.";
      return;
    }
    render(body.result);
  } catch {
    status.textContent = "The research catalog could not be loaded. Please try again.";
  }
}

function render(work) {
  status.textContent = "";
  article.hidden = false;
  text("research-title", work.title);
  text("research-type", work.resourceType);
  text("research-date", work.publicationDate || "Publication date not provided");
  text("research-venue", work.venue || "Venue not provided");
  text("research-contributors", (work.contributors || []).join(", ") || "Contributors not provided");
  text("research-doi", work.doi || "No DOI");
  text("research-topics", (work.topics || []).map((topic) => topic.name).join(", ") || "No topic assigned");
  text("research-rights", rightsText(work.rightsClass));
  text("research-attribution", work.attribution);
  text("research-retrieved", work.retrievedAt ? `Retrieved ${work.retrievedAt}` : "");
  text("research-limitations", work.limitationsUnknown
    ? "Limitations were not provided by the source. An empty field is not evidence that the work has no limitations."
    : work.limitations);
  const summary = document.getElementById("research-summary");
  if (work.summary && ["permitted_description", "pulse_summary", "provider_analysis"].includes(work.rightsClass)) {
    summary.hidden = false;
    summary.textContent = work.summary;
  } else {
    summary.hidden = true;
  }
  const source = document.getElementById("research-source");
  source.href = work.sourceUrl;
  source.textContent = "Open the original source";
  text("research-citation", citation(work));
  document.title = `${work.title} | Industry Research Library | Pulse Analytics Group LLC`;
}

function text(id, value) {
  document.getElementById(id).textContent = value || "";
}

function rightsText(rightsClass) {
  const messages = {
    metadata: "Metadata may be displayed. The original source is linked. Pulse Analytics does not host the full text.",
    source_link: "This record links to the original source. Pulse Analytics does not host the full text.",
    permitted_description: "A short description is shown because the source permits that metadata. The full text is not hosted here.",
    open_access_link: "An open-access copy is linked, not copied. Pulse Analytics does not host the file.",
    pulse_summary: "The summary is Pulse Analytics content and still cites the original source.",
    provider_analysis: "Provider analysis is shown separately from the source material."
  };
  return messages[rightsClass] || "Rights for this record are not cleared for public display.";
}

function citation(work) {
  const authors = (work.contributors || []).join(", ");
  const year = (work.publicationDate || "").slice(0, 4);
  return [authors, year, work.title, work.venue, work.doi ? `https://doi.org/${work.doi}` : work.sourceUrl]
    .filter(Boolean)
    .join(". ");
}
