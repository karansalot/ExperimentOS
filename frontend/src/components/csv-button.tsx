"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Downloads table data as CSV (raw values, not formatted text). */
export function CsvButton({ filename, columns, rows, label = "CSV" }: { filename: string; columns: string[]; rows: unknown[][]; label?: string }) {
  const download = () => {
    const text = [columns, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={download} className="no-print" aria-label={`Download ${filename}`}>
      <Download className="h-3.5 w-3.5" aria-hidden /> {label}
    </Button>
  );
}
