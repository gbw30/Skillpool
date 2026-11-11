# SkillPool

Ask who should staff a project and get named people with the passages that back each one.
SkillPool reads resumes and project documents into a Neo4j graph of people, skills, projects,
and organizations, then answers questions by combining text similarity with graph relationships.

A rebuild of the UF OSC MiniHacks (September 2025) project by Laurynas Lukas Kanopka,
Yanka Deshkovski, Gabriel Wong, and Lucas G. Requirements are in [docs/PRD.md](docs/PRD.md),
the design in [docs/SPEC.md](docs/SPEC.md).

## Status

Built and tested without live model calls:

- Service (`service/`): ingestion, quote verification, identity resolution, hybrid search,
  cited answers, signed API. 69 tests pass, including the whole pipeline against a real Neo4j
  (5.26 and 2026.10) with the model calls replaced by fakes.
- Web app (`web/`): landing, search, person, and upload screens plus the signed proxy. Builds
  and lints clean. All four screens were checked in headless Chromium, at desktop and phone
  width, against the service with faked model calls, including a folder upload that then
  showed up in search.
- Uploads: the upload policy was run against a local S3 emulator (LocalStack 4.4), which
  rejected a wrong size, key, or content type and accepted the exact file.
- Corpus (`corpus/`): 680 resumes, 159 generated project documents, and ground truth.

Not yet done, because it needs your API keys and accounts:

- No real Claude or OpenAI call has been made. Extraction quality, the identity-resolution
  thresholds, and the search floor are untuned defaults. Run the evaluation below to get real
  numbers against the PRD targets.
- Browser upload has not been run against a real AWS bucket, only the emulator.
- Nothing is deployed.

## Layout

```
service/   FastAPI service and CLI (Python, uv)
web/       Next.js app: UI and a signed proxy to the service
corpus/    resumes/, generate.py, generated/, truth/
docs/      PRD.md, SPEC.md
```

## Run it locally

Needs Docker, [uv](https://docs.astral.sh/uv/), Node 20+, an Anthropic key, and an embeddings key
(OpenAI or Voyage AI, see [Embedding provider](#embedding-provider)).

```bash
docker compose up -d neo4j
```

```bash
cp service/.env.example service/.env && cp web/.env.example web/.env.local
```

Fill in the Anthropic key, the key of the embedding provider you chose, and one shared
`SERVICE_SIGNING_SECRET` in both files. Then, from
`service/`:

```bash
uv run --env-file .env skillpool init-db
```

```bash
uv run --env-file .env skillpool eval ../corpus
```

`eval` ingests the corpus (about 840 documents; the spec estimates around $1 of model calls,
and the default daily cap is $5) and writes scores to `corpus/eval/`. It is safe to re-run:
documents already ingested are skipped. To load documents without scoring, use
`skillpool ingest-dir <folder>`.

Start the service and the web app:

```bash
uv run --env-file .env uvicorn skillpool.api:app --port 8000
```

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3000.

### Screens only, without keys

To work on the UI with no API keys, database, or `.env` file:

```bash
cd web && npm install && npm run dev:mock
```

The web app then answers from canned data in `web/lib/mock.ts` instead of calling the service.
Search returns the same three people for any question, except that a question containing "cobol"
gets no match, "error" fails part-way through the answer, and "limit" is rate limited. Uploads take
the access code `mock`; the files are dropped, and the batch table steps through processing with
every fourth file failing. "Open source" has no files to open. Mock mode only works under
`next dev`, never in a production build.

### Embedding provider

`EMBED_PROVIDER` in `service/.env` picks who turns text into vectors:

| Value | Model | Vector size | Key | Price |
|---|---|---|---|---|
| `openai` (default) | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` | $0.02 per million tokens |
| `voyage` | `voyage-4-lite` | 1024 | `VOYAGE_API_KEY` | first 200 million tokens free, then $0.02 per million |

Vectors from the two cannot be compared, so a database belongs to one provider at a time. The
service refuses to search or ingest when the setting does not match the database. To switch a
database that already holds documents, change `EMBED_PROVIDER` and run:

```bash
uv run --env-file .env skillpool reembed
```

It recomputes every vector from the stored text and makes no Claude calls, so for the corpus it
costs about a cent on OpenAI and nothing on Voyage. Restart the service afterwards. The search
thresholds (`VECTOR_FLOOR` and the skill-match floor) are similarity scores, which differ
between models: re-run `skillpool eval` after switching.

### Browser uploads

Uploads go straight from the browser to a bucket, so they need real object storage: set the
`S3_*` and `AWS_*` values in `service/.env`, run
`uv run --env-file .env skillpool init-storage --origin http://localhost:3000`, and set
`UPLOADS_ENABLED=true` and an `UPLOAD_ACCESS_CODE` in `web/.env.local`. The bucket must accept
POST policy uploads (AWS S3 does; Cloudflare R2 did not when this was written).

## Tests

```bash
cd service && uv run pytest
```

The pipeline tests are skipped unless pointed at a database, because they wipe it:

```bash
SKILLPOOL_TEST_NEO4J_URI=bolt://127.0.0.1:17687 SKILLPOOL_TEST_NEO4J_PASSWORD=skillpool-dev uv run pytest
```

Do not point that at a database you care about. `.github/workflows/ci.yml` runs the same
tests against a throwaway Neo4j, plus the web lint and build, on every push and pull request.

## Deploy

- Database: Neo4j AuraDB. Set `NEO4J_URI` to the `neo4j+s://` address and run `init-db` once.
  The Free tier allows 200,000 nodes, 400,000 relationships, and 1 GB, far more than the corpus
  needs. It pauses after 72 hours without activity and is deleted after 30 days paused, so
  resume it in the Aura console before a demo.
- Service: `service/Dockerfile` on any container host. Run a single instance: batch progress
  and rate limits are held in memory. The daily spend total is stored in the graph, so a
  restart does not reset the cap. Set a spend limit with each model provider as well.
- Web: Vercel or any Node host, with the four variables from `web/.env.example`. The rate
  limit trusts the first `x-forwarded-for` entry, which is only reliable behind a platform
  proxy that sets it.

## Demo script

1. Search "Who has hands-on experience with Kafka?" No resume mentions Kafka. The people
   returned are found through project documents: person → worked on → project → used → Kafka.
2. Open a result. The person page shows the name variants that were resolved to them and the
   passages each fact came from.
3. Search "Who has COBOL experience?" The answer is that no one matches.
4. Upload a small folder and watch the batch table reach "ingested".

## Notes

- The resumes come from the original hackathon repository and are synthetic. Their origin and
  licence are not documented; confirm before publishing this repository (PRD section 11).
- `corpus/generate.py` is deterministic for a seed. `--llm` has Claude rewrite the prose and
  costs model calls; that path has not been run.
