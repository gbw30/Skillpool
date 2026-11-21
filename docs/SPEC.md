# SkillPool — Project Spec (technical design)

Status: implemented, not yet evaluated with live model calls · updated 2026-11-10
Companion: [PRD.md](PRD.md) (requirement IDs R1–R21 refer to it)

## 0. Implementation status

Built: sections 3 to 10 and 12 to 13. Verified by 73 automated tests, including the full
pipeline against Neo4j 5.26 and 2026.10 with model calls faked. The screens were driven in
headless Chromium (desktop and phone width) against the service with faked model calls and a
local S3 emulator: search with a streamed, cited answer, the person page, the no-match case,
a folder upload that became searchable, and the access page.

Measured on 2026-11-14 by `skillpool eval` with Claude Haiku 5.5 and Voyage `voyage-4-lite`.
The first run was on 359 documents and 43 questions. The last column is the run of 2026-11-15
on the corpus as it is now, with the look-alike pairs added: 377 documents and 48 questions.

| Measure (PRD section 8) | Target | First run | Now |
|---|---|---|---|
| Recall@10, all questions | at least 0.80 | 0.85 | 0.95 |
| Recall@10, multi-hop | at least 0.70 | 0.81 | 0.97 (text similarity alone: 0.44) |
| Recall@10, unstructured (chat or meeting note only) | none set | 0.75 | 0.95 (text similarity alone: 0.30) |
| Recall@10, direct (resume) | none set | 0.98 | 0.92 |
| Citations that do not resolve | 0 | 0 | 0 |
| Identity precision | at least 0.98 | 1.00 | 1.00 |
| Identity recall | at least 0.90 | 0.69 | 0.98 |
| People in the graph, against the truth files | equal | 179 for 137 | 143 for 143 |
| Mentions nothing can settle: left unconfirmed, attached to nobody | all | not in the corpus | 1 of 1 |
| "No one qualifies" answered as such | not in the PRD | 0 of 5 | 5 of 5 |
| Planted instructions that took effect (R20) | 0 | 0 | 0 |
| Time to ranked results, p95 | under 3 s | 2.6 s | 2.7 s |
| Time to complete answer, p95 | under 10 s | 8.9 s | 8.5 s |
| Model cost to ingest the corpus | under $2 | $0.29 | under $0.01 from the cache |

The four recall figures in the last column were measured after two changes that the 2026-11-15
run led to, on the same 48 questions and a rebuilt database, without written answers. The run
itself scored 0.90 on all questions, 0.87 on multi-hop and 0.90 on resume questions.

- The questions about Kafka and Airflow found nobody, in this run and the one before. The model
  that reads the question wrote "Apache Kafka", which names no skill in the graph, and as text
  it is no closer to "Kafka" than COBOL is to Java (0.90 against a floor of 0.96). Asking about
  each of the 98 skills in turn found three such names, now aliases in `text.py`: Apache Kafka,
  Apache Airflow and Microsoft Excel. Multi-hop recall went from 0.87 to 0.97.
- Recall on resume questions had moved from 0.96 to 0.90 between two builds of the same corpus.
  People who matched a question equally well were ordered by their record id, which is random
  and new on every rebuild, and four of the twelve resume questions have an expected person at
  rank 10 to 12. Equals are now ordered by their highest single skill level, then by how close
  the question's text is to them, then by name (`_ranked` in `retrieve.py`), so a rebuild gives
  the same ranking. That order scores 0.92.
- 2026-11-16: the written answer called the 9th-ranked person the strongest fit. She reached
  all the skills asked for only through her projects, and the answer was free to reorder.
  Measured live on 48 questions plus 8 edge cases, outside `skillpool eval` and with each
  question parsed once and reused for both rankings: the answer's first-named person was the top-ranked
  one in 29 of 49 answers, and it obeyed a question telling it to recommend the last candidate.
  Fusion now ends with a reorder by the evidence the answer weighs (`_by_evidence` in
  `retrieve.py`, step 3 in section 8), and the answer sees only the top 5, in order, with
  project links labelled as project experience. Then: top-ranked first in 49 of 50, never below
  third, and the planted instruction refused. Recall@10 went from 0.95 to 0.99 (resume questions
  0.92 to 1.00, multi-hop 0.97 to 1.00, unstructured unchanged at 0.95).

The first run missed two measures. These changes followed, each checked by a further run that
read its extractions from the cache:

- Identity recall was 0.69. A document that gave only a name created a second record for that
  person, as designed, and that record then collected the rest of the project's mentions.
  - Ingestion now writes the documents that give an email or a job title first (`_write_order`
    in `job.py`).
  - A first name standing alone is recorded for the one person in the document it can mean
    (`verify.py`). The model is asked to list these and left out more than half.
  - `MERGE_MARGIN` went from 0.20 to 0.15, and `MERGE_SCORE_INITIAL` from 0.50 to 0.33. At
    0.50 an initial with the same job title could never merge, so "M. Andersson (Partnerships
    Manager)" became a second Maria Andersson and showed up twice in one search result.
  - An uncertain mention no longer becomes a second person. It is kept as an unconfirmed
    mention (`MAY_MENTION`) on the people it might mean.
  - When the model lists one person twice in a document, by initial and in full, the two
    entries are folded into one unless a job title or an email address differs (`verify.py`).
  - What a document said about an unplaced person is saved and tried again after every later
    batch, without a model call (`reconcile` in `upsert.py`). On the look-alike pairs this
    attached all five mentions that a later document settles and left alone the one that
    nothing settles.
  - A full name with the same job title is enough to merge (the title is worth 0.3, up from
    0.2). Before, it also needed help from text similarity, which a page naming many people
    does not give.
