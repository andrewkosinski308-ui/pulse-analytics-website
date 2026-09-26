/**
 * Client-side Marketing Benchmark Comparison Report.
 * The document is built in the browser from the selected observation
 * and the temporary comparison. Nothing is uploaded.
 */

import { PDF_ERROR_MESSAGE, reportFilename } from "./benchmark-compare.js";

export const BRAND = {
  navy: [0x0A / 255, 0x2E / 255, 0x6F / 255],
  royal: [0x19 / 255, 0x76 / 255, 0xD2 / 255],
  bright: [0x33 / 255, 0xA1 / 255, 0xFF / 255],
  silver: [0xAE / 255, 0xB6 / 255, 0xBF / 255],
  white: [1, 1, 1],
};

function rgb(color) {
  return color.map((channel) => channel.toFixed(4)).join(" ");
}

function escapePdf(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\u2013", "\\226")
    .replaceAll("\u2014", "\\227")
    .replaceAll("\u2019", "\\222")
    .replace(/[^\x09\x20-\x7E\\]/g, "?");
}

function wrap(text, size, maxWidth) {
  const max = Math.max(8, Math.floor(maxWidth / (size * 0.5)));
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("");
  return lines.flatMap((line) => {
    if (line.length <= max) return [line];
    const parts = [];
    for (let index = 0; index < line.length; index += max) parts.push(line.slice(index, index + max));
    return parts;
  });
}

class ReportDocument {
  constructor() {
    this.pages = [];
    this.commands = [];
    this.annotations = [];
    this.y = 720;
  }

  command(value) {
    this.commands.push(value);
  }

  paint(color) {
    this.command(`${rgb(color)} rg`);
  }

