"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { EvidenceList } from "@/components/evidence-list";
import { Alert } from "@/components/icons";
import { Glyph } from "@/components/path-graph";
import { api, type PersonProfile } from "@/lib/api";

// How many of the three bars a stated level fills.
const LEVELS: Record<string, number> = { beginner: 1, basic: 1, intermediate: 2, advanced: 3, expert: 3, fluent: 3, native: 3 };

function Level({ level }: { level: string | null }) {
  const filled = LEVELS[level?.toLowerCase() ?? ""] ?? 0;
  if (!level) return null;
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
      {filled > 0 && (
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3].map((bar) => <span key={bar} className={`h-2.5 w-1 rounded-sm ${bar <= filled ? "bg-skill" : "bg-line"}`} />)}
        </span>
      )}
      {level}
    </span>
  );
}

const none = <p className="text-sm text-muted">None recorded.</p>;

function Person() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    api<PersonProfile>(`person/${id}`)
      .then((data) => current && setPerson(data))
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : "Could not load this person."));
    return () => { current = false; };
  }, [id]);

  if (error) return <p className="panel flex items-start gap-2 border-danger/50 p-4 text-danger" role="alert"><Alert className="mt-1 shrink-0" /> {error}</p>;
  if (!person) return <p className="pulse font-mono text-xs text-muted" role="status">Loading…</p>;

  const aliases = (person.aliases ?? []).filter((a) => a !== person.name);
  const unconfirmed = [...new Set(person.unconfirmed.map((u) => u.path))]; // one line per document, not per passage
  return (
    <>
      <p className="label flex items-center gap-2"><Glyph kind="person" /> Person</p>
      <h1 className="mt-3 wrap-anywhere">{person.name}</h1>
      <p className="mt-2 text-lg text-muted">{person.title ?? "No title on record"}</p>
      {aliases.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          Also written as {aliases.map((alias) => <span key={alias} className="chip">{alias}</span>)}
        </p>
      )}
      {unconfirmed.length > 0 && (
        <p className="panel mt-6 flex items-start gap-2 border-skill/50 p-4 text-sm">
          <Alert className="mt-0.5 shrink-0 text-skill" />
          <span>
            {unconfirmed.length === 1 ? "One more document uses" : `${unconfirmed.length} more documents use`} the name{" "}
            {person.name}: <span className="wrap-anywhere font-mono text-xs">{unconfirmed.slice(0, 3).join(", ")}</span>
            {unconfirmed.length > 3 && ` and ${unconfirmed.length - 3} more`}. Nothing beyond
            the name confirmed it is this person, so {unconfirmed.length === 1 ? "it is" : "they are"} not counted as evidence.
          </span>
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="panel p-4 sm:p-5" aria-labelledby="skills">
          <h2 id="skills" className="label mb-4 flex items-center gap-2"><Glyph kind="skill" /> Skills</h2>
          {person.skills.length === 0 ? none : (
            <ul className="grid gap-2">
              {person.skills.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 wrap-anywhere">{s.name}</span><Level level={s.level} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-4 sm:p-5" aria-labelledby="roles">
          <h2 id="roles" className="label mb-4">Roles</h2>
          {person.roles.length === 0 ? none : (
            <ul className="grid gap-3">
              {person.roles.map((r, i) => (
                <li key={i} className="border-l border-line pl-3 text-sm">
                  <span className="block font-medium">{r.title || "Role"}</span>
                  <span className="block text-muted">{r.org}</span>
                  {(r.start || r.end) && <span className="mt-0.5 block font-mono text-[11px] text-muted">{r.start ?? "?"} to {r.end ?? "now"}</span>}
                </li>
              ))}
            </ul>
          )}
          {person.education.length > 0 && (
            <>
              <h2 className="label mb-4 mt-6">Education</h2>
              <ul className="grid gap-3">
                {person.education.map((e, i) => (
                  <li key={i} className="border-l border-line pl-3 text-sm">
                    <span className="block font-medium">{[e.degree, e.field].filter(Boolean).join(", ") || "Studied"}</span>
                    <span className="block text-muted">{e.school}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel p-4 sm:p-5" aria-labelledby="projects">
          <h2 id="projects" className="label mb-4 flex items-center gap-2"><Glyph kind="project" /> Projects</h2>
          {person.projects.length === 0 ? none : (
            <ul className="grid gap-4">
              {person.projects.map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="block font-medium">{p.name}</span>
                  {p.role && <span className="block text-muted">{p.role}</span>}
                  {p.collaborators.length > 0 && (
                    <span className="mt-1 block text-muted">
                      With{" "}
                      {p.collaborators.map((c, i) => (
                        <span key={c.id}>{i > 0 && ", "}<Link href={`/person/${c.id}`}>{c.name}</Link></span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel mt-4 p-4 sm:p-5" aria-labelledby="evidence">
        <h2 id="evidence" className="label mb-4">Evidence</h2>
        {person.evidence.length === 0
          ? <p className="text-sm text-muted">No passages on record.</p>
          : <EvidenceList items={person.evidence} label={`Passages about ${person.name}`} />}
      </section>
    </>
  );
}

// The id is only known at request time, so the page shell renders first and this streams in.
export default function PersonPage() {
  return (
    <div className="page">
      <Suspense fallback={<p className="pulse font-mono text-xs text-muted" role="status">Loading…</p>}>
        <Person />
      </Suspense>
    </div>
  );
}
