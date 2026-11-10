"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { openSource, type PersonResult, type SearchResults } from "@/lib/api";

const EXAMPLES = [
  "Who has hands-on experience with Kafka?",
  "Who is an expert in Redis and also knows Python?",
  "I need a senior Android developer who has shipped to production.",
];

type Phase = "idle" | "searching" | "writing" | "done" | "error";

/** Answer text with each [n] turned into a link to that evidence passage. Never rendered as HTML. */
function Answer({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1];
        return n ? <a key={i} className="cite" href={`#e-${n}`}>{part}</a> : part;
      })}
    </>
  );
}

function PersonCard({ person, rank }: { person: PersonResult; rank: number }) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  return (
    <li className="card">
      <div className="person-head">
        <span className="rank">{rank}.</span>
        <h3><Link href={`/person/${person.id}`}>{person.name}</Link></h3>
        {person.title && <span className="muted">{person.title}</span>}
      </div>
      {person.matchedSkills.length > 0 && (
        <ul className="tags" aria-label="Matched skills">
          {person.matchedSkills.map((s) => (
            <li key={s.name}>{s.name}{s.level ? ` · ${s.level}` : ""}</li>
          ))}
        </ul>
      )}
      {person.paths.map((path) => <p key={path} className="path">{path}</p>)}
      <ul className="evidence" aria-label={`Evidence for ${person.name}`}>
        {person.evidence.map((e) => (
          <li key={e.n} id={`e-${e.n}`}>
            <blockquote>{e.text}</blockquote>
            <div className="source">
              <span className="cite">[{e.n}]</span>
              <span>{e.path}</span>
              <button className="link small" type="button" onClick={async () => setSourceError(await openSource(e.docId))}>
                Open source
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sourceError && <p className="small muted" role="status">{sourceError}</p>}
    </li>
  );
}

export default function SearchPage() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
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

  const count = results?.people.length ?? 0;
  const status =
    phase === "searching" ? "Searching…"
    : phase === "writing" ? `${count} ${count === 1 ? "person" : "people"} found. Writing the recommendation…`
    : phase === "done" && results?.confidence === "none" ? "No confident match."
    : phase === "done" ? `${count} ${count === 1 ? "person" : "people"} found.`
    : "";

  return (
    <>
      <h1>Who should staff it?</h1>
      <form className="search-form" onSubmit={(event) => { event.preventDefault(); run(question); }}>
        <label htmlFor="q">Describe who you need</label>
        <input
          id="q" type="text" value={question} maxLength={500} autoComplete="off"
          placeholder="e.g. two people who have run a Kubernetes migration"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div><button type="submit" disabled={phase === "searching" || !question.trim()}>Search</button></div>
      </form>
      {phase === "idle" && (
        <ul className="examples" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <li key={example}><button type="button" onClick={() => run(example)}>{example}</button></li>
          ))}
        </ul>
      )}

      <p className={`status${phase === "searching" || phase === "writing" ? " pulse" : ""}`} role="status" aria-live="polite">{status}</p>
      {phase === "error" && <p className="notice" role="alert">{error}</p>}

      {results && (
        <div className="results">
          <section aria-label="Candidates">
            {results.confidence === "none" ? (
              <p className="card">
                Nothing in the indexed documents clearly matches. Try naming a skill, a technology, or a project.
              </p>
            ) : (
              <ol className="plain">
                {results.people.map((person, i) => <PersonCard key={person.id} person={person} rank={i + 1} />)}
              </ol>
            )}
          </section>
          {results.confidence !== "none" && (
            <section className="card answer" aria-label="Recommendation">
              <h2>Recommendation</h2>
              {answer ? <Answer text={answer} /> : <span className="muted">Writing…</span>}
            </section>
          )}
        </div>
      )}
    </>
  );
}
