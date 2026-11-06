/**
 * Converts rows to CSV. Values that a spreadsheet would treat as a formula
 * (leading = + - @ tab or CR) are prefixed with an apostrophe to prevent
 * CSV/formula injection when an admin opens the export.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(rows.reduce<Set<string>>((s, r) => (Object.keys(r).forEach((k) => s.add(k)), s), new Set()));
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(","));
  return lines.join("\r\n");
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
