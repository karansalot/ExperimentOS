"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv } from "./csv";

/** Downloads table data as CSV (raw values, not formatted text). */
export function CsvButton({ filename, columns, rows, label = "CSV" }: { filename: string; columns: string[]; rows: unknown[][]; label?: string }) {
  const download = () => {
    const text = toCsv(columns, rows);
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
