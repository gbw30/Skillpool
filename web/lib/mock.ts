// Server only: stands in for the Python service under `npm run dev:mock`, so the screens can be
// worked on without API keys, Neo4j, a bucket, or an .env file. Canned data; nothing persists.
//
// Search gives the same three people for any question, except questions containing
// "cobol" (no confident match), "error" (the answer fails part-way), or "limit" (rate limited).
// Uploads use the access code "mock"; every fourth file fails.
// The landing page's graph is a made-up sample of projects from across a business (lib/graph.ts).
import { randomUUID } from "node:crypto";
import type { JobStatus, PersonProfile, SearchResults } from "./api";
import { sampleGraph } from "./graph";

// NODE_ENV is fixed at build time, so a production build can never answer from this file.
export const MOCK = process.env.NODE_ENV === "development" && process.env.SKILLPOOL_MOCK === "1";

/** Where the upload page sends files in mock mode; the proxy accepts and drops them. */
export const MOCK_STORAGE = "mock-storage";

const RESULTS: SearchResults = {
  confidence: "ok",
  people: [
    {
      id: "p-brenda-adams",
      name: "Brenda Adams",
      title: "Automation Engineer",
      matchedSkills: [{ name: "Kafka", level: "expert" }, { name: "Kubernetes", level: "intermediate" }],
      paths: ["Brenda Adams → worked on → Atlas Migration → used → Kafka, Kubernetes"],
      links: [{ project: "Atlas Migration", skills: ["Kafka", "Kubernetes"] }],
      evidence: [
        { n: 1, chunkId: "c-1", docId: "d-atlas-status-2", path: "atlas-migration/status-2.md", text: "Brenda Adams, release manager on Atlas Migration, moved the order events from the nightly batch onto Kafka and ran the cutover with no lost messages." },
        { n: 2, chunkId: "c-2", docId: "d-brenda-resume", path: "resumes/Brenda_Adams.pdf", text: "Skills: Python, intermediate, Kafka, expert, Kubernetes, intermediate, Terraform, beginner, English, fluent" },
        { n: 3, chunkId: "c-3", docId: "d-atlas-staffing", path: "atlas-migration/staffing-note.md", text: "Brenda Adams (Automation Engineer) joins Atlas Migration as release manager." },
      ],
    },
    {
      id: "p-amy-vasquez",
      name: "Amy Vasquez",
      title: "Deep Learning Engineer",
      matchedSkills: [],
      paths: [
        "Amy Vasquez → worked on → Beacon Reporting Pipeline → used → Kafka, Spark",
        "Amy Vasquez → worked on → Atlas Migration → used → Kafka, Kubernetes",
      ],
      links: [
        { project: "Beacon Reporting Pipeline", skills: ["Kafka", "Spark"] },
        { project: "Atlas Migration", skills: ["Kafka", "Kubernetes"] },
      ],
      evidence: [
        { n: 4, chunkId: "c-4", docId: "d-beacon-postmortem", path: "beacon-reporting-pipeline/postmortem.md", text: "The reporting pipeline read clickstream events from Kafka into Spark. Amy Vasquez, QA lead, traced the duplicate rows to a consumer that committed offsets before writing." },
        { n: 5, chunkId: "c-5", docId: "d-atlas-status-1", path: "atlas-migration/status-1.md", text: "Amy Vasquez, QA lead on Atlas Migration, finished the access audit." },
      ],
    },
    {
      id: "p-christopher-montgomery-abernathy",
      name: "Christopher Montgomery-Abernathy",
      title: null,
      matchedSkills: [{ name: "Kafka", level: null }],
      paths: [],
      links: [],
      evidence: [
        { n: 6, chunkId: "c-6", docId: "d-christopher-resume", path: "resumes/uploads/2026-batch/Christopher_Montgomery-Abernathy_Senior_Platform_Engineer_final_v3.pdf", text: "Skills: Kafka, Go, PostgreSQL, gRPC, Prometheus, Grafana, Helm, Argo CD, AWS, GCP, Linux, Bash" },
      ],
    },
  ],
};

