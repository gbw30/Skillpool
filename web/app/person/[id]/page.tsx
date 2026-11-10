"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, openSource, type PersonProfile } from "@/lib/api";

function Person() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [error, setError] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api<PersonProfile>(`person/${id}`)
      .then((data) => current && setPerson(data))
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : "Could not load this person."));
    return () => { current = false; };
  }, [id]);

  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!person) return <p className="status pulse" role="status">Loading…</p>;

  const aliases = (person.aliases ?? []).filter((a) => a !== person.name);
  return (
    <>
      <h1>{person.name}</h1>
      <p className="muted">
        {person.title ?? "No title on record"}
        {aliases.length > 0 && <> · also written as {aliases.join(", ")}</>}
      </p>
      {person.possibleSame.length > 0 && (
        <p className="notice">
          May be the same person as{" "}
          {person.possibleSame.map((p, i) => (
            <span key={p.id}>{i > 0 && ", "}<Link href={`/person/${p.id}`}>{p.name}</Link></span>
          ))}
          . The records were kept apart because nothing beyond the name confirmed it.
        </p>
      )}

      <div className="columns">
        <section className="card">
          <h2>Skills</h2>
          {person.skills.length === 0 ? <p className="muted">None recorded.</p> : (
            <ul className="tags">
              {person.skills.map((s) => <li key={s.name}>{s.name}{s.level ? ` · ${s.level}` : ""}</li>)}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Roles</h2>
          {person.roles.length === 0 ? <p className="muted">None recorded.</p> : (
            <ul className="plain">
              {person.roles.map((r, i) => (
                <li key={i}>
                  {r.title || "Role"} at {r.org}
                  {(r.start || r.end) && <span className="muted small"> · {r.start ?? "?"} to {r.end ?? "?"}</span>}
                </li>
              ))}
            </ul>
          )}
          {person.education.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Education</h2>
              <ul className="plain">
                {person.education.map((e, i) => (
                  <li key={i}>{[e.degree, e.field].filter(Boolean).join(", ") || "Studied"} at {e.school}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card">
          <h2>Projects</h2>
          {person.projects.length === 0 ? <p className="muted">None recorded.</p> : (
            <ul className="plain">
              {person.projects.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>{p.role ? ` · ${p.role}` : ""}
                  {p.collaborators.length > 0 && (
                    <div className="small muted">
                      With{" "}
                      {p.collaborators.map((c, i) => (
                        <span key={c.id}>{i > 0 && ", "}<Link href={`/person/${c.id}`}>{c.name}</Link></span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Evidence</h2>
        {sourceError && <p className="small muted" role="status">{sourceError}</p>}
        {person.evidence.length === 0 ? <p className="muted">No passages on record.</p> : (
          <ul className="evidence">
            {person.evidence.map((e) => (
              <li key={e.chunkId}>
                <blockquote>{e.text}</blockquote>
                <div className="source">
                  <span>{e.path}</span>
                  <button className="link small" type="button" onClick={async () => setSourceError(await openSource(e.docId))}>
                    Open source
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// The id is only known at request time, so the page shell renders first and this streams in.
export default function PersonPage() {
  return (
    <Suspense fallback={<p className="status pulse" role="status">Loading…</p>}>
      <Person />
    </Suspense>
  );
}
