"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Minus, Plus } from "@/components/icons";
import { Glyph } from "@/components/path-graph";
import { api, type GraphData } from "@/lib/api";
import { buildGraph, sampleGraph, type Graph, type Kind } from "@/lib/graph";
import type { GraphControls } from "./graph-canvas";

// three.js is large and only this page draws with it, so it loads on its own, in the browser.
const GraphCanvas = dynamic(() => import("./graph-canvas").then((module) => module.GraphCanvas), { ssr: false });

type View = { data: GraphData; graph: Graph; source: "indexed" | "empty" | "failed" };
/** One real path through the graph, shown in the hero: a skill, a project that used it, someone on that project. */
type Example = { skill: string; project: string; person: { id: string; name: string }; path: number[] };

// Shown when nothing is indexed: tools from different parts of a business, as examples of what can be asked.
const FALLBACK_SKILLS = ["Salesforce", "Kafka", "SAP", "Figma", "Tableau", "Workday", "HubSpot", "AutoCAD"];
const SPRING = { type: "spring", duration: 0.6, bounce: 0.2 } as const;

/** Up to eight examples, each with a different skill and person, starting with the most used skills. */
function examples({ data, graph }: View): Example[] {
  const at = (kind: Kind, id: string) => graph.nodes.findIndex((node) => node.kind === kind && node.id === id);
  const uses = new Map<string, number>();
  for (const [, skill] of data.used) uses.set(skill, (uses.get(skill) ?? 0) + 1);
  const found: Example[] = [], shown = new Set<string>();
  for (const skill of [...data.skills].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0))) {
    for (const [projectId, skillId] of data.used) {
      if (skillId !== skill.id) continue;
      const personId = data.workedOn.find(([who, where]) => where === projectId && !shown.has(who))?.[0];
      const person = data.people.find((p) => p.id === personId), project = data.projects.find((p) => p.id === projectId);
      if (!person || !project) continue;
      shown.add(person.id);
      // The light starts at the skill that was asked about and ends on the person.
      found.push({ skill: skill.name, project: project.name, person, path: [at("skill", skill.id), at("project", project.id), at("person", person.id)] });
      break;
    }
    if (found.length === 8) break;
  }
  return found;
}