const ANSWER = [
  "Brenda Adams is the strongest fit, having moved Atlas Migration's order events onto Kafka and listing Kafka at expert level [1][2].",
  "Amy Vasquez worked on two projects that used Kafka and debugged a consumer offset bug, though no passage shows building on it directly [4][5].",
  "Christopher Montgomery-Abernathy lists Kafka on a resume with no level or project behind it [6].",
  "None of the passages show anyone running Kafka in production at scale, so confirm that in an interview.",
];

const NO_MATCH = "Nothing in the indexed documents clearly matches this question, so no one is recommended.";

const PEOPLE: PersonProfile[] = [
  {
    id: "p-brenda-adams",
    name: "Brenda Adams",
    title: "Automation Engineer",
    aliases: ["Brenda Adams", "B. Adams"],
    skills: [
      { name: "Kafka", level: "expert" }, { name: "Python", level: "intermediate" },
      { name: "Kubernetes", level: "intermediate" }, { name: "Terraform", level: "beginner" },
      { name: "Docker", level: null }, { name: "CI/CD", level: null },
    ],
    roles: [
      { org: "King Group", title: "Automation Engineer", start: "2021-03", end: null },
      { org: "Williams and Sons", title: "Build Engineer", start: "2018-06", end: "2021-02" },
    ],
    education: [{ school: "Rose, Henderson and Johnson", degree: "MSc", field: "Computer Science" }],
    projects: [
      {
        id: "pr-atlas", name: "Atlas Migration", scope: "internal", role: "release manager",
        collaborators: [{ id: "p-amy-vasquez", name: "Amy Vasquez" }, { id: "p-christopher-montgomery-abernathy", name: "Christopher Montgomery-Abernathy" }],
      },
    ],
    unconfirmed: [],
    evidence: RESULTS.people[0].evidence,
  },
  {
    id: "p-amy-vasquez",
    name: "Amy Vasquez",
    title: "Deep Learning Engineer",
    aliases: ["Amy Vasquez", "Vasquez, Amy"],
    skills: [{ name: "PyTorch", level: "expert" }, { name: "Spark", level: "intermediate" }, { name: "SQL", level: null }],
    roles: [{ org: "Halvorsen Consulting", title: "Deep Learning Engineer", start: "2020-01", end: "2024-09" }],
    education: [],
    projects: [
      { id: "pr-beacon", name: "Beacon Reporting Pipeline", scope: "internal", role: "QA lead", collaborators: [] },
      { id: "pr-atlas", name: "Atlas Migration", scope: "internal", role: "QA lead", collaborators: [{ id: "p-brenda-adams", name: "Brenda Adams" }] },
    ],
    unconfirmed: [{ docId: "d-vendor-memo", path: "_misc/vendor-memo.md", surface: "Amy Vasquez" }],
    evidence: RESULTS.people[1].evidence,
  },
  {
    id: "p-christopher-montgomery-abernathy",
    name: "Christopher Montgomery-Abernathy",
    title: null,
    aliases: null,
    skills: [{ name: "Kafka", level: null }, { name: "Go", level: null }, { name: "PostgreSQL", level: null }],
    roles: [],
    education: [],
    projects: [{ id: "pr-atlas", name: "Atlas Migration", scope: "internal", role: null, collaborators: [{ id: "p-brenda-adams", name: "Brenda Adams" }] }],
    unconfirmed: [],
    evidence: RESULTS.people[2].evidence,
  },
  {
    // A different person with the same name: shows every empty state.
    id: "p-amy-vasquez-2",
    name: "Amy Vasquez",
    title: null,
    aliases: null,
    skills: [],
    roles: [],
    education: [],
    projects: [],
    unconfirmed: [],
    evidence: [],
  },
];

const GRAPH = sampleGraph();

