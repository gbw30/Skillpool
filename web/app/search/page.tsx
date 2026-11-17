"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EvidenceList } from "@/components/evidence-list";
import { Alert, ArrowUpRight, Search } from "@/components/icons";
import { PathGraph } from "@/components/path-graph";
import { ASKED_KEY, openSource, type Evidence, type PersonResult, type SearchResults } from "@/lib/api";

const EXAMPLES = [
  "Who has hands-on experience with Kafka?",
  "Who is an expert in Redis and also knows Python?",
  "I need a senior Android developer who has shipped to production.",
];

type Phase = "idle" | "searching" | "writing" | "done" | "error";
type Cite = (n: number | null) => void;

/** "generated/atlas-migration/kickoff-email.txt" -> "kickoff-email.txt" */
const fileName = (path: string) => path.split("/").pop() ?? path;
/** "generated/atlas-migration/kickoff-email.txt" -> "Kickoff email" */
const fileTitle = (path: string) => {
  const words = fileName(path).replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Answer text with each [n] turned into a link to that evidence passage. Never rendered as HTML.
 * On a wide screen the passage opens on the sheet beside the list; on a narrow one the link jumps to it.
 */
function Answer({ text, onCite, onPick }: { text: string; onCite: Cite; onPick: (n: number) => void }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i, parts) => {
        const n = Number(part.match(/^\[(\d+)\]$/)?.[1]);
        const follows = i >= 2 && parts[i - 1] === ""; // "[1][2]" reads "1, 2", not "12"
        return n ? (
          <a
            key={i} href={`#e-${n}`} className="align-super font-sans text-[0.5em] font-semibold no-underline hover:underline"
            onMouseEnter={() => onCite(n)} onMouseLeave={() => onCite(null)}
            onFocus={() => onCite(n)} onBlur={() => onCite(null)} onClick={() => onPick(n)}
          >
            {follows && ", "}{n}
          </a>
        ) : part;
      })}
    </>
  );
}

