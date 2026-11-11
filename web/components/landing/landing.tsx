"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Glyph } from "@/components/path-graph";
import { api, type GraphData } from "@/lib/api";
import { buildGraph, sampleGraph, type Graph } from "@/lib/graph";

// three.js is large and only this page draws with it, so it loads on its own, in the browser.
const GraphCanvas = dynamic(() => import("./graph-canvas").then((module) => module.GraphCanvas), { ssr: false });

type View = { data: GraphData; graph: Graph; source: "indexed" | "empty" | "failed" };

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** The same graph as text: each project with its people and skills. For keyboards, screen readers, and browsers without WebGL. */
function GraphList({ data }: { data: GraphData }) {
  const name = (list: { id: string; name: string }[], id: string) => list.find((item) => item.id === id)?.name ?? id;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {data.projects.map((project) => (
        <li key={project.id}>
          <p className="flex items-center gap-1.5 font-medium"><Glyph kind="project" /> {project.name}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
            {data.workedOn.filter(([, id]) => id === project.id).map(([person]) => (
              <li key={person}><Link href={`/person/${person}`}>{name(data.people, person)}</Link></li>
            ))}
          </ul>
          <p className="mt-1 font-mono text-xs text-muted">
            {data.used.filter(([id]) => id === project.id).map(([, skill]) => name(data.skills, skill)).join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function Landing() {
  const stage = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [drawable, setDrawable] = useState(true);

  useEffect(() => {
    let current = true;
    api<GraphData>("graph")
      .then((data): View["source"] | GraphData => (data.people.length + data.projects.length > 0 ? data : "empty"))
      .catch((): View["source"] => "failed")
      .then((result) => {
        if (!current) return;
        // With nothing to show, the scene still needs a shape: draw the sample, and say so below.
        const data = typeof result === "string" ? sampleGraph() : result;
        setView({ data, graph: buildGraph(data), source: typeof result === "string" ? result : "indexed" });
      });
    return () => { current = false; };
  }, []);

  const indexed = view?.source === "indexed";
  return (
    <div ref={stage} className="relative">
      {/* The scene stays pinned while the hero and the graph section scroll over it. */}
      <div className="sticky top-0 h-svh overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_40%,color-mix(in_oklab,var(--color-accent)_10%,transparent),transparent)]" />
        {view && drawable && (
          <GraphCanvas
            graph={view.graph} interactive={indexed} stage={stage}
            onOpen={(person) => router.push(`/person/${person.id}`)} onUnsupported={() => setDrawable(false)}
          />
        )}
      </div>

      <div className="relative -mt-[100svh]">
        <section className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-6xl flex-col px-4 pb-6 pt-10 sm:px-6 md:justify-center md:pt-0">
          <div className="max-w-xl">
            <p className="label enter text-accent" style={stagger(0)}>Graph search for staffing</p>
            <h1 className="enter mt-4 text-[clamp(2.25rem,6vw,4rem)]" style={stagger(1)}>Find who should staff it, and why.</h1>
            <p className="enter mt-5 text-lg text-muted" style={stagger(2)}>
              SkillPool reads resumes and project documents into a graph of people, projects and skills, then
              answers staffing questions with named candidates and the passages that back each one.
            </p>
            <div className="enter mt-8 flex flex-wrap gap-3" style={stagger(3)}>
              <Link className="btn" href="/search">Search people</Link>
              <Link className="btn btn-secondary" href="/upload">Add documents</Link>
            </div>
          </div>
          <p className="label mt-auto pt-10 md:absolute md:bottom-8 md:mt-0">Scroll to explore the graph ↓</p>
        </section>

        <section className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 py-8 sm:px-6" aria-labelledby="graph-title">
          <div className="max-w-md">
            <h2 id="graph-title" className="label text-accent">The graph behind the answers</h2>
            {view && (
              <p className="mt-3 font-mono text-sm">
                {indexed
                  ? `${view.data.people.length} people · ${view.data.projects.length} projects · ${view.data.skills.length} skills`
                  : view.source === "empty" ? "Nothing is indexed yet" : "The graph could not be loaded"}
              </p>
            )}
            <p className="mt-2 text-sm text-muted">
              {!view ? "Loading the graph…"
                : !indexed ? <>The shape shown here is a placeholder. <Link href="/upload">Add documents</Link> to see the real graph.</>
                : drawable ? "Every answer walks these links: a person worked on a project, and the project used a skill. Point at a node to trace its links. Click a person to open their page."
                : "This browser cannot draw the 3D graph, so here it is as a list."}
            </p>
            <ul className="mt-4 flex gap-4 font-mono text-xs text-muted" aria-label="Legend">
              <li className="flex items-center gap-1.5"><Glyph kind="person" /> Person</li>
              <li className="flex items-center gap-1.5"><Glyph kind="project" /> Project</li>
              <li className="flex items-center gap-1.5"><Glyph kind="skill" /> Skill</li>
            </ul>
          </div>
          {view && indexed && (
            <details className="mt-auto" open={!drawable}>
              <summary className="link inline-block text-sm">Browse the graph as a list</summary>
              <div className="panel mt-3 max-h-[45svh] overflow-auto overscroll-contain p-4">
                <GraphList data={view.data} />
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
