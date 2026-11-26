// Tiny .xlsx reader / writer for the school-setup import (browser only).
// An .xlsx file is a zip of XML files: fflate unzips/zips, DOMParser reads XML
// (the browser never fetches external entities). Only what we need: cell
// values of each sheet, and simple sheets of text when writing.
import { strToU8, unzipSync, zipSync } from "fflate";

const MAX_UNZIPPED = 30 * 1024 * 1024;   // a real school file is < 2 MB; refuse "zip bombs"

export type Sheet = { name: string; rows: string[][] };   // rows[i][j] = text of cell (row i+1, col j+1)

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+$/, "");
  let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const text = (el: Element | null) => (el ? Array.from(el.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("") : "");

export function readXlsx(buf: ArrayBuffer): Sheet[] {
  let total = 0;
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
      total += f.originalSize; if (total > MAX_UNZIPPED) throw new Error("file_too_big");
      return true;
    },
  });
  const xml = (name: string) => files[name] ? new DOMParser().parseFromString(new TextDecoder().decode(files[name]), "application/xml") : null;
  const wb = xml("xl/workbook.xml"); if (!wb) throw new Error("not_xlsx");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const target: Record<string, string> = {};
  for (const r of Array.from(rels?.getElementsByTagName("Relationship") ?? [])) target[r.getAttribute("Id") ?? ""] = r.getAttribute("Target") ?? "";
  const shared = Array.from(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? []).map((si) => text(si));
  return Array.from(wb.getElementsByTagName("sheet")).map((s) => {
    const rid = s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const path = "xl/" + (target[rid] ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const doc = xml(path);
    const rows: string[][] = [];
    for (const row of Array.from(doc?.getElementsByTagName("row") ?? [])) {
      const ri = Number(row.getAttribute("r")) - 1; if (ri < 0 || ri > 10000) continue;
      const out: string[] = [];
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const ci = colIndex(c.getAttribute("r") ?? "A1"); if (ci < 0 || ci > 50) continue;
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        out[ci] = (t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? text(c.getElementsByTagName("is")[0]) : v).trim();
      }
      rows[ri] = Array.from(out, (x) => x ?? "");
    }
    return { name: s.getAttribute("name") ?? "", rows: Array.from(rows, (r) => r ?? []) };
  });
}

// Excel stores dates as day numbers since 1899-12-30 when the cell is a date.
export function excelDate(v: string): string {
  if (/^\d{4,5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  return v;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// sheets of plain text; the first row is bold (a header) unless plain = true
export function writeXlsx(sheets: { name: string; rows: string[][]; widths?: number[]; plain?: boolean }[]): Blob {
  const sheetXml = (s: (typeof sheets)[number]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "") +
    `<sheetData>${s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) =>
      `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 && !s.plain ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
