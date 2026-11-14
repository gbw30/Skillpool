"""Settings. Secrets are read from the environment when first needed, tunables at import."""
import os


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"environment variable {name} is required")
    return value


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


CLAUDE_MODEL = os.environ.get("SKILLPOOL_MODEL", "claude-haiku-5-5")

# Embeddings: provider -> (model, vector dimensions, USD per million tokens, search floor, skill floor).
# Vectors from different models cannot be compared. After changing EMBED_PROVIDER on a database
# that already holds vectors, run `skillpool reembed`.
# The two floors are Neo4j cosine scores, (1 + cos) / 2, and every model spreads its scores
# differently, so they belong to the model:
# - search floor: a passage scoring below it is not evidence for a question.
# - skill floor: how close an unknown skill name must be to a known one to count as the same skill.
EMBEDDERS = {
    # Untuned: no evaluation has been run on these vectors.
    "openai": ("text-embedding-3-small", 1536, 0.02, 0.65, 0.85),
    # The first 200M tokens are free per account; the spend counter still counts the list price.
    # Floors measured on the corpus, 2026-11-14. Search: questions nobody can answer peaked at 0.72,
    # resume questions started at 0.755. Skills: real variants ("Postgres", "K8s") scored 0.98 or
    # more, different skills ("COBOL" against "Java") 0.93 or less.
    "voyage": ("voyage-4-lite", 1024, 0.02, 0.73, 0.96),
}
EMBED_PROVIDER = os.environ.get("EMBED_PROVIDER", "voyage")
if EMBED_PROVIDER not in EMBEDDERS:
    raise RuntimeError(f"EMBED_PROVIDER must be one of {sorted(EMBEDDERS)}, not {EMBED_PROVIDER!r}")
EMBED_MODEL, EMBED_DIM, PRICE_EMBED, _SEARCH_FLOOR, _SKILL_FLOOR = EMBEDDERS[EMBED_PROVIDER]

# USD per million tokens, for the spend counter. Update when prices change.
PRICE_IN, PRICE_OUT = 0.10, 0.50
DAILY_MODEL_BUDGET_USD = _float("DAILY_MODEL_BUDGET_USD", 5.0)
SEARCH_RATE_PER_MIN = int(os.environ.get("SEARCH_RATE_PER_MIN", "20"))

# Chunking: about 600 tokens with 80 overlap at ~4 characters per token.
CHUNK_CHARS = 2400
OVERLAP_CHARS = 320
LONG_DOC_CHARS = 24_000  # above this, extract per window of three chunks

# Uploads
MAX_FILES = 200
MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown"}
UPLOAD_TTL_SECONDS = 900

# Identity resolution. Check any change against corpus/truth/people.json with `skillpool eval`.
MERGE_SCORE_EXACT = _float("MERGE_SCORE_EXACT", 0.30)  # full first and last name match
# Only a first initial matches, so it needs a little more than a full name does. It was 0.50,
# which an initial with the same job title (0.2 plus text similarity) could never reach:
# "M. Andersson (Partnerships Manager)" in a kickoff email became a second Maria Andersson, and
# later mentions made a third. Two people on file with the same initial, surname and title
# still go to the margin check below, not to a merge.
MERGE_SCORE_INITIAL = _float("MERGE_SCORE_INITIAL", 0.33)
# Lead required over the runner-up. A matching job title is worth 0.2 and text similarity moves
# a score by a few hundredths either way, so 0.20 let that noise undo a title match.
MERGE_MARGIN = _float("MERGE_MARGIN", 0.15)

# Search. The floors come from the embedding model's row above.
VECTOR_FLOOR = _float("VECTOR_FLOOR", _SEARCH_FLOOR)
SKILL_VECTOR_FLOOR = _float("SKILL_VECTOR_FLOOR", _SKILL_FLOOR)
VECTOR_K = 50
RRF_K = 60
TOP_PEOPLE = 10
EVIDENCE_PER_PERSON = 3

GRAPH_VIEW_LINKS = 600  # most links of each kind sent to the landing page's graph

INGEST_CONCURRENCY = 4
# A folder that keeps each document's extraction, so repeating an ingest costs nothing. Off when unset.
EXTRACT_CACHE_DIR = os.environ.get("EXTRACT_CACHE_DIR", "")
SIGNATURE_SKEW_SECONDS = 300
