// The graph on a result card: the person, the projects they worked on, and the skills those
// projects used or the person lists. Labels are HTML so they stay readable at any width; the
// links are an SVG stretched behind them.
import type { CSSProperties, ReactNode } from "react";
import type { PersonResult } from "@/lib/api";

const ROW = 44; // px per row
const MAX_SKILLS = 6;
// Column edges, in % of the width. Links run through the gaps between columns.
const PERSON_END = 25, MIDDLE_START = 33, MIDDLE_END = 62, SKILL_START = 70;

type Kind = "person" | "project" | "skill";
const SHAPES: Record<Kind, { color: string; shape: ReactNode }> = {
  person: { color: "text-person", shape: <circle cx="5" cy="5" r="4" /> },
  project: { color: "text-project", shape: <path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" /> },
  skill: { color: "text-skill", shape: <rect x="1" y="1" width="8" height="8" rx="1" /> },
};

/** The small shape that marks a kind of node: circle, diamond or square. */
export function Glyph({ kind }: { kind: Kind }) {
  return <svg className={`size-2 shrink-0 ${SHAPES[kind].color}`} viewBox="0 0 10 10" fill="currentColor" aria-hidden>{SHAPES[kind].shape}</svg>;
}

const at = (left: number, right: number, y: number): CSSProperties => ({ left: `${left}%`, width: `${right - left}%`, top: y });

function Node({ kind, style, name, note }: { kind: Kind; style: CSSProperties; name: string; note?: string | null }) {
  return (
    <div
      style={style} title={note ? `${name} · ${note}` : name}
      className="absolute flex -translate-y-1/2 items-center gap-1.5 rounded-[2px] border border-line bg-surface px-1.5 py-1 text-[11px] leading-tight sm:px-2 sm:text-xs"
    >
      <Glyph kind={kind} />
      <span className="line-clamp-2 min-w-0 wrap-anywhere">
        {name}{note && <span className="block text-muted">{note}</span>}
      </span>
    </div>
  );
}

const curve = (x0: number, y0: number, x1: number, y1: number) => {
  const mid = (x0 + x1) / 2;
  return `M${x0} ${y0}C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`;
};

type Props = { name: string; links: PersonResult["links"]; matched: PersonResult["matchedSkills"] };

export function PathGraph({ name, links, matched }: Props) {
  if (links.length === 0 && matched.length === 0) return null;

  const levels = new Map(matched.map((m) => [m.name, m.level]));
  const every = [...new Set([...links.flatMap((l) => l.skills), ...levels.keys()])];
  const skills = every.slice(0, MAX_SKILLS);
  const more = every.length - skills.length;

  // Middle column: a row per project, then a lane for skills the person lists directly.
  const middle = links.length + (levels.size ? 1 : 0);
  const right = skills.length + (more ? 1 : 0);
  const rows = Math.max(middle, right);
  const height = rows * ROW;
  // The centre of row i in a column of `count` rows, with the column centred in the graph.
  const y = (count: number, i: number) => ((rows - count) / 2 + i + 0.5) * ROW;
  const personY = height / 2;
  const laneY = y(middle, links.length);
  const skillY = (skill: string) => y(right, skills.indexOf(skill));

  const worked = links.map((_, i) => curve(PERSON_END, personY, MIDDLE_START, y(middle, i)));
  const used = links.flatMap((link, i) =>
    link.skills.filter((s) => skills.includes(s)).map((s) => curve(MIDDLE_END, y(middle, i), SKILL_START, skillY(s))));
  const listed = levels.size
    ? [`${curve(PERSON_END, personY, MIDDLE_START, laneY)}H${MIDDLE_END}`,
       ...skills.filter((s) => levels.has(s)).map((s) => curve(MIDDLE_END, laneY, SKILL_START, skillY(s)))]
    : [];

  const summary = [
    ...links.map((l) => `${name} worked on ${l.project}${l.skills.length ? `, which used ${l.skills.join(", ")}` : ""}.`),
    ...matched.map((m) => `${name} lists ${m.name}${m.level ? ` at ${m.level} level` : ""}.`),
  ].join(" ");

  return (
    <div role="img" aria-label={summary} className="mt-4 max-w-xl">
      <div className="label relative mb-1 h-4">
        <span className="absolute" style={{ left: 0 }}>Person</span>
        {links.length > 0 && <span className="absolute" style={{ left: `${MIDDLE_START}%` }}>Worked on</span>}
        <span className="absolute" style={{ left: `${SKILL_START}%` }}>Skills</span>
      </div>
      <div className="relative" style={{ height }}>
        <svg className="absolute inset-0 size-full text-edge" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.25} aria-hidden>
          {[...worked, ...used].map((d) => <path key={d} d={d} vectorEffect="non-scaling-stroke" />)}
          {listed.map((d) => <path key={d} d={d} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />)}
        </svg>
        <Node kind="person" style={at(0, PERSON_END, personY)} name={name} />
        {links.map((link, i) => <Node key={link.project} kind="project" style={at(MIDDLE_START, MIDDLE_END, y(middle, i))} name={link.project} />)}
        {levels.size > 0 && (
          <div className="label absolute -translate-y-1/2 text-center" style={at(MIDDLE_START, MIDDLE_END, laneY)}>
            <span className="bg-bg px-1.5">lists</span>
          </div>
        )}
        {skills.map((skill) => <Node key={skill} kind="skill" style={at(SKILL_START, 100, skillY(skill))} name={skill} note={levels.get(skill)} />)}
        {more > 0 && <div className="absolute -translate-y-1/2 text-xs text-muted" style={at(SKILL_START, 100, y(right, skills.length))}>+{more} more</div>}
      </div>
    </div>
  );
}