/** The same graph as text: each project with its people and skills. For keyboards, screen readers, and browsers without WebGL. */
function GraphList({ data }: { data: GraphData }) {
  const name = (list: { id: string; name: string }[], id: string) => list.find((item) => item.id === id)?.name ?? id;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

/** The skill in the headline. Each letter springs up into place when the word changes. */
function Word({ text }: { text: string }) {
  const still = useReducedMotion();
  let letter = 0;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {/* A long name is set smaller, so every skill takes one line and the page below never jumps. */}
      <motion.span
        key={text} className="inline-block whitespace-nowrap" exit={{ opacity: 0, transition: { duration: 0.14 } }}
        style={{ fontSize: `${Math.min(1, 11 / text.length)}em` }}
      >
        {text.split(" ").map((word, w) => (
          <span key={w} className="inline-block whitespace-nowrap">
            {[...word].map((char, i) => (
              <motion.span
                key={i} className="inline-block"
                initial={still ? { opacity: 0 } : { opacity: 0, transform: "translateY(0.35em)", filter: "blur(8px)" }}
                animate={still ? { opacity: 1 } : { opacity: 1, transform: "translateY(0em)", filter: "blur(0px)" }}
                transition={{ ...SPRING, delay: letter++ * 0.035 }}
              >
                {char}
              </motion.span>
            ))}
            {" "}
          </span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}

export function Landing() {
  const stage = useRef<HTMLDivElement>(null);
  const graphControls = useRef<GraphControls | null>(null);
  const router = useRouter();
  const still = useReducedMotion();
  const [view, setView] = useState<View | null>(null);
  const [drawable, setDrawable] = useState(true);
  const [turn, setTurn] = useState(0);
  const [question, setQuestion] = useState("");
  const [typing, setTyping] = useState(false);

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
  const shown = useMemo(() => (view && indexed ? examples(view) : []), [view, indexed]);
  const example = shown.length ? shown[turn % shown.length] : null;
  const skill = example?.skill ?? FALLBACK_SKILLS[turn % FALLBACK_SKILLS.length];
  const asking = (about: string) => `Who has hands-on experience with ${about}?`;
  const ask = asking(skill);
  // More to try: a spread of the other indexed skills, or the examples when nothing is indexed.
  const others = useMemo(() => {
    if (!view || !indexed) return FALLBACK_SKILLS.slice(2);
    const rest = view.data.skills.map((s) => s.name).filter((name) => !shown.some((example) => example.skill === name));
    return Array.from({ length: Math.min(6, rest.length) }, (_, i) => rest[Math.floor((i * rest.length) / Math.min(6, rest.length))]);
  }, [view, indexed, shown]);

  // Move to the next example every few seconds, unless the visitor is typing or wants no motion.
  useEffect(() => {
    if (still || typing) return;
    const timer = setInterval(() => !document.hidden && setTurn((n) => n + 1), 9000);
    return () => clearInterval(timer);
  }, [still, typing]);

  function submit(event: FormEvent) {
    event.preventDefault();
    router.push(`/search?q=${encodeURIComponent(question.trim() || ask)}`);
  }

  const rise = (order: number) => ({
    initial: still ? { opacity: 0 } : { opacity: 0, transform: "translateY(18px)" },
    animate: still ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" },
    transition: { ...SPRING, bounce: 0.1, delay: 0.08 * order },
  });

  return (
    <div ref={stage} className="relative">
      {/* The scene stays pinned while the hero and the graph section scroll over it. */}
      <div className="sticky top-0 h-svh overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(55%_55%_at_72%_42%,color-mix(in_oklab,var(--color-accent)_7%,transparent),transparent)]" />
        {view && drawable && (
          <GraphCanvas
            graph={view.graph} interactive={indexed} stage={stage} trace={example?.path ?? null} controlsRef={graphControls}
            onOpen={(person) => router.push(`/person/${person.id}`)} onUnsupported={() => setDrawable(false)}
          />
        )}
      </div>

      <div className="relative -mt-[100svh]">
        <section className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-6xl flex-col px-4 pb-16 pt-8 sm:px-6 lg:justify-center lg:pt-0">
          {/* Beside the brain on a wide screen, over it on a narrow one. Type sizes follow this column's width. */}
          <div className="@container max-w-2xl lg:max-w-[54%]">
            <motion.p {...rise(0)} className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
              <span className="flex items-center gap-2 text-ink">
                <span className={`size-1.5 rounded-full ${indexed ? "pulse bg-accent" : "bg-edge"}`} />
                {!view ? "Reading the index" : indexed ? "Indexed" : view.source === "empty" ? "Nothing indexed yet" : "Index unreachable"}
              </span>
              {view && indexed && (
                <>
                  <span className="flex items-center gap-1.5"><Glyph kind="person" /> {view.data.people.length} people</span>
                  <span className="flex items-center gap-1.5"><Glyph kind="project" /> {view.data.projects.length} projects</span>
                  <span className="flex items-center gap-1.5"><Glyph kind="skill" /> {view.data.skills.length} skills</span>
                </>
              )}
            </motion.p>

            {/* The headline is the question the product answers, asked about a real skill from the index. */}
            <motion.h1 {...rise(1)} aria-label="Who here has used the skill you need?" className="mt-6 text-[clamp(2.5rem,min(15cqw,13svh),6.5rem)] leading-[0.94] tracking-[-0.045em]">
              <span aria-hidden className="block font-light text-ink/80">Who here</span>
              <span aria-hidden className="block font-light text-ink/80">has used</span>
              <span aria-hidden className="block min-h-[0.94em] font-semibold text-accent"><Word text={`${skill}?`} /></span>
            </motion.h1>

            {/* The answer, read off the graph: someone on a project that used the skill. */}
            <div className="mt-6 min-h-16 sm:min-h-9">
              <AnimatePresence mode="wait" initial={false}>
                {example && (
                  <motion.p
                    key={example.skill} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-sm text-muted"
                    initial={still ? { opacity: 0 } : { opacity: 0, transform: "translateY(10px)" }}
                    animate={still ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ ...SPRING, delay: 2.2 }}
                  >
                    <span aria-hidden>↳</span>
                    <Link className="chip" href={`/person/${example.person.id}`}><Glyph kind="person" /> {example.person.name}</Link>
                    worked on
                    <span className="chip"><Glyph kind="project" /> {example.project}</span>
                    which used
                    <span className="chip"><Glyph kind="skill" /> {example.skill}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <motion.form {...rise(2)} className="mt-8 flex max-w-xl gap-2" onSubmit={submit}>
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-accent" aria-hidden>&gt;</span>
                <input
                  className="input h-12 bg-surface/80 pl-9 backdrop-blur-sm" type="text" maxLength={500} autoComplete="off"
                  aria-label="Ask a staffing question" placeholder={ask} value={question}
                  onChange={(event) => setQuestion(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
                />
              </div>
              <button className="btn h-12 px-6" type="submit">Ask</button>
            </motion.form>

            <motion.p {...rise(3)} className="mt-3 flex max-w-xl flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-xs text-muted">
              Or ask about
              {others.map((name) => <Link key={name} className="chip" href={`/search?q=${encodeURIComponent(asking(name))}`}>{name}</Link>)}
            </motion.p>

            <motion.p {...rise(4)} className="mt-6 max-w-md text-sm text-muted">
              SkillPool reads resumes and project reports into one graph. Ask in plain words and it answers with
              names, and quotes the lines that back each one. <Link href="/upload">Add documents</Link>
            </motion.p>
          </div>
          {/* The cue to scroll: a track with a bead sliding down it. Also a link to the graph. */}
          <a href="#graph-title" aria-label="Go to the graph" className="scroll-cue absolute bottom-4 left-1/2 -translate-x-1/2 max-sm:hidden" />
        </section>

        <section className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 py-8 sm:px-6" aria-labelledby="graph-title">
          {/* A soft panel behind the text, so it stays readable when the graph is zoomed in underneath it. */}
          <div className="-m-3 max-w-md rounded-[10px] bg-bg/65 p-3 backdrop-blur-[3px]">
            <h2 id="graph-title" className="label text-accent">The graph behind the answers</h2>
            {view && indexed && (
              <dl className="mt-4 flex gap-6 font-mono">
                {([["person", "people", view.data.people.length], ["project", "projects", view.data.projects.length], ["skill", "skills", view.data.skills.length]] as const).map(([kind, name, count]) => (
                  <div key={kind}>
                    <dd className="text-3xl font-medium tabular-nums tracking-tight">{count}</dd>
                    <dt className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Glyph kind={kind} /> {name}</dt>
                  </div>
                ))}
              </dl>
            )}
            {view && !indexed && <p className="mt-3 font-mono text-sm">{view.source === "empty" ? "Nothing is indexed yet" : "The graph could not be loaded"}</p>}
            <p className="mt-4 text-sm text-muted">
              {!view ? "Loading the graph…"
                : !indexed ? <>The shape shown here is a placeholder. <Link href="/upload">Add documents</Link> to see the real graph.</>
                : drawable ? "Every answer walks these links: a person worked on a project, and the project used a skill. Point at a node to trace its links, and click a person to open their page. Drag to move around."
                : "This browser cannot draw the 3D graph, so here it is as a list."}
            </p>
          </div>
          {view && indexed && (
            <div className="mt-auto flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <details className="min-w-0 flex-1 basis-64" open={!drawable}>
                <summary className="link inline-block text-sm">Browse the graph as a list</summary>
                <div className="panel mt-3 max-h-[45svh] overflow-auto overscroll-contain p-4">
                  <GraphList data={view.data} />
                </div>
              </details>
              {drawable && (
                <div className="flex items-center gap-3">
                  <p className="label max-lg:hidden">Ctrl + scroll to zoom · Shift + drag to turn</p>
                  <div role="group" aria-label="Graph zoom" className="flex items-center rounded-md border border-line bg-surface/85 p-0.5 backdrop-blur-sm">
                    <button type="button" aria-label="Zoom out" title="Zoom out" className="grid size-9 cursor-pointer place-items-center rounded text-muted hover:bg-raised hover:text-ink" onClick={() => graphControls.current?.zoomBy(1 / 1.6)}><Minus /></button>
                    <button type="button" aria-label="Zoom in" title="Zoom in" className="grid size-9 cursor-pointer place-items-center rounded text-muted hover:bg-raised hover:text-ink" onClick={() => graphControls.current?.zoomBy(1.6)}><Plus /></button>
                    <button type="button" className="h-9 cursor-pointer rounded px-2.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink" onClick={() => graphControls.current?.reset()}>Reset</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
