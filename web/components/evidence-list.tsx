"use client";

import { useState } from "react";
import { openSource } from "@/lib/api";
import { ArrowUpRight } from "./icons";

type Passage = { n?: number; chunkId: string; docId: string; path: string; text: string };

/** Quoted passages with their source files. `active` is the citation number to highlight. */
export function EvidenceList({ items, label, active }: { items: Passage[]; label: string; active?: number | null }) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  return (
    <>
      <ul aria-label={label} className="grid grid-cols-1 gap-4">
        {items.map((e) => (
          <li
            key={e.chunkId} id={e.n ? `e-${e.n}` : undefined}
            className={`scroll-mt-6 border-l py-1 pl-4 pr-2 target:border-accent target:bg-accent/10 ${
              e.n && e.n === active ? "border-accent bg-accent/10" : "border-line"
            }`}
          >
            <blockquote className="text-[0.9375rem] leading-relaxed">{e.text}</blockquote>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
              {e.n && <span className="font-semibold text-accent">{e.n}</span>}
              <span className="min-w-0 font-mono wrap-anywhere">{e.path}</span>
              <button className="link inline-flex items-center gap-0.5" type="button" onClick={async () => setSourceError(await openSource(e.docId))}>
                Open source <ArrowUpRight />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sourceError && <p className="mt-2 text-sm text-muted" role="status">{sourceError}</p>}
    </>
  );
}
