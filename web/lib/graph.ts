// The landing page's graph: turns the service's rows into nodes and links, lays them out in 3D,
// and makes a sample for mock mode and for a database with nothing in it.
import type { GraphData } from "./api";

export type Kind = "person" | "project" | "skill";
export type GraphNode = { id: string; kind: Kind; name: string; neighbours: number[] };
export type Graph = { nodes: GraphNode[]; links: [number, number][] };

export function buildGraph(data: GraphData): Graph {
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  const add = (kind: Kind, list: { id: string; name: string }[]) => {
    for (const { id, name } of list) {
      index.set(`${kind}:${id}`, nodes.length);
      nodes.push({ id, kind, name, neighbours: [] });
    }
  };
  add("person", data.people);
  add("project", data.projects);
  add("skill", data.skills);

  const links: [number, number][] = [];
  const join = (from: Kind, to: Kind, pairs: [string, string][]) => {
    for (const [a, b] of pairs) {
      const i = index.get(`${from}:${a}`), j = index.get(`${to}:${b}`);
      if (i === undefined || j === undefined) continue; // the other end was cut off by the service's limit
      links.push([i, j]);
      nodes[i].neighbours.push(j);
      nodes[j].neighbours.push(i);
    }
  };
  join("person", "project", data.workedOn);
  join("project", "skill", data.used);
  join("person", "skill", data.has);
  return { nodes, links };
}

/** A repeatable random source (mulberry32), so the layout and the sample never change between loads. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every node ends up within this distance of the origin. */
export const RADIUS = 10;
const TICKS = 300;
const REST = 30; // the length a link pulls towards, before the result is scaled to RADIUS

/**
 * Force-directed layout in 3D: nodes repel, links pull, everything leans to the centre.
 * Call step() until it returns true, then read `positions` (x, y, z per node).
 * shortcut: every pair of nodes is compared on every tick, fine up to about a thousand nodes;
 * past that, group distant nodes (Barnes-Hut) or lower the service's limit.
 */
export function createLayout(graph: Graph) {
  const n = graph.nodes.length;
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  const rand = random(7);
  for (let i = 0; i < pos.length; i++) pos[i] = (rand() - 0.5) * REST * 4;
  const degree = graph.nodes.map((node) => Math.max(node.neighbours.length, 1));
  let tick = 0;

  function step(): boolean {
    if (tick >= TICKS) return true;
    const alpha = 1 - tick / TICKS; // forces fade out, so the layout settles
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const push = (REST * alpha) / Math.max(dx * dx + dy * dy + dz * dz, 1);
        vel[i * 3] -= dx * push; vel[i * 3 + 1] -= dy * push; vel[i * 3 + 2] -= dz * push;
        vel[j * 3] += dx * push; vel[j * 3 + 1] += dy * push; vel[j * 3 + 2] += dz * push;
      }
    }
    for (const [i, j] of graph.links) {
      const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      // A link between two busy nodes pulls less, and the busier end moves less.
      const pull = ((length - REST) / length) * alpha / Math.min(degree[i], degree[j]);
      const share = degree[i] / (degree[i] + degree[j]);
      vel[i * 3] += dx * pull * (1 - share); vel[i * 3 + 1] += dy * pull * (1 - share); vel[i * 3 + 2] += dz * pull * (1 - share);
      vel[j * 3] -= dx * pull * share; vel[j * 3 + 1] -= dy * pull * share; vel[j * 3 + 2] -= dz * pull * share;
    }
    for (let k = 0; k < pos.length; k++) {
      vel[k] = (vel[k] - pos[k] * 0.02 * alpha) * 0.6;
      pos[k] += vel[k];
    }
    if (++tick < TICKS) return false;

    // Centre the result and scale it to RADIUS; a stray far-out node is pulled onto the edge.
    const mean = [0, 0, 0];
    for (let k = 0; k < pos.length; k++) mean[k % 3] += pos[k] / Math.max(n, 1);
    let spread = 0;
    for (let k = 0; k < pos.length; k++) {
      pos[k] -= mean[k % 3];
      spread += pos[k] * pos[k];
    }
    const scale = (RADIUS * 0.62) / (Math.sqrt(spread / Math.max(n, 1)) || 1);
    for (let i = 0; i < n; i++) {
      const far = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) * scale;
      const fit = far > RADIUS ? (scale * RADIUS) / far : scale;
      pos[i * 3] *= fit; pos[i * 3 + 1] *= fit; pos[i * 3 + 2] *= fit;
    }
    return true;
  }

  return { positions: pos, step };
}

