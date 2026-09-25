const SORTS = new Set(["publication_date", "title"]);
const QUERY_KEYS = new Set(["q", "type", "topic", "sort", "page", "pageSize"]);

export function plainText(value, max = 600) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function parseListQuery(url) {
  const unknown = [...url.searchParams.keys()].filter((key) => !QUERY_KEYS.has(key));
  if (unknown.length) {
    return { error: "invalid_query" };
  }

  const page = readInt(url.searchParams.get("page"), 1);
  const pageSize = readInt(url.searchParams.get("pageSize"), 12);
  const sort = url.searchParams.get("sort") || "publication_date";
  const type = url.searchParams.get("type") || "";
  const topic = url.searchParams.get("topic") || "";
  const q = url.searchParams.get("q") || "";

  if (page === null || page < 1 || page > 100) return { error: "invalid_query" };
  if (pageSize === null || pageSize < 1 || pageSize > 20) return { error: "invalid_query" };
  if (!SORTS.has(sort)) return { error: "invalid_query" };
  if (type && !/^[a-z0-9-]{1,40}$/.test(type)) return { error: "invalid_query" };
  if (topic && !/^[a-z0-9-]{1,60}$/.test(topic)) return { error: "invalid_query" };
  if (q.length > 80 || /[<>\\{}()[\];`]/.test(q)) return { error: "invalid_query" };

  return { page, pageSize, sort, type, topic, q: q.trim() };
}

export function parseSlug(value) {
  if (!/^[a-z0-9-]{1,96}$/.test(value || "")) return null;
  return value;
}

export function parseOpenAlexId(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:https:\/\/openalex\.org\/)?(W\d{1,20})$/);
  return match ? match[1] : null;
}

export function slugify(title, fallback) {
  const base = plainText(title, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return base || fallback;
}

function readInt(value, fallback) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}