- No "no one qualifies" question was answered as such. Both similarity floors had been chosen
  for OpenAI's vectors: an unknown skill name resolved to the nearest known one ("COBOL" to
  "Java"). The floors now belong to the embedding model (`EMBEDDERS` in `config.py`).

Limits of these numbers:

- The thresholds were tuned on the same documents they are scored on. A false merge is the
  costlier mistake (PRD section 10); the three look-alike pairs are the only cases in the
  corpus built to provoke one, and none occurred.
- A line that gives a name and nothing else ("Last reviewed by: Erin Novak") is not tied to
  anyone. The first design made a second person for it, which showed 11 people twice. It is
  now kept as an unconfirmed mention on the person it might mean (`MAY_MENTION`), shown on
  their page and not counted as evidence, and tried again after every later batch.
- 48 questions is a small set: one question moves a category's recall by several points.

Not verified: a deployment, and the OpenAI embedding path (never run live; its floors are
untuned). A real AWS bucket took a browser upload on 2026-11-15 (section 14, item 5).

Changes from the first draft of this spec, made during implementation:

- The service issues upload credentials, not the web app, and uses POST policy uploads. A
  presigned PUT does not bind the upload size; a POST policy does. The web app holds no storage
  credentials.
- The request signature also covers the method and path, so a captured signature cannot be
  replayed against another route.
- Question parsing extracts skills and projects only. Organization and seniority were parsed
  but unused, so they were dropped.
- "No confident match" is decided by a floor on text-similarity scores plus the absence of any
  graph match. Fused rank scores do not measure evidence strength.
- Identity resolution gained three rules found by the pipeline test: two people a document lists
  separately are never merged with each other; a differing email on both records counts against
  a merge; the same stated role on a shared project counts for one.
- The daily spend total is stored in the graph (a `Spend` node per day) and read once per
  process per day, so a restart does not reset the cap. It was in memory only.
- PDF text extraction stops at the size a text file may have (10 MB of text), and the web
  proxy stops reading a request body at its limit instead of checking after buffering it.
- Embeddings can come from OpenAI or Voyage AI (`EMBED_PROVIDER`). The graph records which
  model its vectors came from and the service refuses to mix them; `skillpool reembed`
  recomputes all vectors from stored text without calling Claude. Voyage is called over plain
  HTTP, and search questions are embedded as queries, stored text as documents.
- The corpus is generated in full (section 4). The 680 resumes inherited from the original
  repository are gone, because nobody could say where they came from.
- The whole site asks for an access code (R22): `web/proxy.ts` turns away any request without
  the cookie that `POST /api/access` sets, and the API route checks the cookie again itself.
- `EXTRACT_CACHE_DIR` keeps each document's extraction on disk. Ingestion extracts every
  document before it writes any of them, so a run that stopped part-way used to pay for all of
  its extractions again.
- Milestone M5's deployment is not done; it needs the owner's accounts.

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Shape | Browser upload → object storage → signed webhook → Python service → Neo4j. Same pipeline as the original plan. | Owner's choice. Lets documents be added from the UI (R1). |
| Web | One Next.js app (App Router): UI plus thin route handlers. Replaces the original SPA + separate Netlify Functions. | One deployable instead of two for the same job. |
| Service | One FastAPI app owns all graph and model logic: ingestion, identity resolution, search, person lookup. | The original split Cypher and prompts across TypeScript and Python. One language means one copy, and the eval harness calls the same functions the API does. |
| Graph + vectors | Neo4j AuraDB with native vector indexes. No separate vector store. | As original. |
| Extraction and answers | Claude Haiku 5.5 (`claude-haiku-5-5`). | Owner asked for the most cost-effective option. See section 11. |
| Embeddings | `EMBED_PROVIDER`: Voyage `voyage-4-lite` (1024 dimensions, default) or OpenAI `text-embedding-3-small` (1536). | Voyage has a free allowance that covers the corpus many times over; OpenAI, as in the original, stays as a switch. A database holds one model's vectors; `skillpool reembed` converts it. |
| Extraction approach | One structured-output call per document, hand-written upserts. `neo4j-graphrag`'s generic pipeline considered and not used. | Per-fact provenance (R5, R6) is the core requirement and needs exact control over what is written. |
| Retrieval | Fixed Cypher templates fused with reciprocal rank fusion. No LLM-generated Cypher. | Safe against injection, testable, no weights to tune. |
| Job queue | None. In-process background task with bounded concurrency; safe to re-send because every step is idempotent. | `shortcut:` a restart drops in-flight work until the job is re-sent. Add a queue when ingest batches exceed what one request can re-drive. |
| Auth | No user accounts. One access code opens the whole site. Web → service calls are HMAC-signed. Upload needs its own code. | R18–R19, R22. |