/** `text` with every place it writes `name` marked. Plain text nodes, never HTML. */
function Marked({ text, name }: { text: string; name: string }) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return text;
  return <>{text.split(new RegExp(`(${escaped})`, "gi")).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

type Passage = Evidence & { person: string };

/** The chosen passage, read on a sheet of paper beside the list. Wide screens only; narrow ones show every passage in place. */
function Reader({ passage, at, total, onStep }: { passage: Passage; at: number; total: number; onStep: (by: number) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const step = "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:text-paper-ink";
  return (
    <aside aria-label="Selected passage" className="sheet enter sticky top-6 flex min-h-[30rem] flex-col p-7 max-lg:hidden xl:p-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-paper-ink/20 pb-4">
        <p className="label !text-paper-muted" aria-live="polite">Source {passage.n} of {total}</p>
        <button
          type="button" className="inline-flex cursor-pointer items-center gap-1 border-b border-paper-ink pb-px text-[0.8125rem] font-semibold"
          onClick={async () => setProblem(await openSource(passage.docId))}
        >
          Open source <ArrowUpRight />
        </button>
      </div>
      <p className="mt-6 font-serif text-[2rem] font-medium leading-none wrap-anywhere">{fileTitle(passage.path)}</p>
      <p className="mt-2 font-mono text-xs text-paper-muted wrap-anywhere">{passage.path}</p>
      <blockquote className="mt-6 flex-1 whitespace-pre-wrap font-mono text-[0.8125rem] leading-7 wrap-anywhere">
        <Marked text={passage.text} name={passage.person} />
      </blockquote>
      {problem && <p className="mt-4 text-sm text-paper-muted" role="status">{problem}</p>}
      <div className="mt-6 flex justify-between gap-4 border-t border-paper-ink/20 pt-4 text-xs text-paper-muted">
        <button type="button" className={step} disabled={at === 0} onClick={() => onStep(-1)}>← Previous passage</button>
        <button type="button" className={step} disabled={at === total - 1} onClick={() => onStep(1)}>Next passage →</button>
      </div>
    </aside>
  );
}

type RowProps = { person: PersonResult; rank: number; cited: number | null; reading: number | null; onPick: (n: number) => void };

function PersonRow({ person, rank, cited, reading, onPick }: RowProps) {
  return (
    // Rows enter in sequence; --i caps the wait so a long list does not crawl in.
    <li className="enter grid grid-cols-[2.75rem_minmax(0,1fr)] border-t border-line py-7 sm:grid-cols-[4rem_minmax(0,1fr)]" style={{ "--i": Math.min(rank - 1, 5) } as CSSProperties}>
      <span className="font-serif text-2xl italic leading-9 tabular-nums text-muted">{String(rank).padStart(2, "0")}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 font-serif text-[2.125rem] leading-none wrap-anywhere">
            <Link className="text-ink no-underline hover:text-accent" href={`/person/${person.id}`}>{person.name}</Link>
          </h3>
          {person.title && <span className="text-sm text-muted">{person.title}</span>}
        </div>
        <PathGraph name={person.name} links={person.links} matched={person.matchedSkills} />
        {/* Wide screens: a line per passage, and choosing one opens it on the sheet. */}
        <ul aria-label={`Evidence for ${person.name}`} className="mt-5 grid grid-cols-1 gap-0.5 max-lg:hidden">
          {person.evidence.map((e) => {
            const on = e.n === reading;
            return (
              <li key={e.chunkId}>
                <button
                  type="button" aria-pressed={on} onClick={() => onPick(e.n)}
                  className={`flex w-full cursor-pointer items-baseline gap-3 border-l py-1.5 pl-3 text-left text-sm ${
                    on || e.n === cited ? "border-accent text-ink" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  <span className="w-4 shrink-0 text-xs font-semibold text-accent">{e.n}</span>
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-xs">{on ? "Reading →" : fileName(e.path)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 lg:hidden">
          <EvidenceList items={person.evidence} label={`Evidence for ${person.name}`} active={cited} />
        </div>
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
  const [picked, setPicked] = useState<number | null>(null);
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
    setPicked(null);
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

  // The landing page hands a question over as /search?q=... and it is asked once on arrival.
  // A link from anywhere else only fills the box and waits for Enter: every search costs money,
  // and a link must not be able to spend it for whoever follows it.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    const asked = new URLSearchParams(location.search).get("q");
    if (!asked) return;
    let ours = false;
    try {
      ours = sessionStorage.getItem(ASKED_KEY) === asked;
      sessionStorage.removeItem(ASKED_KEY);
    } catch {}
    queueMicrotask(() => (ours ? run(asked) : setQuestion(asked))); // after this render, not during the effect
  });

  const count = results?.people.length ?? 0;
  const status =
    phase === "searching" ? "Searching…"
    : phase === "writing" ? `${count} ${count === 1 ? "person" : "people"} found. Writing the answer…`
    : phase === "done" && results?.confidence === "none" ? "No confident match."
    : phase === "done" ? `${count} ${count === 1 ? "person" : "people"} found.`
    : "";

  const busy = phase === "searching" || phase === "writing";
  // Every passage in the order it is numbered. The sheet shows the chosen one, or the first.
  const passages: Passage[] = results?.people.flatMap((person) => person.evidence.map((e) => ({ ...e, person: person.name }))) ?? [];
  const reading = passages.find((p) => p.n === picked) ?? passages[0] ?? null;

  return (
    <div className="page">
      <div className="max-w-3xl">
        <p className="label">Question</p>
        <h1 className="mt-3">Who should <em>staff it?</em></h1>
        <form className="mt-8" onSubmit={(event) => { event.preventDefault(); run(question); }}>
          <label className="label mb-2 block" htmlFor="q">Describe who you need</label>
          <div className="flex gap-2">
            <input
              id="q" type="text" className="input h-14 min-w-0 flex-1 border-accent/55 px-5 text-base" value={question} maxLength={500} autoComplete="off"
              placeholder="e.g. two people who have run a Kubernetes migration"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button className="btn h-14 px-6" type="submit" disabled={phase === "searching" || !question.trim()}>
              <Search /> Search
            </button>
          </div>
        </form>
        {phase === "idle" && (
          <ul className="mt-5 grid gap-2 text-sm" aria-label="Example questions">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" onClick={() => run(example)} className="chip cursor-pointer text-left font-normal text-muted hover:text-ink">
                  {example}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={`label mt-8 min-h-4${busy ? " pulse" : ""}`} role="status" aria-live="polite">{status}</p>
      {phase === "error" && (
        <p className="panel mt-3 flex items-start gap-2 border-danger/50 p-4 text-danger" role="alert">
          <Alert className="mt-1 shrink-0" /> {error}
        </p>
      )}

      {phase === "searching" && (
        <div className="mt-4 lg:w-3/5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="pulse border-t border-line py-7">
              <div className="h-8 w-64 rounded-[2px] bg-raised" />
              <div className="mt-5 h-16 rounded-[2px] bg-raised" />
              <div className="mt-4 h-3 w-4/5 rounded-[2px] bg-raised" />
            </div>
          ))}
        </div>
      )}

      {results?.confidence === "none" && (
        <p className="ruled mt-4 max-w-3xl font-serif text-2xl leading-snug text-muted">
          Nothing in the indexed documents clearly matches. Try naming a skill, a technology, or a project.
        </p>
      )}

      {results && results.confidence !== "none" && (
        <div className="mt-4 grid grid-cols-1 items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <section className="ruled" aria-label="Recommendation">
              <h2 className="label mb-3">The short answer</h2>
              <p className={`whitespace-pre-wrap font-serif text-[1.625rem] leading-[1.3]${phase === "writing" ? " caret" : ""}`}>
                {answer ? <Answer text={answer} onCite={setCited} onPick={setPicked} /> : <span className="text-muted">Writing</span>}
              </p>
              <p className="mt-3 text-sm text-muted">Written by AI (Anthropic&rsquo;s Claude) from the cited passages. It can be wrong: check the sources.</p>
            </section>
            <section className="mt-12" aria-label="Candidates">
              <h2 className="label pb-3">Ranked people</h2>
              <ol>
                {results.people.map((person, i) => (
                  <PersonRow key={person.id} person={person} rank={i + 1} cited={cited} reading={reading?.n ?? null} onPick={setPicked} />
                ))}
              </ol>
            </section>
          </div>
          {reading && (
            <Reader
              key={reading.n} passage={reading} at={passages.indexOf(reading)} total={passages.length}
              onStep={(by) => setPicked(passages[passages.indexOf(reading) + by]?.n ?? reading.n)}
            />
          )}
        </div>
      )}
    </div>
  );
}
