"""HTTP API. Only the web app calls it; every route except /healthz needs a valid signature."""
import json
import logging
import os
import re
import time
import uuid
from collections import deque
from functools import partial

from fastapi import BackgroundTasks, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import config, graph, llm, signing, storage
from .ingest import job
from .search import synthesize
from .search.retrieve import search
from .text import snippet

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("skillpool.api")
app = FastAPI(title="SkillPool service", docs_url=None, redoc_url=None, openapi_url=None)

_ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0]
    where = ".".join(str(x) for x in first["loc"][1:])
    return JSONResponse({"code": "invalid_request", "message": f"{where}: {first['msg']}"}, status_code=400)


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled error", exc_info=exc)
    return JSONResponse({"code": "internal_error", "message": "Something went wrong."}, status_code=500)


@app.middleware("http")
async def _trace(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or uuid.uuid4().hex
    started = time.monotonic()
    response = await call_next(request)
    response.headers["x-correlation-id"] = cid
    log.info("%s %s %s %dms cid=%s", request.method, request.url.path, response.status_code,
             (time.monotonic() - started) * 1000, cid)
    return response


async def signed(request: Request) -> None:
    ok = signing.verify(
        config.require("SERVICE_SIGNING_SECRET"),
        request.headers.get("x-timestamp", ""),
        request.headers.get("x-signature", ""),
        request.method,
        request.url.path,
        await request.body(),
    )
    if not ok:
        raise ApiError(401, "unauthorized", "Missing or invalid request signature.")


def _id(value: str) -> str:
    if not _ID.match(value):
        raise ApiError(400, "invalid_request", "Malformed id.")
    return value


# shortcut: per-process memory, reset on restart; use a shared store with more than one instance.
_hits: dict[str, deque] = {}


def allow(ip: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    if len(_hits) > 10_000:
        _hits.clear()
    window = _hits.setdefault(ip, deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= config.SEARCH_RATE_PER_MIN:
        return False
    window.append(now)
    return True


@app.get("/healthz")
def healthz() -> dict:
    try:
        graph.run("RETURN 1 AS ok")
        return {"ok": True, "database": True}
    except Exception:
        log.exception("database check failed")
        return {"ok": False, "database": False}


class FileEntry(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    size: int = Field(gt=0, le=config.MAX_FILE_BYTES)


class UploadRequest(BaseModel):
    files: list[FileEntry] = Field(min_length=1, max_length=config.MAX_FILES)


@app.post("/upload/session", dependencies=[Depends(signed)])
def upload_session(body: UploadRequest) -> dict:
    job_id = uuid.uuid4().hex
    uploads = []
    for i, f in enumerate(body.files):
        # The content type comes from the extension we allow, not from what the browser claims.
        content_type = config.ALLOWED_TYPES.get(os.path.splitext(f.path)[1].lower())
        if content_type is None:
            raise ApiError(400, "unsupported_type", f"{f.path}: only PDF, TXT, and MD files are accepted.")
        try:
            key = storage.object_key(job_id, i, f.path)
        except ValueError:
            raise ApiError(400, "invalid_request", f"{f.path}: not a usable file name.") from None
        uploads.append({"index": i, "path": storage.display_path(key), **storage.presign_upload(key, content_type, f.size)})
    return {"jobId": job_id, "expiresIn": config.UPLOAD_TTL_SECONDS, "uploads": uploads}


class JobRef(BaseModel):
    jobId: str = Field(pattern=r"^[0-9a-f]{32}$")


@app.post("/ingest", status_code=202, dependencies=[Depends(signed)])
def ingest(body: JobRef, background: BackgroundTasks) -> dict:
    if body.jobId in job.PENDING:
        raise ApiError(409, "conflict", "This batch is already being processed.")
    keys = storage.list_keys(f"jobs/{body.jobId}/")[: config.MAX_FILES]  # what actually landed
    if not keys:
        raise ApiError(400, "nothing_uploaded", "No uploaded files were found for this batch.")
    items = [job.Item(storage.display_path(k), k, partial(storage.fetch, k)) for k in keys]
    job.PENDING[body.jobId] = {i.path for i in items}  # visible as queued from the first poll
    background.add_task(job.run_job, body.jobId, items)
    return {"jobId": body.jobId, "accepted": len(items)}


@app.get("/jobs/{job_id}", dependencies=[Depends(signed)])
def job_status(job_id: str) -> dict:
    return job.status(_id(job_id))


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    mode: str = Field(default="hybrid", pattern="^(hybrid|vector)$")


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


@app.post("/search", dependencies=[Depends(signed)])
def search_route(body: SearchRequest, request: Request) -> StreamingResponse:
    if not allow(request.headers.get("x-client-ip", "unknown")):
        raise ApiError(429, "rate_limited", "Too many searches. Try again in a minute.")
    question = body.q.strip()

    def events():
        try:
            results = search(question, body.mode)
            yield _event("results", results)
            for piece in synthesize.answer(question, results):
                yield _event("answer", {"text": piece})
            yield _event("done", {})
        except llm.BudgetExceeded:
            yield _event("error", {"code": "budget_exceeded", "message": "Today's search budget is used up."})
        except Exception:
            log.exception("search failed")
            yield _event("error", {"code": "internal_error", "message": "Search failed. Try again."})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.get("/person/{person_id}", dependencies=[Depends(signed)])
def person(person_id: str) -> dict:
    rows = graph.run(graph.PERSON, id=_id(person_id))
    if not rows:
        raise ApiError(404, "not_found", "No such person.")
    evidence = graph.run(graph.PERSON_EVIDENCE, id=person_id)
    names = [rows[0]["name"], *(rows[0]["aliases"] or [])]
    return {**rows[0], "evidence": [{**e, "text": snippet(e["text"], names)} for e in evidence]}


@app.get("/documents/{doc_id}/url", dependencies=[Depends(signed)])
def document_url(doc_id: str) -> dict:
    rows = graph.run(graph.DOCUMENT_KEY, id=_id(doc_id))
    if not rows or not rows[0]["key"]:
        raise ApiError(404, "not_found", "The source file for this document is not stored.")
    return {"url": storage.presign_get(rows[0]["key"]), "path": rows[0]["path"]}


@app.delete("/documents/{doc_id}", dependencies=[Depends(signed)])
def delete_document(doc_id: str) -> dict:
    if not graph.delete_document(_id(doc_id)):
        raise ApiError(404, "not_found", "No such document.")
    return {"deleted": doc_id}


@app.get("/stats", dependencies=[Depends(signed)])
def stats() -> dict:
    return graph.run(graph.STATS)[0]