/** A page for someone who exists only in the sample graph, built from their links in it. */
function sampleProfile(id: string): PersonProfile | undefined {
  const person = GRAPH.people.find((p) => p.id === id);
  if (!person) return undefined;
  const named = (list: { id: string; name: string }[], key: string) => list.find((x) => x.id === key)?.name ?? key;
  return {
    id, name: person.name, title: null, aliases: null, roles: [], education: [], unconfirmed: [], evidence: [],
    skills: GRAPH.has.filter(([p]) => p === id).map(([, skill]) => ({ name: named(GRAPH.skills, skill), level: null })),
    projects: GRAPH.workedOn.filter(([p]) => p === id).map(([, project]) => ({
      id: project, name: named(GRAPH.projects, project), scope: "org", role: null,
      collaborators: GRAPH.workedOn.filter(([p, other]) => other === project && p !== id).map(([p]) => ({ id: p, name: named(GRAPH.people, p) })),
    })),
  };
}

// Upload batches, by job id. Lost when the dev server restarts.
const jobs = new Map<string, { paths: string[]; started?: number }>();
const FAILURES = ["no_text", "unreadable_pdf", "type_mismatch"];

/** Each file waits its turn, processes for 1.5 s, then is searchable; every fourth one fails. */
function jobStatus(jobId: string): JobStatus {
  const batch = jobs.get(jobId);
  const elapsed = batch?.started ? Date.now() - batch.started : -1;
  const documents = (batch?.started ? batch.paths : []).map((path, i) => {
    const t = elapsed - i * 700;
    const failed = i % 4 === 3;
    const status = t < 0 ? "queued" : t < 1500 ? "processing" : failed ? "failed" : "ingested";
    return { id: status === "queued" ? null : `d-mock-${i}`, path, status, error: status === "failed" ? FAILURES[i % 3] : null };
  });
  const counts: Record<string, number> = {};
  for (const d of documents) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const running = documents.some((d) => d.status === "queued" || d.status === "processing");
  return { jobId, running, counts, documents };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

/** The same event stream the service sends, at about the pace it sends it. */
async function* searchEvents(q: string) {
  await sleep(800);
  if (/cobol/i.test(q)) {
    yield event("results", { confidence: "none", people: [] });
    yield event("answer", { text: NO_MATCH });
  } else {
    yield event("results", RESULTS);
    for (const [i, sentence] of ANSWER.entries()) {
      await sleep(500);
      if (i === 1 && /error/i.test(q)) {
        yield event("error", { code: "internal_error", message: "Search failed. Try again." });
        return;
      }
      yield event("answer", { text: sentence + " " });
    }
  }
  yield event("done", {});
}

function stream(events: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** Answers a signed service call (same method, path, and body) from the canned data above. */
export async function mockService(method: string, path: string, body: string): Promise<Response> {
  let input: Record<string, unknown> = {};
  try {
    input = body ? JSON.parse(body) : {};
  } catch {
    return fail(400, "invalid_request", "Body is not JSON.");
  }
  const id = path.split("/")[2];

  if (path === "/search") {
    const q = String(input.q ?? "");
    if (/limit/i.test(q)) return fail(429, "rate_limited", "Too many searches. Try again in a minute.");
    return stream(searchEvents(q));
  }
  if (path.startsWith("/person/")) {
    const person = PEOPLE.find((p) => p.id === id) ?? sampleProfile(id);
    return person ? Response.json(person) : fail(404, "not_found", "No such person.");
  }
  if (path === "/graph") return Response.json(GRAPH);
  if (path === "/upload/session") {
    const files = (input.files ?? []) as { path: string }[];
    const jobId = randomUUID().replaceAll("-", "");
    jobs.set(jobId, { paths: files.map((f) => f.path) });
    const uploads = files.map((f, index) => ({ index, path: f.path, url: `/api/${MOCK_STORAGE}`, fields: { key: `jobs/${jobId}/${index}` } }));
    return Response.json({ jobId, expiresIn: 900, uploads });
  }
  if (path === "/ingest") {
    const batch = jobs.get(String(input.jobId));
    if (!batch) return fail(400, "nothing_uploaded", "No uploaded files were found for this batch.");
    batch.started = Date.now();
    return Response.json({ jobId: input.jobId, accepted: batch.paths.length }, { status: 202 });
  }
  if (path.startsWith("/jobs/")) return Response.json(jobStatus(id));
  // Includes "Open source": there are no stored files to open.
  return fail(404, "not_found", `Not available in mock mode (${method} ${path}).`);
}