const FIRST = ["Aaron", "Alexandra", "April", "Brian", "Carla", "Daniel", "Elena", "Farid", "Grace", "Hector",
  "Ines", "Jamal", "Keiko", "Liam", "Maya", "Noah", "Omar", "Priya", "Quinn", "Rosa"];
const LAST = ["Brown", "Johnson", "Burgess", "White", "Nguyen", "Okafor", "Petrov", "Silva",
  "Tanaka", "Walker", "Young", "Zhang", "Edwards", "Erickson", "Koch", "Rubio"];
const PROJECTS = ["Atlas Migration", "Beacon Reporting Pipeline", "Borealis Partner API", "Cinder Billing Rewrite",
  "Cobalt Billing Rewrite", "Delta Observability Rollout", "Dynamo Checkout Redesign", "Echo Billing Rewrite",
  "Ember Partner API", "Falcon Migration", "Fathom Partner API", "Anchor Checkout Redesign"];
const SKILLS = ["Kafka", "Kubernetes", "Spark", "Python", "Go", "PostgreSQL", "Redis", "Terraform", "Docker", "GraphQL",
  "React", "TypeScript", "Java", "AWS", "Airflow", "dbt", "Prometheus", "Grafana", "gRPC", "Rust", "Android", "Swift",
  "PyTorch", "Snowflake"];

/**
 * A made-up graph in the shape the service returns: 48 people, 12 projects, 24 skills.
 * The first two people match the mock search results, so their pages open in mock mode.
 */
export function sampleGraph(): GraphData {
  const rand = random(11);
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const people = [
    { id: "p-brenda-adams", name: "Brenda Adams" },
    { id: "p-amy-vasquez", name: "Amy Vasquez" },
    ...Array.from({ length: 46 }, (_, i) => ({
      id: `p-sample-${i}`,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`,
    })),
  ];
  const projects = PROJECTS.map((name) => ({ id: slug(name), name }));
  const skills = SKILLS.map((name) => ({ id: slug(name), name }));

  const seen = new Set<string>();
  const pairs = () => {
    const list: [string, string][] = [];
    return { list, add: (a: string, b: string) => { if (!seen.has(`${a}>${b}`)) { seen.add(`${a}>${b}`); list.push([a, b]); } } };
  };
  const workedOn = pairs(), used = pairs(), has = pairs();
  const any = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  workedOn.add("p-brenda-adams", "atlas-migration");
  workedOn.add("p-amy-vasquez", "beacon-reporting-pipeline");
  workedOn.add("p-amy-vasquez", "atlas-migration");
  for (const skill of ["kafka", "kubernetes"]) { used.add("atlas-migration", skill); has.add("p-brenda-adams", skill); }
  for (const skill of ["kafka", "spark"]) used.add("beacon-reporting-pipeline", skill);

  for (const project of projects) {
    for (let k = 3 + Math.floor(rand() * 4); k > 0; k--) workedOn.add(any(people.slice(2)).id, project.id);
    for (let k = 2 + Math.floor(rand() * 3); k > 0; k--) used.add(project.id, any(skills).id);
  }
  for (const person of people.slice(2)) {
    // The service only returns people who are on a project.
    if (!workedOn.list.some(([p]) => p === person.id)) workedOn.add(person.id, any(projects).id);
    for (let k = 2 + Math.floor(rand() * 2); k > 0; k--) has.add(person.id, any(skills).id);
  }
  return { people, projects, skills, workedOn: workedOn.list, used: used.list, has: has.list };
}
