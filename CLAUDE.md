# SkillPool

Rebuild of the UF OSC MiniHacks (Sept 2025) project: ask who should staff a project, get named
people with cited passages. GraphRAG on Neo4j (vector + graph walks, reciprocal rank fusion).
Requirements: docs/PRD.md. Design and implementation status: docs/SPEC.md (section 0 and 14).
Run, test, deploy: README.md. Read those before planning; don't duplicate them here.

## Layout
- service/ — FastAPI + CLI (Python 3.12, uv). Models: Claude Haiku 5.5 (`claude-haiku-5-5`) for
  extraction/answers, OpenAI text-embedding-3-small (1536-d) for embeddings.
- web/ — Next.js 16 (App Router, cacheComponents) UI + signed proxy (`app/api/[...path]`).
  Read web/AGENTS.md and current Next.js docs before writing web code.
- corpus/ — 680 resumes, 159 generated docs (`generate.py`, seed 7), ground truth in truth/.

## Commands
- Tests: `cd service && uv run pytest` (65 pass). Pipeline tests need
  `SKILLPOOL_TEST_NEO4J_URI=bolt://127.0.0.1:17687 SKILLPOOL_TEST_NEO4J_PASSWORD=skillpool-dev` and
  wipe that database.
- Local Neo4j: `docker compose up -d neo4j` (ports 17474/17687, auth neo4j/skillpool-dev).
- Web: `cd web && npm run lint && npm run build`.

## Invariants
- Every extracted fact needs a verbatim quote; answers cite chunks and are validated per sentence.
- Cypher is fixed and parameterized (named constants in service/skillpool/graph.py); never build
  Cypher from model output.
- Request signing (`signing.py`) must stay identical to `web/lib/service.ts`.
- Two resumes are two people unless emails match; people listed separately in one document are
  never merged.

## Not done yet (needs the owner)
- No live model call made; thresholds (merge scores, VECTOR_FLOOR) untuned. Next step: API keys in
  service/.env, then `uv run --env-file .env skillpool eval ../corpus` (~$1, $5 daily cap).
- Browser upload passed against a local S3 emulator (LocalStack); untested against real AWS S3.
- Not deployed. Screens were checked in headless Chromium with faked model calls only.
- No git remote yet; CI (`.github/workflows/ci.yml`) has never run.
- Open questions: resume licence/origin, public vs code-gated demo, crediting the original team.