  rect(x, y, width, height, color) {
    this.command(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${Math.max(width, 0).toFixed(2)} ${height.toFixed(2)} re f`);
  }

  text(x, y, value, size, font, color) {
    this.command(`BT /${font} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(value)}) Tj ET`);
  }

  ensure(height) {
    if (this.y - height < 58) this.finishPage(true);
  }

  write(value, { size = 10, font = "F1", color = BRAND.navy, gap = 4, x = 48 } = {}) {
    const lines = wrap(value, size, 516 - (x - 48));
    this.ensure(lines.length * (size + 4) + gap);
    for (const line of lines) {
      this.text(x, this.y, line, size, font, color);
      this.y -= size + 4;
    }
    this.y -= gap;
  }

  heading(value) {
    this.ensure(28);
    this.y -= 6;
    this.rect(48, this.y - 4, 516, 2, BRAND.bright);
    this.y -= 8;
    this.write(value, { size: 13, font: "F2", gap: 8 });
  }

  link(label, url) {
    this.ensure(18);
    this.text(48, this.y, label, 10, "F1", BRAND.navy);
    this.y -= 14;
    const width = Math.min(516, url.length * 5.2);
    this.text(48, this.y, url, 10, "F1", BRAND.royal);
    this.annotations.push(`<< /Type /Annot /Subtype /Link /Rect [48 ${(this.y - 2).toFixed(2)} ${(48 + width).toFixed(2)} ${(this.y + 11).toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${escapePdf(url)}) >> >>`);
    this.y -= 18;
  }

  header() {
    this.rect(0, 746, 612, 46, BRAND.navy);
    this.rect(0, 742, 612, 4, BRAND.bright);
    this.text(48, 768, "Pulse Analytics Group LLC", 11, "F2", BRAND.white);
    this.text(48, 752, "Marketing Benchmark Comparison Report", 14, "F2", BRAND.white);
  }

  finishPage(openNext) {
    this.text(48, 32, "Pulse Analytics Group LLC", 9, "F1", BRAND.silver);
    this.rect(48, 46, 516, 1, BRAND.silver);
    this.pages.push({
      commands: this.commands.join("\n"),
      annotations: this.annotations,
    });
    if (!openNext) return;
    this.commands = [];
    this.annotations = [];
    this.y = 720;
    this.header();
  }

  chart(report) {
    this.heading("Comparison");
    const left = 170;
    const maxWidth = 250;
    if (report.kind === "range") {
      this.write(`Your Result ${report.userDisplay}`, { font: "F2", size: 11, gap: 2 });
      this.write(`Benchmark Range ${report.benchmarkDisplay}`, { font: "F2", size: 11, gap: 8 });
      const low = report.rangeLowHundredths / 100;
      const high = report.rangeHighHundredths / 100;
      const user = report.userHundredths / 100;
      const domainMin = Math.min(low, user);
      const domainMax = Math.max(high, user);
      const span = domainMax - domainMin || 1;
      const start = left + ((low - domainMin) / span) * maxWidth;
      const end = left + ((high - domainMin) / span) * maxWidth;
      const marker = left + ((user - domainMin) / span) * maxWidth;
      this.ensure(36);
      this.rect(left, this.y - 8, maxWidth, 10, [0.93, 0.94, 0.95]);
      this.rect(start, this.y - 8, Math.max(end - start, 2), 10, BRAND.silver);
      this.rect(marker - 1.5, this.y - 14, 3, 22, BRAND.royal);
      this.y -= 28;
      this.write("The marker shows your result. The bar shows the published range.", { size: 9, color: BRAND.navy, gap: 4 });
      return;
    }

    const user = Math.max(report.userHundredths, 0) / 100;
    const benchmark = Math.max(report.benchmarkHundredths, 0) / 100;
    const scale = Math.max(user, benchmark, 0.01);
    this.ensure(52);
    this.text(48, this.y, "Your Result", 10, "F2", BRAND.navy);
    this.rect(left, this.y - 2, (user / scale) * maxWidth, 12, BRAND.royal);
    this.text(left + maxWidth + 8, this.y, report.userDisplay, 10, "F1", BRAND.navy);
    this.y -= 22;
    this.text(48, this.y, "Benchmark", 10, "F2", BRAND.navy);
    this.rect(left, this.y - 2, (benchmark / scale) * maxWidth, 12, BRAND.navy);
    this.text(left + maxWidth + 8, this.y, report.benchmarkDisplay, 10, "F1", BRAND.navy);
    this.y -= 24;
  }
}

function stream(content) {
  const data = `${content}\n`;
  const length = new TextEncoder().encode(data).length;
  return `<< /Length ${length} >>\nstream\n${data}endstream`;
}

function serialize(objects, infoId) {
  const encoder = new TextEncoder();
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  let size = encoder.encode(chunks[0]).length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const piece = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(piece);
    size += encoder.encode(piece).length;
  });
  let trailer = `xref\n0 ${objects.length + 1}\n`;
  trailer += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    trailer += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer << /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${size}\n%%EOF`;
  chunks.push(trailer);
  return encoder.encode(chunks.join(""));
}

export function createBenchmarkPdf(report) {
  if (!report?.metricName || !report.status || !report.userDisplay || !report.benchmarkDisplay) {
    throw new Error("incomplete report");
  }

  const doc = new ReportDocument();
  doc.header();
  const preparedFor = String(report.reportName || "").trim();
  if (preparedFor) doc.write(`Prepared for: ${preparedFor}`, { size: 12, font: "F2", gap: 4 });
  doc.write(`Report Date: ${report.reportDate || ""}`, { gap: 8 });

  doc.heading("Benchmark");
  doc.write(report.metricName, { size: 16, font: "F2", gap: 8 });
  doc.write(`Your Result: ${report.userDisplay}`, { size: 12, font: "F2", gap: 2 });
  doc.write(`Published Benchmark: ${report.benchmarkDisplay}`, { size: 12, font: "F2", gap: 2 });
  doc.write(`Benchmark Status: ${report.status}`, { size: 12, font: "F2", gap: 2 });
  doc.write(`Difference: ${report.differenceDisplay}`, { size: 12, gap: 2 });
  doc.write(report.sentence || "", { gap: 6 });
  doc.chart(report);

  doc.heading("Benchmark Context");
  if (report.observationLabel) doc.write(`Selected observation: ${report.observationLabel}`);
  doc.write(`Source: ${report.provider}`);
  doc.write(`Period: ${report.period}`);
  doc.write(`Segment: ${report.segment}`);
  doc.write(`Geography: ${report.geography}`);
  doc.write(`Dataset/report: ${report.report}`);

  doc.heading("What This Metric Means");
  doc.write(report.definition);

  doc.heading("Methodology");
  doc.write(report.methodology);

  doc.heading("Limitations");
  doc.write(report.limitations);
  if (report.directionNote) doc.write(report.directionNote);

  doc.heading("About This Comparison");
  doc.write(report.notice);
  doc.write(report.review);

  doc.heading("Source");
  doc.write(report.provider, { font: "F2" });
  doc.link("Source URL", report.sourceUrl);
  doc.finishPage(false);

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [] /Count 0 >>");
  const infoId = add("<< /Title (Marketing Benchmark Comparison Report) /Author (Pulse Analytics Group LLC) >>");
  const regularId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const page of doc.pages) {
    const contentId = add(stream(page.commands));
    const annotations = page.annotations.length ? ` /Annots [${page.annotations.join(" ")}]` : "";
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R${annotations} >>`);
    kids.push(`${pageId} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  return serialize(objects, infoId);
}

export function buildReportDownload(comparison, options = {}) {
  const createPdf = options.createPdf || createBenchmarkPdf;
  try {
    const bytes = createPdf(comparison);
    if (!(bytes instanceof Uint8Array) || bytes.length < 20) throw new Error("empty");
    return {
      ok: true,
      bytes,
      filename: reportFilename(comparison.reportName),
      comparison,
    };
  } catch {
    return { ok: false, message: PDF_ERROR_MESSAGE, comparison };
  }
}