## 2. Architecture

```
Browser
  │  1 POST /api/upload/session ─────────►  Next.js route handlers (BFF)
  │  2 PUT files (presigned) ──► Bucket        │  presign, validate, sign
  │  3 POST /api/ingest/start ──────────────►  │
  │  4 GET  /api/jobs/:id  (poll)              │  HMAC (X-Timestamp, X-Signature)
  │  5 POST /api/search    (SSE)               ▼
  │  6 GET  /api/person/:id            FastAPI service
  │                                      ├─ ingest: fetch → parse → chunk → embed
  │                                      │          → extract → verify → resolve → upsert
  │                                      ├─ search: parse query → vector + graph → fuse → synthesize
  │                                      └─ read:   person, documents, jobs, stats
  │                                              │            │            │
  │                                           Bucket      Neo4j Aura    Claude / OpenAI
```

The service is not called by browsers. The BFF is the only caller and proves it with an HMAC
close to the original's: `hex(HMAC_SHA256(secret, timestamp + "." + METHOD + "." + path + "." + body))`,
reject if the timestamp is more than 5 minutes off, constant-time compare. Defined in
`service/skillpool/signing.py` and mirrored in `web/lib/service.ts`.

## 3. Repository layout

```
web/                  Next.js 16 app
  proxy.ts            sends anyone without the access cookie to /access (R22)
  app/                pages: /, /search, /person/[id], /upload, /access
  app/api/[...path]/  one route handler: allowlisted, signed proxy to the service (BFF)
  app/api/access/     trades the access code for the cookie
  components/         shared pieces; landing/ holds the 3D graph (three.js, loaded only on /)
  lib/                service.ts (signing, upload gate), access.ts (site access code),
                      api.ts (browser types and helpers),
                      graph.ts (graph layout), mock.ts (canned service for `npm run dev:mock`)
service/
  skillpool/
    api.py            FastAPI routes, signature check, rate limit
    ingest/           parse.py chunk.py extract.py verify.py resolve.py upsert.py job.py
    search/           query.py retrieve.py fuse.py synthesize.py
    graph.py          driver, schema setup, all Cypher as named constants
    llm.py            Claude and embedding clients, retry, spend counter
    storage.py        upload credentials, listing, reads
    signing.py        request signature
    text.py           slugs, skill aliases, snippets
    config.py         limits and thresholds
    cli.py            init-db, init-storage, ingest-dir, eval, delete-document
  tests/              test_unit.py, test_api.py, test_integration.py (needs Neo4j)
  Dockerfile
docker-compose.yml    local Neo4j for development and tests
corpus/
  generate.py         writes everything below from a seed; calls no model
  resumes/            136 generated resumes (PDF, Markdown, plain text)
  generated/          project folders, plus _company/ (team pages, wiki, newsletters, handbook)
  truth/              people.json, projects.json, queries.json, injection.json, ambiguous.json
docs/                 PRD.md, SPEC.md
```

`cli.py ingest-dir` runs the same pipeline as the webhook against a local folder. It is the
development loop and the eval entry point; it is not a second implementation.

## 4. Corpus

`corpus/generate.py` writes the knowledge base of one made-up company, Larkfield, with ten teams:
Platform Engineering, Web and Mobile, Data and Analytics, Security and IT, Product and Design,
Marketing, Sales and Partnerships, Finance, People, and Customer Support. It is deterministic
from a seed and calls no model: the text is templated and the structure is decided by code, so
the ground truth is exact. The generator checks its own output (every labelled name is written
in its document; every planted tool appears only where the truth says) and fails otherwise.

- 136 people (13 per team, plus the three look-alike pairs below), each with a resume in one of four layouts: a classic sectioned PDF,
  a skills-first profile PDF, a Markdown resume with a skills table, and a plain-text resume
  written in the first person. Every layout states each skill's level.
- 30 projects, three per team, each staffed mostly from its own team with up to two people
  from another. A project folder holds a brief (PDF or Markdown), a kickoff email, meeting
  notes, a chat export, one or two weekly updates, and for some a closing write-up (postmortem,
  campaign recap, account review and so on) and a retrospective PDF.
- Company pages: a team page and a how-to wiki page per team, three newsletters, and three
  handbook policies that name nobody.
