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
  cited answers, signed API. 94 tests pass, including the whole pipeline against a real Neo4j
  (5.26 and 2026.10) with the model calls replaced by fakes.
- Web app (`web/`): landing, search, person, and upload screens plus the signed proxy. Builds
  and lints clean. All four screens were checked in headless Chromium, at desktop and phone
  width, against the service with faked model calls, including a folder upload that then
  showed up in search.
- Uploads: the upload policy was run against a local S3 emulator (LocalStack 4.4), which
  rejected a wrong size, key, or content type and accepted the exact file. On 2026-11-15 a
  browser uploaded a PDF, a `.txt` and a `.md` to a real AWS S3 bucket: all three were ingested
  from the bucket, found by search, and "Open source" returned the same files. The refusals
  were not repeated against AWS.
- Corpus (`corpus/`): the knowledge base of one made-up company with ten teams. 136 resumes,
  241 project and company documents, and ground truth, all written by `corpus/generate.py`.
- Access: the whole site asks for one access code (`SITE_ACCESS_CODE`).

- Evaluation: last run on 2026-11-15 with Claude Haiku 5.5 and Voyage embeddings. Every target in
  PRD section 8 that the run measures was met; the numbers are in `docs/SPEC.md` section 0.

Not yet done:

- Nothing is deployed. The corpus is loaded in an AuraDB Free instance, and the site's
  production build was walked through against it on 2026-11-15 (access code, landing graph,
  the demo questions, a person page, sign-out).
- The OpenAI embedding path has never been run live, and its search floors are untuned.

## Layout

```
service/   FastAPI service and CLI (Python, uv)
web/       Next.js app: UI and a signed proxy to the service
corpus/    generate.py, and what it writes: resumes/, generated/, truth/
docs/      PRD.md, SPEC.md
```

## Run it locally

