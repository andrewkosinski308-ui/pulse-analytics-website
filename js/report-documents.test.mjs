import assert from "node:assert/strict";
import test from "node:test";
import { assertReportDocument, reportDocumentFormat, reportDownloadLabel } from "./file-rules.js";

test("report documents accept PDF and DOCX only", () => {
  const pdf = assertReportDocument({ name: "Client Report.pdf", size: 120, type: "application/pdf" });
  assert.equal(pdf.format, "pdf");
  assert.equal(pdf.mime, "application/pdf");
  assert.equal(reportDownloadLabel(pdf.safeName, pdf.mime), "Download PDF");

  const docx = assertReportDocument({
    name: "Client Agreement.docx",
    size: 240,
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  assert.equal(docx.format, "docx");
  assert.equal(reportDownloadLabel(docx.safeName, docx.mime), "Download Word");
});

test("report documents accept a browser octet-stream when the extension is PDF or DOCX", () => {
  assert.equal(reportDocumentFormat("quarter.pdf", "application/octet-stream"), "pdf");
  assert.equal(reportDocumentFormat("quarter.docx", ""), "docx");
});

test("report documents reject other file types and mismatched types", () => {
  assert.throws(() => assertReportDocument({ name: "photo.png", size: 20, type: "image/png" }), /PDF and Word DOCX/);
  assert.throws(() => assertReportDocument({ name: "notes.txt", size: 20, type: "text/plain" }), /PDF and Word DOCX/);
  assert.equal(reportDocumentFormat("report.pdf", "text/plain"), "");
  assert.equal(reportDownloadLabel("archive.zip", "application/zip"), "");
});