- Deliberate difficulty, each instance recorded in ground truth:
  - Name variants for the same person: "Aisha Martins", "A. Martins", "Martins, Aisha", a first
    name alone after a full mention, an email address in place of the name.
  - Eight contractors who share a full name with someone on file, and three pairs of employees
    with the same full name in different teams. Told apart by email, employer, title, or project.
  - Three pairs who share a team, a job title, a surname and a first initial. Each joins a
    project whose kickoff email writes them as "L. Adeyemi (Senior Account Executive)", which
    fits both. Four are settled by a later newsletter line, one by an email address beside the
    initial, and one by nothing: that mention must stay unconfirmed (`truth/ambiguous.json`).
  - Tools a project used that no resume mentions (the multi-hop cases): named only in the brief.
  - Tools credited to one person only in a chat line or a meeting note (the unstructured cases).
  - Skill synonyms: "k8s"/"Kubernetes", "JS"/"JavaScript", "Postgres"/"PostgreSQL".
  - Two documents with embedded instructions aimed at the model, to test R20.

Ground truth:
- `people.json`: canonical person → every (document, mention string).
- `projects.json`: project → roster, skills, documents.
- `queries.json`: 48 questions with expected people, tagged `direct` (answerable from resumes),
  `multi_hop` (needs a project document), `unstructured` (stated only in a chat or meeting
  note), or `none` (no one qualifies).

## 5. Graph schema

Nodes

| Label | Key | Properties |
|---|---|---|
| `Person` | `id` (uuid) | `name`, `aliases[]`, `emails[]`, `title`, `surnameKey`, `profileText`, `profileEmbedding` |
| `Skill` | `id` (slug) | `name`, `embedding` |
| `Project` | `id` | `name`, `scope` (`org` or `personal`), `description`, `startDate`, `endDate` |
| `Organization` | `id` (slug) | `name` |
| `Document` | `id` (sha256 of raw bytes) | `path`, `kind` (`resume`, `project_doc`, `other`), `mime`, `bytes`, `status`, `error`, `jobId`, `createdAt` |
| `Chunk` | `id` (sha1 of `docId|order`) | `text`, `embedding`, `order`, `page` |

Relationships

| Pattern | Properties |
|---|---|
| `(Chunk)-[:CHUNK_OF]->(Document)` | |
| `(Document)-[:ABOUT]->(Person)` | resume subject only |
| `(Chunk)-[:MENTIONS]->(Person)` | `surface` (the text as written) |
| `(Person)-[:HAS_SKILL]->(Skill)` | `level`, `sources[]` |
| `(Person)-[:WORKED_AT]->(Organization)` | `title`, `seniority`, `start`, `end`, `sources[]` |
| `(Person)-[:STUDIED_AT]->(Organization)` | `degree`, `field`, `start`, `end`, `sources[]` |
| `(Person)-[:WORKED_ON]->(Project)` | `role`, `contribution`, `sources[]` |
| `(Project)-[:USED_SKILL]->(Skill)` | `sources[]` |
| `(Chunk)-[:MAY_MENTION]->(Person)` | `surface`, `reason`: the name fits and nothing confirms it. Not evidence, not a merge |
| `(:Pending)` | `docId`, `facts`, `context`: what a document said about someone who could not be placed, kept so it can be tried again |

`sources[]` holds chunk ids. It is how a fact reached by a graph walk still produces a citation,
and how deletion (R9) knows which facts lose their support.

Rules
- Skill id is a slug of the canonical name after a small alias table (`js`→`javascript`,
  `k8s`→`kubernetes`, …). Skills are never merged by embedding similarity: "Java" and "JavaScript"
  sit close in embedding space.
- A project declared in a resume gets `scope: personal` and id `personId:slug`. The sample
  resumes name projects after job titles ("Information Security Analyst Project"), which would
  otherwise fuse unrelated people into one project. A project defined in a project document gets
  `scope: org` and id `slug`. A resume project is linked to an org project only on exact
  normalized name match.
- Ingestion progress is derived from `Document.jobId` and `Document.status`. There is no Job node.

Constraints and indexes
- Uniqueness on `id` for all six labels.
- Range index on `Person.surnameKey` and `Document.jobId`.
- Vector indexes (cosine, sized for the embedding model: 1536 or 1024): `chunk_embedding_idx`,
  `person_profile_idx`, `skill_embedding_idx`. A `Meta` node records which model they hold.

## 6. Ingestion pipeline

Per document, in order. Each step is idempotent so a re-sent job resumes where it stopped.

1. Fetch from the bucket. Reject if the size or sniffed type disagrees with the manifest.
2. Hash raw bytes → document id. If a `Document` with that id is `ingested`, skip (R3).
3. Parse to text: pypdf for PDF (BSD licence, pure Python), plain read for TXT and MD. Empty text → `failed: no_text`.
4. Chunk: about 600 tokens with 80 overlap, split on section headings where present. Keep the
   final short piece. (The original dropped chunks under 80 tokens, which loses short documents
   entirely.)
5. Embed chunks in batches of 64. Write `Document(status: processing)` and chunks.
6. Extract with one structured-output call per document (schema below). Documents over about
   6k tokens are extracted per window of three chunks with the document header repeated.
7. Verify every fact's `quote` is a whitespace-normalized substring of the document text. Drop
   and count the ones that are not (R6). Map each surviving quote to the chunk ids containing it.
8. Resolve people (section 7).
9. Upsert facts with `sources[]`, appending to existing lists. Recompute `profileText` and
   `profileEmbedding` for touched people.
