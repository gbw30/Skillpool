"""HTTP API. Only the web app calls it; every route except /healthz needs a valid signature."""
import datetime
import hashlib
import hmac
import json
import logging
import os
import re
import time
import uuid
from collections import deque
from functools import partial
from typing import Annotated
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StringConstraints

from . import config, graph, llm, signing, storage
from .ingest import job
from .search import synthesize
from .search.retrieve import search
from .text import snippet

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("skillpool.api")
app = FastAPI(title="SkillPool service", docs_url=None, redoc_url=None, openapi_url=None)

_ID = re.compile(r"[A-Za-z0-9-]{1,80}")
_TOO_LARGE = {"code": "payload_too_large", "message": "Request body is too large."}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: int | None = None):
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status, headers=headers)


@app.exception_handler(RequestValidationError)
async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0]
    where = ".".join(str(x) for x in first["loc"][1:])
    return JSONResponse({"code": "invalid_request", "message": f"{where}: {first['msg']}"}, status_code=400)


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled error", exc_info=exc)
    return JSONResponse({"code": "internal_error", "message": "Something went wrong."}, status_code=500)


class _BodyLimit:
    """Refuse a request body over MAX_REQUEST_BYTES, by its stated length and by the bytes that arrive.

    Runs before the signature check, which has to read the whole body: without this, anyone who
    can reach the service could make it buffer any amount without knowing the secret.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner(scope, receive, send)
        stated = dict(scope["headers"]).get(b"content-length", b"0")
        if not stated.isdigit() or int(stated) > config.MAX_REQUEST_BYTES:
            return await JSONResponse(_TOO_LARGE, status_code=413)(scope, receive, send)
        seen, over = 0, False

        async def counted():
            nonlocal seen, over
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > config.MAX_REQUEST_BYTES:
                    over = True  # stop reading here; whatever the app answers is replaced below
                    raise ApiError(413, _TOO_LARGE["code"], _TOO_LARGE["message"])
            return message

        async def reply(message):
            if not over:
                await send(message)
            elif message["type"] == "http.response.start":
                await JSONResponse(_TOO_LARGE, status_code=413)(scope, receive, send)

        await self.inner(scope, counted, reply)


app.add_middleware(_BodyLimit)


@app.middleware("http")
async def _trace(request: Request, call_next):
    # Only an id of the expected shape is echoed and logged; anything else is replaced.
    sent = request.headers.get("x-correlation-id", "")
    cid = sent if re.fullmatch(r"[A-Za-z0-9-]{1,64}", sent) else uuid.uuid4().hex
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
    # Reads need no model call but each reaches the database, so they get a limit of their own.
    if request.method == "GET" and not allow(request.headers.get("x-client-ip", "unknown"), kind="read"):
        raise ApiError(429, "rate_limited", "Too many requests. Try again in a minute.", retry_after=60)


def _id(value: str) -> str:
    if not _ID.fullmatch(value):
        raise ApiError(400, "invalid_request", "Malformed id.")
    return value


# shortcut: per-process memory, reset on restart; use a shared store with more than one instance.
# Per kind of request: the addresses seen in the last minute, and everyone's requests together.
_windows: dict[str, tuple[dict[str, deque], deque]] = {"search": ({}, deque()), "read": ({}, deque())}


def allow(ip: str, now: float | None = None, kind: str = "search") -> bool:
    """One more request of this kind for this address? Limited per address and for everyone together."""
    per, total = ((config.SEARCH_RATE_PER_MIN, config.SEARCH_RATE_TOTAL_PER_MIN) if kind == "search"
                  else (config.READ_RATE_PER_MIN, config.READ_RATE_TOTAL_PER_MIN))
    _hits, _all = _windows[kind]
    now = time.monotonic() if now is None else now
    while _all and now - _all[0] > 60:
        _all.popleft()
    # Addresses seen in the last minute only: at most SEARCH_RATE_TOTAL_PER_MIN of them, never cleared wholesale.
    for stale in [key for key, times in _hits.items() if not times or now - times[-1] > 60]:
        del _hits[stale]
    window = _hits.setdefault(ip, deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= per or len(_all) >= total:
        return False
    window.append(now)
    _all.append(now)
    return True


_counted_day = ""


def searches_today(ip: str) -> int:
    """Count one more search for this address today, and return the day's total. Stored in the
    graph, so the free host's sleep and restart do not reset it. The address is kept only as a
    hash keyed with the signing secret and the day, and earlier days are deleted."""
    global _counted_day
    day = datetime.date.today().isoformat()  # the server's day, as the spend cap counts it
    if day != _counted_day:
        graph.run(graph.FORGET_SEARCH_COUNTS, day=day)
        _counted_day = day
    digest = hmac.new(config.require("SERVICE_SIGNING_SECRET").encode(), f"{day}|{ip}".encode(), hashlib.sha256)
    return graph.run(graph.COUNT_SEARCH, key=f"{day}|{digest.hexdigest()[:32]}", day=day)[0]["n"]


def _until_tomorrow() -> int:
    now = datetime.datetime.now()
    return int((datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time()) - now).total_seconds()) + 1


_health = [0.0, False]  # when the database was last asked, and its answer


@app.get("/healthz")
def healthz() -> dict:
    # Unsigned, so anyone can call it: ask the database at most every 30 seconds. The question asked
    # also deletes earlier days' search counts, so they go even on a day nobody searches.
    if time.monotonic() - _health[0] > 30:
        try:
            graph.run(graph.FORGET_SEARCH_COUNTS, day=datetime.date.today().isoformat())
            _health[:] = [time.monotonic(), True]
        except Exception:
            log.exception("database check failed")
            _health[:] = [time.monotonic(), False]
    return {"ok": _health[1], "database": _health[1]}


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
    q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    mode: str = Field(default="hybrid", pattern="^(hybrid|vector)$")


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


@app.post("/search", dependencies=[Depends(signed)])
def search_route(body: SearchRequest, request: Request) -> StreamingResponse:
    ip = request.headers.get("x-client-ip", "unknown")
    if not allow(ip):
        raise ApiError(429, "rate_limited", "Too many searches. Try again in a minute.", retry_after=60)
    if searches_today(ip) > config.SEARCH_RATE_PER_DAY:
        raise ApiError(429, "daily_limit", f"You have used today's {config.SEARCH_RATE_PER_DAY} searches. "
                       "They start again at midnight UTC.", retry_after=_until_tomorrow())
    question = body.q

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
    if rows and rows[0]["key"]:
        return {"url": storage.presign_get(rows[0]["key"]), "path": rows[0]["path"]}
    if rows and config.SOURCE_BASE_URL:  # loaded with ingest-dir: read it where the folder is published
        return {"url": f"{config.SOURCE_BASE_URL.rstrip('/')}/{quote(rows[0]['path'])}", "path": rows[0]["path"]}
    raise ApiError(404, "not_found", "The source file for this document is not stored.")


@app.delete("/documents/{doc_id}", dependencies=[Depends(signed)])
def delete_document(doc_id: str) -> dict:
    if not graph.delete_document(_id(doc_id)):
        raise ApiError(404, "not_found", "No such document.")
    return {"deleted": doc_id}


@app.get("/graph", dependencies=[Depends(signed)])
def graph_view() -> dict:
    return graph.overview(config.GRAPH_VIEW_LINKS)


@app.get("/stats", dependencies=[Depends(signed)])
def stats() -> dict:
    return graph.run(graph.STATS)[0]
