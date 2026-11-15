# SkillPool — Product Requirements (PRD)

Status: draft for review · 2026-11-09 · Owner: Gabriel Wong
Companion: [SPEC.md](SPEC.md) (technical design)

## 1. Summary

SkillPool answers "who should staff this?" from a company's own documents. It ingests resumes and
project documents, builds a graph of people, skills, projects and organizations in Neo4j, and
answers plain-language questions with named candidates and the evidence for each one.

This is a rebuild of the September 2025 hackathon project (UF OSC MiniHacks). The goal is a
portfolio-grade, single-tenant demo that actually does what the pitch describes. The hackathon
build did not get there: see section 2.

## 2. Background: what the original did

Read from the repository (`LukasKanopka/MiniHacksSep27`, branches `main` and `lukas`).

| Pitch claim | What the code did |
|---|---|
| Living map of people, skills, projects | Two separate graphs that never met. `main`: Gemini 2.5 Flash extracted name, skills, education, work, projects from resumes into `Person`/`Skill`/`Project` nodes, queried by exact-name CLI menu. `lukas`: `Document`/`Chunk` nodes with embeddings, and `Person` nodes created by a capitalized-words regex. |
| GraphRAG: vector search plus graph walks, multi-hop | `lukas` ran one vector search over chunks and summed scores per mentioned person. No graph traversal in the query path. |
| Matched identities across systems with embeddings | Not implemented. Person id was a slug of the name, so same-name people merged and name variants split. |
| Cited evidence | Chunk snippets were returned and passed to the LLM, but the answer was not required to cite and citations were not checked. |
| Upload a folder and search it | Browser upload went to S3; the worker only read a local directory. Uploaded files were never ingested. |
| Resumes, project documents, other company data | The corpus was about 680 synthetic resume PDFs, one per person. No project documents. |

Not reviewed: the Devpost page (blocks automated access) and the demo video's content (only the
title was readable). The description supplied by the owner is treated as the pitch.

## 3. Problem

Managers staff projects by who is free and who they remember, because the proof of who has done
what is scattered across resumes and project documents. Keyword search over those files is either
too broad or misses people whose experience is described in different words or only in a project
write-up.

## 4. Users

| User | Job to be done |
|---|---|
| Staffing manager (primary) | "I need two people who have shipped Kubernetes migrations. Who, and why should I believe it?" |
| Analyst | "Who has worked with whom, on what, using what?" Browses a person and their evidence. |
| Operator (the demo owner) | Loads a folder of documents, watches ingestion finish, sees what failed and why. |

## 5. Goals and non-goals

Goals
1. A question in plain language returns ranked, named people, each with evidence a reader can open.
2. Answers use relationships across documents, not only text similarity. Example: a person whose
   resume never says "Kubernetes" is found because a project report puts them on a project that
   used it.
3. The same person appearing under different name forms in different documents is one node; two
   different people with the same name stay two nodes.
4. Documents can be added from the browser and become searchable without a developer.
5. Quality is measured against a labelled corpus, not judged by eye.

Non-goals (this version)
- Accounts, roles, multiple organizations.
- Connectors to HR systems, wikis, ticket trackers, or email.
- Editing the graph by hand.
- Availability, scheduling, or anything that makes a staffing decision for the user.
- LLM-written database queries. All Cypher is fixed and parameterized.
- Real personal data. The demo corpus is synthetic.

## 6. Requirements

Priority: P0 = needed for the demo to be honest, P1 = planned, P2 = later.

### Ingestion
| ID | Requirement | Pri |
|---|---|---|
| R1 | Upload a folder of PDF, TXT, and MD files from the browser. Per-file and per-batch size limits are enforced before upload starts. | P0 |
| R2 | Ingestion status is visible per batch and per document: queued, processing, ingested, failed with a reason. Status survives a page reload. | P0 |
| R3 | Re-uploading an unchanged file does not create duplicates and costs no model calls. | P0 |
| R4 | One bad file does not stop the batch. | P0 |
| R5 | From each document the system extracts people, skills (with level if stated), roles and employers, education, and projects, and records which passage supports each fact. | P0 |
| R6 | A fact is stored only if its supporting quote is found verbatim in the source document. | P0 |
| R7 | Mentions of the same person across documents are resolved to one person. A merge needs corroboration beyond the name. An uncertain mention is neither merged nor made into a second person; it is kept as unconfirmed on the people it might mean, and attached later if a later document settles who was meant. | P0 |
| R8 | DOCX support. | P1 |
| R9 | Delete a document and every fact that only it supported. | P1 |

### Search
| ID | Requirement | Pri |
|---|---|---|
| R10 | A free-text question returns up to 10 ranked people. | P0 |
| R11 | Each result shows why: matched skills, relevant projects, and up to 3 quoted passages with their source document. | P0 |
| R12 | Results combine text similarity with graph relationships (person to skill, person to project to skill). The result shows the relationship path when one was used. | P0 |
| R13 | A written answer summarizes the top candidates. Every claim carries a citation that resolves to a shown passage. Citations that do not resolve are removed before display. | P0 |
| R14 | When evidence is thin or absent the system says so and does not pad the list. | P0 |
| R15 | Ranked results appear before the written answer finishes. | P0 |
| R16 | A citation opens the source document. | P1 |
| R17 | A person page lists skills, roles, projects, collaborators, and all evidence. | P0 |

