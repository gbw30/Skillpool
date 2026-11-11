"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EvidenceList } from "@/components/evidence-list";
import { Alert, Search } from "@/components/icons";
import { PathGraph } from "@/components/path-graph";
import type { PersonResult, SearchResults } from "@/lib/api";

const EXAMPLES = [
  "Who has hands-on experience with Kafka?",
  "Who is an expert in Redis and also knows Python?",
  "I need a senior Android developer who has shipped to production.",
];

type Phase = "idle" | "searching" | "writing" | "done" | "error";
type Cite = (n: number | null) => void;

/** Answer text with each [n] turned into a link to that evidence passage. Never rendered as HTML. */
function Answer({ text, onCite }: { text: string; onCite: Cite }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const n = Number(part.match(/^\[(\d+)\]$/)?.[1]);
        return n ? (
          <a
            key={i} href={`#e-${n}`} className="font-mono text-[0.85em] font-medium no-underline hover:underline"
            onMouseEnter={() => onCite(n)} onMouseLeave={() => onCite(null)}
            onFocus={() => onCite(n)} onBlur={() => onCite(null)}
          >
            {part}
          </a>
        ) : part;
      })}
    </>
  );
}

function PersonCard({ person, rank, cited }: { person: PersonResult; rank: number; cited: number | null }) {
  return (
    // Cards enter in sequence; --i caps the wait so a long list does not crawl in.
    <li className="panel enter p-4 sm:p-5" style={{ "--i": Math.min(rank - 1, 5) } as CSSProperties}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-muted">{String(rank).padStart(2, "0")}</span>
        <h3 className="min-w-0 text-lg font-semibold tracking-tight wrap-anywhere">
          <Link className="text-ink no-underline hover:underline" href={`/person/${person.id}`}>{person.name}</Link>
        </h3>
        {person.title && <span className="text-sm text-muted">{person.title}</span>}
      </div>
      <PathGraph name={person.name} links={person.links} matched={person.matchedSkills} />
      <div className="mt-4">
        <EvidenceList items={person.evidence} label={`Evidence for ${person.name}`} active={cited} />
      </div>
    </li>
  );
}

export default function SearchPage() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [cited, setCited] = useState<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  async function run(q: string) {
    q = q.trim();
    if (!q) return;
    inFlight.current?.abort();
    const controller = (inFlight.current = new AbortController());
    setQuestion(q);
    setPhase("searching");
    setResults(null);
    setAnswer("");
    setError("");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Search failed. Try again.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);
          if (event === "results") {
            setResults(payload);
            setPhase("writing");
          } else if (event === "answer") {
            setAnswer((current) => current + payload.text);
          } else if (event === "error") {
            throw new Error(payload.message);
          } else if (event === "done") {
            setPhase("done");
          }
        }
      }
      setPhase((current) => (current === "writing" ? "done" : current));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Search failed. Try again.");
      setPhase("error");
    }
  }

  // The landing page hands a question over as /search?q=...; ask it once on arrival.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    const asked = new URLSearchParams(location.search).get("q");
    if (asked) queueMicrotask(() => run(asked)); // after this render, not during the effect
  });

  const count = results?.people.length ?? 0;
  const status =
    phase === "searching" ? "Searching…"
    : phase === "writing" ? `${count} ${count === 1 ? "person" : "people"} found. Writing the recommendation…`
    : phase === "done" && results?.confidence === "none" ? "No confident match."
    : phase === "done" ? `${count} ${count === 1 ? "person" : "people"} found.`
    : "";

  const busy = phase === "searching" || phase === "writing";

  return (
    <div className="page">
      <div className="max-w-3xl">
        <h1>Who should staff it?</h1>
        <form className="mt-6" onSubmit={(event) => { event.preventDefault(); run(question); }}>
          <label className="label mb-2 block" htmlFor="q">Describe who you need</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-accent" aria-hidden>&gt;</span>
              <input
                id="q" type="text" className="input pl-8" value={question} maxLength={500} autoComplete="off"
                placeholder="e.g. two people who have run a Kubernetes migration"
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
            <button className="btn" type="submit" disabled={phase === "searching" || !question.trim()}>
              <Search /> Search
            </button>
          </div>
        </form>
        {phase === "idle" && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Example questions">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button" onClick={() => run(example)}
                  className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-left text-sm text-muted hover:border-edge hover:text-ink"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={`mt-6 min-h-5 font-mono text-xs text-muted${busy ? " pulse" : ""}`} role="status" aria-live="polite">{status}</p>
      {phase === "error" && (
        <p className="panel mt-3 flex items-start gap-2 border-danger/50 p-4 text-danger" role="alert">
          <Alert className="mt-1 shrink-0" /> {error}
        </p>
      )}

      {phase === "searching" && (
        <div className="mt-3 grid gap-4 lg:w-3/5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel pulse p-5">
              <div className="h-5 w-48 rounded bg-raised" />
              <div className="mt-4 h-20 rounded bg-raised" />
              <div className="mt-4 h-3 w-4/5 rounded bg-raised" />
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="mt-3 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-label="Candidates">
            {results.confidence === "none" ? (
              <p className="panel p-5 text-muted">
                Nothing in the indexed documents clearly matches. Try naming a skill, a technology, or a project.
              </p>
            ) : (
              <ol className="grid grid-cols-1 gap-4">
                {results.people.map((person, i) => <PersonCard key={person.id} person={person} rank={i + 1} cited={cited} />)}
              </ol>
            )}
          </section>
          {results.confidence !== "none" && (
            // On a phone the recommendation comes before the candidates.
            <section className="panel p-5 max-lg:order-first lg:sticky lg:top-6" aria-label="Recommendation">
              <h2 className="label mb-3">Recommendation</h2>
              <p className={`whitespace-pre-wrap${phase === "writing" ? " caret" : ""}`}>
                {answer ? <Answer text={answer} onCite={setCited} /> : <span className="text-muted">Writing</span>}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
