/** Shared file rules for the client portal and staff file screen. */

export const FILE_CATEGORIES = [
  "SEO",
  "Website",
  "Analytics",
  "Marketing",
  "Social Media",
  "Campaigns",
  "Contracts",
  "Other"
];

export const MAX_FILE_BYTES = 52428800;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed"
];

const EXTENSION_MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip"
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_RE.test(String(value || ""));
}

export function sanitizeFileName(name) {
  const base = String(name || "")
    .split(/[/\\]/)
    .pop()
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Choose a file with a valid name.");
  }
  return cleaned;
}

export function resolveMimeType(fileName, reportedType) {
  const reported = String(reportedType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_MIME_TYPES.includes(reported)) return reported;
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  const fromExt = EXTENSION_MIME[ext];
  if (!reported && fromExt) return fromExt;
  throw new Error("This file type is not allowed. Use PDF, Office, image, text, CSV, or ZIP files.");
}

export function assertAllowedFile(file) {
  if (!file || typeof file.size !== "number") throw new Error("Choose a file to upload.");
  if (file.size <= 0) throw new Error("The file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files must be 50 MB or smaller.");
  const safeName = sanitizeFileName(file.name);
  const mime = resolveMimeType(safeName, file.type);
  return { safeName, mime, size: file.size };
}

export function assertCategory(category) {
  if (!FILE_CATEGORIES.includes(category)) throw new Error("Choose a file category.");
  return category;
}

export function assertOptionalText(value, label, max = 2000) {
  const text = String(value || "").trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text || null;
}

export function internalStoragePath(clientId, fileId, safeName) {
  if (!isUuid(clientId) || !isUuid(fileId)) throw new Error("Invalid file destination.");
  return `${clientId}/internal/${fileId}/${sanitizeFileName(safeName)}`;
}

export function sharedStoragePath(clientId, fileId, safeName) {
  if (!isUuid(clientId) || !isUuid(fileId)) throw new Error("Invalid file destination.");
  return `${clientId}/shared/${fileId}/${sanitizeFileName(safeName)}`;
}

const REPORT_FORMATS = {
  pdf: { label: "PDF", mime: "application/pdf" },
  docx: {
    label: "Word",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
};

export function reportDocumentFormat(fileName, mimeType) {
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  const format = REPORT_FORMATS[ext];
  if (!format) return "";
  if (!mime || mime === format.mime || mime === "application/octet-stream") return ext;
  return "";
}

export function assertReportDocument(file) {
  if (!file || typeof file.size !== "number") throw new Error("Choose a document to attach.");
  if (file.size <= 0) throw new Error("The document is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Documents must be 50 MB or smaller.");
  const safeName = sanitizeFileName(file.name);
  const format = reportDocumentFormat(safeName, file.type);
  if (!format) throw new Error("Reports accept PDF and Word DOCX documents only.");
  return {
    safeName,
    mime: REPORT_FORMATS[format].mime,
    size: file.size,
    format,
    label: REPORT_FORMATS[format].label
  };
}

export function reportDownloadLabel(fileName, mimeType) {
  const format = reportDocumentFormat(fileName, mimeType);
  if (!format) return "";
  return `Download ${REPORT_FORMATS[format].label}`;
}