### Operations and safety
| ID | Requirement | Pri |
|---|---|---|
| R18 | Uploads on a public deployment require an access code and can be switched off entirely. | P0 |
| R19 | Search on a public deployment is rate limited, with a daily cap on model spend. | P0 |
| R22 | The whole site asks for one access code. Without it no page and no API route answers, and a deployment with no code configured lets nobody in. | P0 |
| R20 | Document text is never treated as instructions and model output is never rendered as HTML. | P0 |
| R21 | A stats view shows counts of documents, chunks, people, skills, projects, and unconfirmed mentions. | P1 |
| R22 | The landing page draws the indexed graph of organisation projects, the people on them, and the skills they used. A node can be pointed at to trace its links, a person opens their page, the view can be zoomed and moved, and the same content is offered as a list. | P1 |

## 7. Experience

Four screens, matching the original's Landing, Search, and Upload plus the person page it planned
but never built.

1. Landing. One line on what it does, two actions: search, add documents. Beside them a 3D drawing
   of the indexed graph, which flies in and becomes an explorable graph view as the page scrolls (R22).
2. Search. A single question box with example questions. Results list on the left, written answer
   on the right (stacked on a phone). Each person card: name, current title, matched skills,
   relationship path if any, quoted evidence with source file names. States: empty, loading,
   no confident match, error.
3. Person. Header (name, title, known aliases), skills with levels, roles, projects with
   collaborators, evidence list.
4. Add documents. Folder picker, file list with validation errors shown before upload, progress
   per file, then a batch status table that updates until done. Failed files show the reason.

## 8. Success measures

Measured by an evaluation run against the labelled synthetic corpus (see SPEC section 10).
Targets are for the P0 release.

| Measure | Target |
|---|---|
| Recall@10 on labelled questions | at least 0.80 overall |
| Recall@10 on questions answerable only through a project document (multi-hop) | at least 0.70; vector-only baseline reported beside it |
| Recall@10 on questions answerable only from a chat export or meeting notes (unstructured) | reported; no target set yet |
| Citation validity (citation resolves to a shown passage containing the quote) | 100% |
| Identity resolution precision (merged pairs that are truly the same person) | at least 0.98 |
| Identity resolution recall | at least 0.90 |
| Stored facts with a verified quote | 100% by construction (R6) |
| Time to ranked results, p95 | under 3 s |
| Time to complete written answer, p95 | under 10 s |
| Model cost to ingest the full demo corpus | under $2 |
| Upload to searchable, 50 documents | under 5 minutes |

The multi-hop row is the one that shows whether the graph earns its place. If the graph leg does
not beat vector-only there, that is a finding to report, not hide.

## 9. Release plan

| Milestone | Outcome |
|---|---|
| M0 Skeleton | Web app, service, database, and bucket deployed and talking; health check green. |
| M1 Corpus | A synthetic company knowledge base (resumes, project documents, company pages) generated with ground truth files. |
| M2 Ingestion | A folder on disk becomes a correct graph; identity resolution measured. |
| M3 Search | Hybrid retrieval and cited answers; evaluation run passes the targets or reports the gap. |
| M4 Interface | The four screens, including browser upload end to end. |
| M5 Hardening | Access code, rate limits, failure handling, deployed demo, short demo script. |

## 10. Risks

| Risk | Response |
|---|---|
| False merges of different people damage trust more than missed merges. | Merge only with corroboration; measure precision; flag uncertain pairs instead of merging. |
| The synthetic corpus makes the problem look easier than real data. | Generator injects name variants, same-name people, and skill synonyms; say plainly in the README that it is synthetic. |
| The graph leg adds complexity without adding recall. | Report vector-only baseline beside hybrid on every eval run. |
| Resume "projects" are named after job titles and collide across people. | Resume projects are scoped to their person unless matched to a project defined in a project document. |
| A public demo with open upload and search spends the owner's API budget. | R18, R19 and R22. |
| Rights to reuse the resume dataset are undocumented. | Closed: the inherited resumes were replaced with generated ones. |

## 11. Open questions

1. Closed (owner, 2026-11-12): the origin of the 680 inherited resume PDFs is unknown, so they
   were removed. `corpus/generate.py` now writes the resumes as well as the other documents.
2. Closed (owner, 2026-11-12): the demo is private. The whole site asks for an access code (R22)
   and the team records its own demo.
3. Should the rebuild credit the original team in the README? (Laurynas Lukas Kanopka, Yanka
   Deshkovski, Gabriel Wong, Lucas G.)

## 12. Sources

- Owner's project description (treated as the pitch).
- Repository `LukasKanopka/MiniHacksSep27`: `README.md`, `AGENTREADME.md`, `AGENTPROGRESS.md`,
  `neo4j/src/`, `netlify/functions/`, `frontend/` on `lukas`; `LLM_Parsing.py`, `schema_neo4j.py`,
  `findperson.py`, `call.py` on `main`.
- Demo video title: "SkillPool Demo for UF OSC MiniHacks Sept 2025".