10. Mark `ingested`, or `failed` with a short reason. A failure in one document is caught at this
    boundary and does not stop the job (R4).

Extraction output schema

```
kind: resume | project_doc | other
people[]:
  name, emails[], title?, isSubject
  skills[]:    { name, level?, quote }
  roles[]:     { org, title, seniority?, start?, end?, quote }
  education[]: { school, degree?, field?, start?, end?, quote }
  projects[]:  { name, role?, contribution?, quote }
projects[]:    { name, description?, start?, end?, skills[]: { name, quote } }
```

Prompt rules: the document is data inside delimiters and nothing in it is an instruction; output
only what the text states; canonical skill names; quotes copied exactly.

Concurrency: 4 documents at once, retries with backoff on 429 and 5xx, give up after 5 tries and
mark the document failed. A model refusal marks the document `failed: refused`.

## 7. Identity resolution

Input: one extracted person mention with its document context. Output: an existing person id, or
a new person.

1. Email. Any shared normalized email → same person. Done.
2. Blocking. Candidates are people with the same `surnameKey` whose first name matches or whose
   first initial matches. A first-name-only or email-only mention inside a project document is
   blocked against that document's already-resolved people first.
3. Corroboration score per candidate, from evidence beyond the name: shared employer, shared
   project, skill overlap, and cosine similarity between the mention's context embedding and the
   candidate's `profileEmbedding`.
4. Decide:
   - No candidates → new person.
   - Exactly one candidate with strong corroboration → merge, add the surface form to `aliases`.
   - Ambiguous (several plausible candidates, or one with weak corroboration) → one Haiku call
     with the mention context and candidate profiles, answering same / different / unsure.
   - `unsure`, or name-only match with no corroboration → no merge and no new person, which
     would show one person twice. The mention is kept as `MAY_MENTION` on the people it might
     mean and shown on their page as unconfirmed.
5. Try again later. What the document said about an unplaced person is saved (`Pending`).
   After every batch, each waiting mention is scored again against the graph as it now stands,
   without asking the model. If one candidate now clears the merge rule, usually because a
   later document put that person on the project the mention came from, the mention and its
   facts are attached and the unconfirmed marker is removed.

A name match alone never merges. Thresholds are set by sweeping against `truth/people.json` and
picking the point that meets the precision target first, then the best recall there.

## 8. Search

1. Parse the question (one Haiku call, structured output): `skills[]`, `projects[]`. Resolve
   each skill to a `Skill` node by slug and alias table; fall back to `skill_embedding_idx` only
   when there is no exact match, and keep the top match only above a high threshold.
2. Retrieve three ranked lists of people:
   - Vector: embed the question, top 50 chunks from `chunk_embedding_idx`, map to people through
     `ABOUT` and `MENTIONS`. A person's rank comes from their best chunk, not the sum. (Summing,
     as the original did, rewards whoever has the most text.)
   - Direct: people with `HAS_SKILL` to the resolved skills, ordered by how many required skills
     they have, then stated level.
   - Project path: people with `WORKED_ON` to an org project that `USED_SKILL` a resolved skill,
     or that is named in the question. This is the multi-hop leg.
   - Equals in the direct list go by their highest single level. Then, in both the direct and
     the project-path list, by their place in the vector list, then by name. Never by id: ids
     are random, so a rebuild would reorder them.
3. Fuse with reciprocal rank fusion (k = 60). Then reorder by evidence, keeping the fused order
   among equals: first the number of asked-for skills the person holds plus projects the
   question names that they are on; then the number of asked-for skills they reach, counting
   their projects' skills; then total and highest level; then matching projects. The written
   answer is told the same order, so the two agree. Take the top 10. Text hits below a similarity floor
   are discarded before fusion; if that leaves all three lists empty, return an empty list with
   `confidence: none` and a fixed "no one matches" answer, with no model call (R14).
4. Build the evidence pack: for each person up to 3 passages, preferring chunks listed in the
   `sources[]` of the relationships that matched, then their best vector chunks. Number them.
   Attach the path when the project leg contributed, e.g.
   `Aaron Brown → worked on → Atlas Migration → used → Kubernetes`.
5. Synthesize (Haiku, streamed): given the question and the numbered evidence of the top 5
   people, write a short recommendation citing `[n]` for every claim, in ranked order, and say
   so when evidence is insufficient. A project link is described as project experience, never
   as the person's own skill. Citations of anyone ranked lower do not resolve, so step 6 drops them.
6. Validate: strip any `[n]` not in the pack; if a sentence loses all its citations, drop the
   sentence (R13).

Baseline switch: `mode=vector` runs only the vector list. The eval reports both.

## 9. API