Needs Docker, [uv](https://docs.astral.sh/uv/), Node 20+, an Anthropic key, and an embeddings key
(Voyage AI by default, or OpenAI; see [Embedding provider](#embedding-provider)).

```bash
docker compose up -d neo4j
```

```bash
cp service/.env.example service/.env && cp web/.env.example web/.env.local
```

Fill in the Anthropic key, the key of the embedding provider you chose, and one shared
`SERVICE_SIGNING_SECRET` in both files. Set `SITE_ACCESS_CODE` in `web/.env.local` if you want
the access page locally; a development server is open without it. Then, from `service/`:

```bash
uv run --env-file .env skillpool init-db
```

```bash
uv run --env-file .env skillpool eval ../corpus
```

`eval` ingests the corpus (377 documents) and writes scores to `corpus/eval/`. A first run with
no cache costs about $0.30 of Claude calls to ingest and $0.04 for the 48 questions; the default
daily cap is $5. It is safe to re-run: documents already ingested are skipped. To load documents without
scoring, use `skillpool ingest-dir <folder>`.

Set `EXTRACT_CACHE_DIR=.cache/extract` in `service/.env` before the first run. Ingestion reads
every document with Claude before it writes any of them, so a run that is cut off part-way
would otherwise pay for all of that reading again. With the cache, repeating the whole ingest
into an empty database cost under one cent.

Start the service and the web app:

```bash
uv run --env-file .env uvicorn skillpool.api:app --port 8000
```

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3000.

### Access code

The whole site sits behind one code, `SITE_ACCESS_CODE` in the web app's environment. Without
the cookie that the access page sets, every page redirects to `/access` and every API route
answers 401. A production build with no code configured lets nobody in, so a deployment that
forgot the variable is closed, not public. Use a long random code (`openssl rand -base64 18`):
wrong tries are limited to ten per address and 100 in total every ten minutes, but those counts
live in one server process. Past the total the page refuses everyone, the right code included,
until the ten minutes pass. Changing the code signs everyone out; "Sign out" in the header signs
out one browser. Uploads still need their own `UPLOAD_ACCESS_CODE` on top, and wrong upload
codes are limited the same way.

### Screens only, without keys

To work on the UI with no API keys, database, or `.env` file:

```bash
cd web && npm install && npm run dev:mock
```

The web app then answers from canned data in `web/lib/mock.ts` instead of calling the service.
Search returns the same three people for any question, except that a question containing "cobol"
gets no match, "error" fails part-way through the answer, and "limit" is rate limited. Uploads take
the access code `mock`; the files are dropped, and the batch table steps through processing with
every fourth file failing. "Open source" has no files to open. The landing page's graph is a
made-up sample of 48 people, 12 projects from across a business (sales, finance, design, people,
operations, engineering and more) and the 26 tools they used. Mock mode only works under
`next dev`, never in a production build.

The real app shows the same sample graph, labelled as a sample, while nothing is indexed or the
service cannot be reached.

### Embedding provider

`EMBED_PROVIDER` in `service/.env` picks who turns text into vectors:

| Value | Model | Vector size | Key | Price |
|---|---|---|---|---|
| `voyage` (default) | `voyage-4-lite` | 1024 | `VOYAGE_API_KEY` | first 200 million tokens free, then $0.02 per million |
| `openai` | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` | $0.02 per million tokens |

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

`--origin` sets the one address whose pages the bucket lets upload, and each run replaces the
last. For local work on whichever port is free, use `--origin 'http://localhost:*'`. The rule
is not what keeps strangers out: every upload still needs a signed policy for that one file,
which the service issues only with the upload code. For a deployment, run it again with the
site's address.

With `UPLOADS_ENABLED` anything but `true`, the upload page redirects to the landing page and
nothing links to it. The redirect follows the setting at once; the links are decided when the
site is built, so rebuild or redeploy after changing it.

### Source documents

"Open source" on a quoted passage opens the file it came from. An uploaded file is served from
the bucket by a link that expires. A document loaded with `ingest-dir` is not in the bucket:
set `SOURCE_BASE_URL` in `service/.env` to where that folder is published, and the link goes
there. For the corpus in this repository:

```
SOURCE_BASE_URL=https://github.com/gbw30/Skillpool/blob/main/corpus
```

Without it, those documents answer "The source file for this document is not stored."

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

Step-by-step for the hosted demo (Render, Vercel, AuraDB Free, $5 spend limits): [docs/DEPLOY.md](docs/DEPLOY.md).
The rules below say why each setting is what it is.

- Database: Neo4j AuraDB. Set `NEO4J_URI` to the `neo4j+s://` address and run `init-db` once.
  The Free tier allows 200,000 nodes, 400,000 relationships, and 1 GB, far more than the corpus
  needs. It pauses after 72 hours without activity and is deleted after 30 days paused, so
  resume it in the Aura console before a demo. Loading the corpus there from the extraction
  cache took 35 minutes (four against a local Neo4j) and cost half a cent. Keep its credentials
  in a file outside the repository and add it after the usual one:
  `uv run --env-file .env --env-file <aura file> skillpool ingest-dir ../corpus`.
- Service: `service/Dockerfile` on any container host. Run a single instance: batch progress
  and rate limits are held in memory. The daily spend total is stored in the graph, so a
  restart does not reset the cap. Set a spend limit with each model provider as well. Set
  `SOURCE_BASE_URL` (see [Source documents](#source-documents)) so quotes link to their files.
- Web: Vercel, with the variables from `web/.env.example`, including `SITE_ACCESS_CODE`. The
  per-address limits trust the first `x-forwarded-for` entry, which only a platform proxy that
  sets it makes reliable, and gated pages are safe from a shared cache only where the proxy runs
  ahead of it, as on Vercel. On another host, turn off HTML caching at the CDN.

Before it goes on the internet:

- Use three separate long random values for `SITE_ACCESS_CODE`, `UPLOAD_ACCESS_CODE` and
  `SERVICE_SIGNING_SECRET` (`openssl rand -base64 24`), set for the production environment only.
- Leave `UPLOADS_ENABLED=false` unless uploads are being shown. Whoever can upload can state
  anything about a named person (SPEC section 13). With uploads on, set `UPLOAD_ORIGIN` to the
  bucket's address and run `init-storage --origin https://<the site>`.
- `SERVICE_URL` must be `https://`. If the container host offers an allowlist or private
  networking, let only the web app reach the service.
- Bucket: its own bucket, Block Public Access on, a key limited to that bucket, a lifecycle rule
  that expires `jobs/` after a few days, and versioning.
- Spend limits at each provider (Anthropic, Voyage/Atlas) and an AWS budget alarm. The app's
  daily cap is software.
- AuraDB has no backup on the free tier. Keep `service/.cache/extract`: with it the whole graph
  can be rebuilt for under a cent. When the database is paused, search fails and the landing
  page shows the sample graph.
- Questions appear in `/search?q=` addresses, so they reach the host's request logs and browser
  history.

## Demo script

1. Search "Who has hands-on experience with Kafka?" No resume mentions Kafka. The people
   returned are found through project documents: person → worked on → project → used → Kafka.
   Then "Who has hands-on experience with DocuSign?": the only evidence is one line in a team
   chat.
2. Open a result. The person page shows the name variants that were resolved to them and the
   passages each fact came from.
3. Search "Who has COBOL experience?" The answer is that no one matches.
4. With uploads on: upload a small folder and watch the batch table reach "ingested".

## Licence

The code is under the [MIT License](LICENSE). The corpus is generated by `corpus/generate.py`;
the resumes inherited from the original hackathon repository were removed because their origin
was unknown.

The landing page credits the original team at the bottom.

### Third-party software

No third-party source is copied into this repository; dependencies are installed from the lock
files (`service/uv.lock`, `web/package-lock.json`) and stay under their own licences. The Python
ones are MIT, BSD, Apache-2.0, PSF-2.0 and, for `certifi`, MPL-2.0. None is GPL or AGPL.

PDFs are read with [pypdf](https://github.com/py-pdf/pypdf) (BSD-3-Clause, copyright Mathieu
Fenniak and the pypdf contributors). What that licence asks, and how it is met:

- **Keep the copyright notice with any copy.** Every installed package carries its licence file
  (`pypdf-*.dist-info/licenses/LICENSE`), and the service image built from `service/Dockerfile`
  keeps it. Do not strip `*.dist-info` folders from an image or bundle you hand to someone else.
- **Do not use the authors' names to endorse this project.** Nothing here does.

Running the service for others is not redistribution, so nothing more is needed to host it.

## Notes

- Every person, company and document in the corpus is made up. Any match with a real person's
  name is a coincidence.
- `corpus/generate.py` is deterministic for a seed and calls no model. Regenerate with
  `uv run --project service python corpus/generate.py`; do not edit its output by hand.
