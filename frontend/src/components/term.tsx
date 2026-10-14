"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** A jargon word with a dotted underline; hover, focus or tap shows a plain-language definition. */
export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const g = GLOSSARY[k];
  const [open, setOpen] = React.useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cursor-help rounded-sm underline decoration-dotted decoration-1 underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          aria-label={`${g.term}: definition`}
        >
          {children ?? g.term}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground shadow-lg"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="font-semibold">{g.term}</div>
          <p className="mt-0.5 text-secondary">{g.short}</p>
          <Link href={`/glossary#${k}`} className="mt-1 inline-block text-accent">All definitions</Link>
          <Popover.Arrow className="fill-[color:var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
