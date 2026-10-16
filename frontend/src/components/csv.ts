/** CSV serialisation with RFC 4180 quoting and a spreadsheet formula-injection guard. */
export const esc = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // Spreadsheet formula injection guard: text cells starting with = + - @ are prefixed so Excel/Sheets treat them as text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (columns: string[], rows: unknown[][]) => [columns, ...rows].map((r) => r.map(esc).join(",")).join("\n");