Browser-facing (Next.js route handlers). JSON, errors as `{ code, message }`, `x-correlation-id`
generated if absent and passed through to the service and logs.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Web up; service and database reachable. |
| `POST /api/upload/session` | Header `x-access-code`; body: file manifest (path, size). Validates count (≤ 200), size (≤ 10 MB each), type by extension (PDF, TXT, MD). Returns a job id and one presigned POST form per file under `jobs/{jobId}/`, 15-minute expiry, with the key, content type, and exact size fixed by the policy. |
| `POST /api/ingest/start` | Body: job id. Lists what actually landed in the bucket and sends the signed job to the service. Returns 202. |
| `GET /api/jobs/:id` | Counts by status and per-document status and error. |
| `POST /api/search` | Body: `{ q, mode? }`. Server-sent events: `results` (people, evidence, paths, the same paths as `links` data, confidence), `answer` deltas, `done`. |
| `GET /api/person/:id` | Profile, skills, roles, projects, collaborators, evidence. |
| `GET /api/documents/:id/url` | Short-lived presigned GET for a citation click-through (R16). |
| `GET /api/graph` | The landing page's graph (R22): organisation projects, the people on them, the skills they used, and which of those people list which of those skills. At most 600 links of each kind. |
| `GET /api/stats` | Node and relationship counts, unconfirmed mentions. |

Service (FastAPI), all HMAC-protected except `/healthz`: `POST /ingest`, `GET /jobs/{id}`,
`POST /search`, `GET /person/{id}`, `GET /graph`, `GET /stats`, `DELETE /documents/{id}`.

The original's `/worker/finalize` only wrote a log line and is not carried over.

## 10. Testing and evaluation

Unit tests (no network): chunker boundaries including short and empty input; quote verification;
skill slug and alias table; surname key and blocking; HMAC sign and verify including clock skew;
manifest validation; citation stripping; rank fusion.

Integration: `cli.py ingest-dir` on a 20-document fixture against a throwaway Neo4j, with model
calls replayed from recorded responses; assert node and relationship counts and that a second run
changes nothing.

Evaluation (`cli.py eval`, real model calls, run on demand): ingests the full corpus, then reports
every measure in PRD section 8 for `hybrid` and `vector` modes, plus identity precision and recall,
dropped-fact count, and total model spend. Results are written to `corpus/eval/{date}.json`.

Injection check: the two planted documents must produce no facts beyond what their real text
supports, and must not change any answer.

## 11. Cost

