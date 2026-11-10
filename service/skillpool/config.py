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
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536

# USD per million tokens, for the spend counter. Update when prices change.
PRICE_IN, PRICE_OUT, PRICE_EMBED = 0.10, 0.50, 0.02
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

# Identity resolution. Untuned defaults: sweep against corpus/truth/people.json with `skillpool eval`.
MERGE_SCORE_EXACT = _float("MERGE_SCORE_EXACT", 0.30)  # full first and last name match
MERGE_SCORE_INITIAL = _float("MERGE_SCORE_INITIAL", 0.50)  # only a first initial matches
MERGE_MARGIN = _float("MERGE_MARGIN", 0.20)  # lead required over the runner-up

# Search. Neo4j cosine scores are (1 + cos) / 2. Untuned default, see `skillpool eval`.
VECTOR_FLOOR = _float("VECTOR_FLOOR", 0.65)
VECTOR_K = 50
RRF_K = 60
TOP_PEOPLE = 10
EVIDENCE_PER_PERSON = 3

INGEST_CONCURRENCY = 4
SIGNATURE_SKEW_SECONDS = 300
