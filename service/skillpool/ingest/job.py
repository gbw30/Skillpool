"""Run an ingestion job: prepare documents in parallel, then write them one at a time.

Writing is serial so identity resolution never races with itself, and resumes go first so
that mentions in project documents find the people they refer to.

shortcut: no queue. A restart drops in-flight work; re-sending the job resumes it, because
every step is idempotent. Add a queue when one request can no longer re-drive a batch.
"""
import hashlib
import logging
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from .. import config, graph, llm
from .chunk import Chunk, chunk
from .extract import extract
from .parse import ParseError, parse
from .upsert import write
from .verify import verify

log = logging.getLogger("skillpool.ingest")

# Job id -> paths accepted but not yet registered in the graph. In memory only.
PENDING: dict[str, set[str]] = {}


@dataclass
class Item:
    path: str  # shown to the user
    key: str | None  # object key in the bucket, if it came from one
    fetch: Callable[[], bytes]


@dataclass
class Prepared:
    doc_id: str
    path: str
    facts: dict
    chunks: list[Chunk]
    embeddings: list[list[float]]


def _prepare(job_id: str, item: Item) -> Prepared | None:
    ext = os.path.splitext(item.path)[1].lower()
    doc_id = "unfetched-" + hashlib.sha1(f"{job_id}|{item.path}".encode()).hexdigest()
    data = b""

    def register(status: str, error: str | None = None) -> None:
        graph.run(
            graph.UPSERT_DOCUMENT, id=doc_id, path=item.path, key=item.key,
            mime=config.ALLOWED_TYPES.get(ext), bytes=len(data), jobId=job_id, status=status, error=error,
        )

    try:
        try:
            data = item.fetch()
        except Exception:
            log.exception("fetch failed job=%s path=%s", job_id, item.path)
            register("failed", "fetch_failed")
            return None
        doc_id = hashlib.sha256(data).hexdigest()
        known = graph.run(graph.DOCUMENT_STATUS, id=doc_id)
        if known and known[0]["status"] == "ingested":
            graph.run(graph.TOUCH_DOCUMENT, id=doc_id, jobId=job_id, path=item.path)  # unchanged file: no model calls
            return None
        register("processing")
        # Re-checked here: the manifest the browser sent is not proof of what was uploaded.
        if ext not in config.ALLOWED_TYPES:
            raise ParseError("unsupported_type")
        if len(data) > config.MAX_FILE_BYTES:
            raise ParseError("too_large")
        text, pages = parse(data, ext)
        chunks = chunk(text, doc_id, pages)
        embeddings = llm.embed([c.text for c in chunks])
        graph.run(graph.UPSERT_CHUNKS, docId=doc_id, chunks=[
            {"id": c.id, "text": c.text, "embedding": e, "order": c.order, "page": c.page}
            for c, e in zip(chunks, embeddings)
        ])
        facts = verify(extract(text, chunks, item.path), text, chunks)
        return Prepared(doc_id, item.path, facts, chunks, embeddings)
    except ParseError as exc:
        register("failed", str(exc))
    except llm.Refused:
        register("failed", "refused")
    except llm.BudgetExceeded:
        register("failed", "budget_exceeded")
    except Exception:
        log.exception("prepare failed job=%s path=%s", job_id, item.path)
        register("failed", "internal_error")
    finally:
        PENDING.get(job_id, set()).discard(item.path)
    return None


def _safe_prepare(job_id: str, item: Item) -> Prepared | None:
    try:
        return _prepare(job_id, item)
    except Exception:  # the graph itself is unreachable; nothing can be recorded
        log.exception("could not record outcome job=%s path=%s", job_id, item.path)
        return None


def run_job(job_id: str, items: list[Item]) -> None:
    PENDING[job_id] = {i.path for i in items}
    try:
        with ThreadPoolExecutor(config.INGEST_CONCURRENCY) as pool:
            prepared = [p for p in pool.map(lambda i: _safe_prepare(job_id, i), items) if p]
        for p in sorted(prepared, key=lambda p: p.facts["kind"] != "resume"):
            status, error, unresolved = "ingested", None, 0
            try:
                unresolved = write(p.doc_id, p.facts, p.chunks, p.embeddings)
                log.info(
                    "ingested job=%s path=%s kind=%s dropped_facts=%d unresolved_mentions=%d",
                    job_id, p.path, p.facts["kind"], p.facts["dropped"], unresolved,
                )
            except llm.BudgetExceeded:
                status, error = "failed", "budget_exceeded"
            except Exception:
                log.exception("write failed job=%s path=%s", job_id, p.path)
                status, error = "failed", "internal_error"
            graph.run(
                graph.SET_DOCUMENT_STATUS, id=p.doc_id, status=status, error=error,
                kind=p.facts["kind"], dropped=p.facts["dropped"], unresolved=unresolved,
            )
    finally:
        PENDING.pop(job_id, None)
        log.info("job done job=%s spend_today_usd=%.4f", job_id, llm.spent_today())


def status(job_id: str) -> dict:
    docs = graph.run(graph.JOB_DOCUMENTS, jobId=job_id)
    docs += [{"id": None, "path": p, "status": "queued", "error": None} for p in sorted(PENDING.get(job_id, ()))]
    counts: dict[str, int] = {}
    for d in docs:
        counts[d["status"]] = counts.get(d["status"], 0) + 1
    return {"jobId": job_id, "counts": counts, "documents": docs, "running": job_id in PENDING}