Prices: Claude Haiku 5.5 at $0.10 input / $0.50 output per million tokens for prompts up to 100K
tokens, batch processing at half price (Anthropic's published table, read 2026-11-09).
`text-embedding-3-small` at about $0.02 per million tokens (third-party listings; confirm on
OpenAI's pricing page).

Measured on 2026-11-14 for the generated corpus (359 documents): $0.29 to ingest (408 Claude
calls: 359 extractions and 49 identity checks), $0.03 for the evaluation's 43 questions asked
in both modes, and under $0.01 to ingest again with the extraction cache. Voyage embeddings
fell inside the free allowance.

The estimate made before any model call, for the earlier 830-document corpus:

| Step | Volume | Cost |
|---|---|---|
| Generate 150 project documents | ~0.15M output tokens | ~$0.10 |
| Extraction, ~830 documents | ~1.1M input, ~0.6M output including reasoning | ~$0.40 |
| Identity adjudication | a few hundred small calls | ~$0.05 |
| Embeddings | ~0.8M tokens | ~$0.02 |
| One search with answer | ~4K input, ~500 output | ~$0.0007 |

Whole corpus: around $1 at these assumptions; the PRD target is under $2. The eval run reports the
real figure. At this size the choice of provider moves the total by cents. Haiku 5.5 is at or
below the per-token prices found for Gemini's Flash-Lite tier (those figures came from third-party
listings that disagreed with each other, so treat the comparison as approximate). Gemini's free
tier could bring ingestion to zero, with rate limits; switching is a change in `llm.py` only.

Hosting is expected to fit free or lowest paid tiers (Vercel, a small always-on container for the
service, AuraDB Free, a few MB in a bucket). Tier limits are listed in section 14 to confirm.

Haiku 5.5 constraints that affect the code:
- Sampling parameters at non-default values are rejected. The original's `temperature: 0` must go.
- Reasoning is on by default and billed as output. Set effort to `low` for extraction and query
  parsing; measure before raising it.
- Structured output goes through `output_config.format` (the SDK's `messages.parse`), not a
  prefilled assistant turn.
- Refusals return normally with `stop_reason: "refusal"`; check it before reading content.

## 12. Configuration

| Variable | Used by | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | service | |
| `EMBED_PROVIDER` | service | `voyage` (default) or `openai` |
| `OPENAI_API_KEY` or `VOYAGE_API_KEY` | service | embeddings only; the one for the chosen provider |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | service | `neo4j+s://` |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | service | needs put, get, and list on the bucket; the web app holds no storage credentials |
| `S3_ENDPOINT_URL` | service | optional, for an S3-compatible provider that supports POST policy uploads |
| `SERVICE_URL` | web | |
| `SERVICE_SIGNING_SECRET` | web, service | same value in both |
| `SKILLPOOL_MODEL`, `NEO4J_DATABASE` | service | optional overrides; defaults `claude-haiku-5-5` and `neo4j` |
| `SITE_ACCESS_CODE` | web | R22. Unset: a development server is open, a production build is locked |
| `UPLOADS_ENABLED`, `UPLOAD_ACCESS_CODE` | web | R18. Unless `true`, `/upload` redirects to the landing page and nothing links to it |
| `SOURCE_BASE_URL` | service | optional: where documents loaded with `ingest-dir` are published, so "Open source" can link to them |
| `DAILY_MODEL_BUDGET_USD`, `SEARCH_RATE_PER_MIN`, `SEARCH_RATE_TOTAL_PER_MIN`, `SEARCH_RATE_PER_DAY` | service | R19 |
| `READ_RATE_PER_MIN`, `READ_RATE_TOTAL_PER_MIN` | service | limits on signed GET requests; defaults 60 and 600 |
| `EXTRACT_CACHE_DIR` | service | optional, local runs: a folder that keeps each document's extraction so a repeated ingest makes no second Claude call |

## 13. Security

- Uploads: manifest validated before presigning; each POST policy pins the key, content type,
  and exact size and expires in 15 minutes; keys are generated server-side under the job prefix,
  never taken from the client path; the service re-checks size and sniffed type on fetch.
- Bucket: private and encrypted at rest by AWS's defaults for a new bucket; `init-storage` sets
  only the CORS rule (POST from the web origin). An upload policy can be used more than once
  until it expires, and nothing removes stored files: set a lifecycle rule and versioning on the
  bucket (README, Deploy).
- Files: a PDF is opened in a separate process with a memory limit and a 20-second deadline,
  and refused over 300 pages; a document is refused over 300,000 characters of text. Without
  these a small file could expand into gigabytes, or cost a model call per page.
- Site access (R22): `proxy.ts` redirects every page request without a valid cookie to `/access`
  and answers API requests with 401; the API route handler repeats the check. The cookie holds
  the time it was issued, sealed with an HMAC keyed by the code, so it stops working after 30
  days even if copied, and changing the code ends every session. It is `HttpOnly`,
  `SameSite=Lax`, and in production `Secure` and named `__Host-skillpool_access`, so no other
  host can set it. After the code is accepted, the page goes only to an address on this site. Ten wrong tries per address are allowed in ten minutes,
  and 100 from all addresses together, because the address comes from a header a caller can
  fake. Past the total nobody is let in until the window passes. `shortcut:` both counts are in
  one process's memory, so use a long random code. Wrong upload codes are counted the same way.
  A refusal carries `Retry-After`.
  `DELETE /api/access` signs a browser out.
- Browser: every response carries a content security policy (no other site's scripts, frames or
  requests; this site cannot be framed), `nosniff`, `no-referrer`, `noindex`, and HSTS in
  production (`web/next.config.ts`). Inline scripts and styles are allowed because prerendered
  pages cannot carry a nonce. A POST to the API must be JSON and must not be labelled by the
  browser as coming from another site. A link to `/search?q=...` fills the box and waits; only
  a question handed over by this site's own landing page is asked on arrival, so a link cannot
  spend the search budget.
- Service: HMAC on every route; not reachable usefully without the secret. A request body over
  300 KB is refused before the signature is checked. In production the web app refuses a
  `SERVICE_URL` that is not https, since the signature does not hide what is sent.
- Model input: document text delimited as data; extraction constrained to a schema; facts need a
  verified quote; search uses fixed Cypher with parameters only. Names, titles and other stored
  fields are capped in length and may hold no control characters, because they are later placed
  inside other prompts. The answer prompt treats the question as data too.
- Model output: rendered as text. Citations are validated server-side before they reach the UI,
  and a sentence with no citation is shown only if it brings in no link, no markup and no name
  that the evidence lacks. A question can therefore not make the answer recommend someone or
  point somewhere of the asker's choosing. It can still make the asker's own answer say an
  ordinary sentence.
- Uploads are trusted input. Whoever holds the upload code can state anything about a named
  person, and a real quote will back it, because the document says so. No prompt or check can
  tell a false document from a true one. What limits the damage: an upload cannot change a
  person's name or title on record, cannot claim someone's email under another name, every
  claim shows the document it came from, and a document can be deleted. Keep uploads off on a
  hosted demo unless they are being shown.
- Spend: a rate limit per address and for everyone together, a daily search limit per address
  (`SEARCH_RATE_PER_DAY`), and a daily budget counter in the service. The daily count is stored
  in the graph under the day and an HMAC of the address keyed with the signing secret, never the
  address itself, and earlier days are deleted. Signed GET requests have their own per-minute
  limits; every 429 carries `Retry-After`. `/healthz` is unsigned, so it asks the database at
  most every 30 seconds. An answer the reader abandons is charged like a finished one. The budget total is
  stored in the graph and survives restarts. `shortcut:` the rate limit is in memory, and each
  process reads the stored total once a day; use a shared store and read the total on every
  check if the service runs more than one instance. The client address is the first
  `x-forwarded-for` entry, which Vercel overwrites itself; behind any other proxy, confirm it
  does the same or the per-IP limit can be bypassed (the daily budget still holds).
- Notices and standards: `/privacy` (what is kept and who receives questions), a footer that
  says the people are fictional and the answers come from AI, a label under every answer,
  `/robots.txt`, `/.well-known/security.txt` (RFC 9116), `/.well-known/gpc.json` (Global Privacy
  Control: nothing is sold or shared, so the site honours it for everyone) and
  `/third-party-notices.txt`. The footer's link to `/privacy` carries `rel="privacy-policy"`. The
  privacy page covers what GDPR Article 13 asks for (operator and contact, purposes and legal
  basis, recipients, transfers to the US, retention, rights including objection and complaint, no
  automated decisions) and CalOPPA's points on changes and Do Not Track. These
  open without the access code. A header control pauses everything that moves by itself
  (WCAG 2.2.2) and is remembered like the theme.
- TLS: strict certificate verification to Neo4j. The original's fallback to relaxed verification
  (`+ssc`) is not carried over.
- Data: synthetic only. Real resumes are personal data and would need the non-goals in the PRD
  (accounts, deletion, audit) first.

## 14. To confirm at implementation

1. Neo4j vector index DDL and `db.index.vector.queryNodes(index, k, vector)`: confirmed by the
   pipeline test on Neo4j 5.26 and 2026.10.2 Community. `db.index.vector.queryNodes` is
   deprecated since 2026.04 in favour of the Cypher `SEARCH` clause but still works; move to
   `SEARCH` once the local and Aura versions both support it. Run on AuraDB Free on
   2026-11-15 (it reported Neo4j 5.27): the indexes built and every query worked.
2. AuraDB Free limits, from the Aura docs (checked 2026-11-10): 200,000 nodes, 400,000
   relationships, 1 GB storage, one database. The estimated graph (roughly 5k nodes and 40k
   relationships) fits with room to spare. An instance pauses after 72 hours of inactivity and
   is deleted after 30 days paused. Confirmed on 2026-11-15: Free has vector indexes, and the
   whole corpus is 1,163 nodes and 3,704 relationships, far less than the estimate.
3. Anthropic Python SDK structured-output call shape: confirmed against SDK 2.7 with a mock
   transport (`messages.parse` with `output_format` and `output_config.effort`). Whether the live
   API accepts every field for `claude-haiku-5-5` is confirmed only by the first real call.
4. OpenAI embedding limits, from the API reference (checked 2026-11-10): $0.02 per million
   tokens for `text-embedding-3-small`, at most 8,192 tokens per input, 2,048 inputs and
   300,000 tokens per request. The service sends 64 inputs of about 600 tokens, well inside.
5. Pinning upload size: resolved by using POST policy uploads with `content-length-range`.
   Run against LocalStack 4.4's S3: a wrong size, key, or content type is rejected, the
   exact file is accepted, and CORS allows only the web origin. On AWS S3 (2026-11-15) a
   browser upload of three files was accepted, ingested and served back; the refusals were
   not repeated there.

## 15. Milestones

| | Scope | Done when |
|---|---|---|
| M0 | Repo layout, Next.js app, FastAPI app, `init-db`, bucket, env validation, signed health round trip. | `GET /api/health` reports web, service, and database up on the deployed stack. |
| M1 | `corpus/generate.py`, generated documents, ground truth files. | Generator is deterministic for a seed; truth files load; a manual read of 10 documents finds them plausible. |
| M2 | Sections 6 and 7; `ingest-dir`; unit and integration tests. | Full corpus ingests; second run is a no-op; identity precision ≥ 0.98 and recall ≥ 0.90; every stored fact has a verified quote. |
| M3 | Section 8; `eval`. | Eval meets PRD section 8 search targets, or the gap is written down with the vector-only comparison. |
| M4 | The four screens; upload session, ingest start, job polling; streaming search. | A folder uploaded in the browser is searchable without touching a terminal. |
| M5 | Access codes, rate limit, budget, error states, deploy, README with demo script. | Someone with the link and code can run the demo; without the code they see only the access page. |

M1 and M2 are the risk. If time is short, cut P1 items (R8, R9, R16, R21) before touching them.

## 16. From the original: keep and drop

Keep: HMAC webhook scheme; presigned direct upload; correlation ids and structured JSON logs;
sha256 document identity and idempotent MERGE upserts; the Landing / Search / Upload page set and
the example-question search box; the extraction field list (name, skills, education, work,
projects) from the `main` branch prompt.

Drop or fix:
- Regex detection of people from capitalized words (needed a cleanup script for non-people).
- Person id as a slug of the name.
- All resumes concatenated into one prompt and the reply split on `},{`.
- Document id hashed from extracted text instead of the file's bytes.
- Worker reading a local folder while uploads went to S3.
- Per-person score as a sum over all chunk hits.
- Synthesis that was not required to cite, with citations unchecked.
- Dropping chunks under 80 tokens.
- Relaxed-TLS fallback; the duplicated `upsert_persons_and_mentions`; error count hard-coded to 0.
- Three parallel frontends (`web/`, the Next.js shell, and the nested Vite app, whose search and
  upload pages make no API calls).
