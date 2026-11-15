"""HTTP layer: signatures, validation, rate limiting. Storage and the graph are stubbed."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from skillpool import api, config, graph, signing, storage

SECRET = "test-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SERVICE_SIGNING_SECRET", SECRET)
    monkeypatch.setattr(storage, "presign_upload", lambda key, ctype, size: {"url": "https://bucket", "fields": {"key": key, "Content-Type": ctype}})
    api._hits.clear()
    api._all.clear()
    return TestClient(api.app)


def call(client, method, path, body=None, secret=SECRET, headers=None):
    raw = json.dumps(body).encode() if body is not None else b""
    ts = str(int(time.time()))
    return client.request(method, path, content=raw, headers={
        "content-type": "application/json", "x-timestamp": ts,
        "x-signature": signing.sign(secret, ts, method, path, raw), **(headers or {}),
    })


def test_unsigned_and_wrongly_signed_requests_are_rejected(client):
    assert client.get("/stats").status_code == 401
    bad = call(client, "GET", "/stats", secret="wrong")
    assert bad.status_code == 401 and bad.json()["code"] == "unauthorized"


def test_upload_session_issues_one_upload_per_file(client):
    r = call(client, "POST", "/upload/session", {"files": [
        {"path": "team/Aaron Brown.pdf", "size": 1200}, {"path": "../notes.md", "size": 10},
    ]})
    assert r.status_code == 200
    body = r.json()
    job = body["jobId"]
    assert [u["fields"]["key"] for u in body["uploads"]] == [
        f"jobs/{job}/000/team/Aaron Brown.pdf", f"jobs/{job}/001/notes.md",
    ]
    assert body["uploads"][1]["fields"]["Content-Type"] == "text/markdown"


@pytest.mark.parametrize("files,code", [
    ([], "invalid_request"),
    ([{"path": "run.exe", "size": 10}], "unsupported_type"),
    ([{"path": "big.pdf", "size": config.MAX_FILE_BYTES + 1}], "invalid_request"),
    ([{"path": "a.pdf", "size": 0}], "invalid_request"),
    ([{"path": f"{i}.pdf", "size": 1} for i in range(config.MAX_FILES + 1)], "invalid_request"),
])
def test_upload_session_rejects_bad_manifests(client, files, code):
    r = call(client, "POST", "/upload/session", {"files": files})
    assert r.status_code == 400 and r.json()["code"] == code


def test_ingest_needs_uploaded_files(client, monkeypatch):
    monkeypatch.setattr(storage, "list_keys", lambda prefix: [])
    r = call(client, "POST", "/ingest", {"jobId": "0" * 32})
    assert r.status_code == 400 and r.json()["code"] == "nothing_uploaded"
    assert call(client, "POST", "/ingest", {"jobId": "../etc"}).status_code == 400


def test_search_is_rate_limited_per_client(client, monkeypatch):
    monkeypatch.setattr(api, "search", lambda q, mode: {"confidence": "none", "skills": [], "projects": [], "people": []})
    ip = {"x-client-ip": "203.0.113.9"}
    for _ in range(config.SEARCH_RATE_PER_MIN):
        assert call(client, "POST", "/search", {"q": "anyone?"}, headers=ip).status_code == 200
    assert call(client, "POST", "/search", {"q": "anyone?"}, headers=ip).status_code == 429
    assert call(client, "POST", "/search", {"q": "anyone?"}, headers={"x-client-ip": "203.0.113.10"}).status_code == 200


def test_search_streams_results_then_a_plain_statement_when_nothing_matches(client, monkeypatch):
    monkeypatch.setattr(api, "search", lambda q, mode: {"confidence": "none", "skills": [], "projects": [], "people": []})
    text = call(client, "POST", "/search", {"q": "COBOL?"}).text
    events = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event: ")]
    assert events == ["results", "answer", "done"] and "no one is recommended" in text


def test_search_validates_input(client):
    assert call(client, "POST", "/search", {"q": ""}).status_code == 400
    assert call(client, "POST", "/search", {"q": "x" * 501}).status_code == 400
    assert call(client, "POST", "/search", {"q": "x", "mode": "cypher"}).status_code == 400


def test_unknown_person_is_404(client, monkeypatch):
    monkeypatch.setattr(graph, "run", lambda query, **params: [])
    assert call(client, "GET", "/person/does-not-exist").status_code == 404


def test_search_is_limited_for_everyone_together(client, monkeypatch):
    monkeypatch.setattr(config, "SEARCH_RATE_TOTAL_PER_MIN", 3)
    # A new address every time, as a caller who fakes the address header would send.
    assert [api.allow(f"10.0.0.{i}", now=100.0) for i in range(5)] == [True, True, True, False, False]
    assert api.allow("10.0.0.9", now=161.0)  # a minute later
    assert len(api._hits) == 1  # addresses that went quiet are forgotten, never all at once


def test_a_body_over_the_limit_is_refused_before_the_signature_is_checked(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_REQUEST_BYTES", 1000)
    big = b"x" * 1001
    stated = client.post("/search", content=big, headers={"content-type": "application/json"})
    assert stated.status_code == 413 and stated.json()["code"] == "payload_too_large"

    def chunks():  # no stated length: counted as it arrives
        yield b"x" * 600
        yield b"x" * 600

    streamed = client.post("/search", content=chunks(), headers={"content-type": "application/json"})
    assert streamed.status_code == 413
    assert client.post("/search", content=b"x" * 1000, headers={"content-type": "application/json"}).status_code in (400, 401)


def test_odd_headers_are_refused_plainly(client):
    ts = str(int(time.time()))
    # A signature that is not ASCII is a wrong signature, not a crash.
    r = client.get("/stats", headers={"x-timestamp": ts, "x-signature": "\u00e9\u00e9".encode("utf-8")})
    assert r.status_code == 401
    # A correlation id of the wrong shape is replaced, not echoed back or logged.
    r = client.get("/healthz", headers={"x-correlation-id": "x" * 500})
    assert len(r.headers["x-correlation-id"]) == 32
    assert client.get("/healthz", headers={"x-correlation-id": "abc-123"}).headers["x-correlation-id"] == "abc-123"


def test_a_question_of_only_spaces_is_invalid(client):
    r = call(client, "POST", "/search", {"q": "   "})
    assert r.status_code == 400 and r.json()["code"] == "invalid_request"


def test_a_document_with_no_stored_file_opens_where_the_corpus_is_published(client, monkeypatch):
    doc = "ab" * 32
    monkeypatch.setattr(graph, "run", lambda query, **params: [{"key": None, "path": "resumes/Ana Lima.pdf"}])
    assert call(client, "GET", f"/documents/{doc}/url").status_code == 404
    monkeypatch.setattr(config, "SOURCE_BASE_URL", "https://example.org/corpus/")
    assert call(client, "GET", f"/documents/{doc}/url").json()["url"] == "https://example.org/corpus/resumes/Ana%20Lima.pdf"
    monkeypatch.setattr(graph, "run", lambda query, **params: [])
    assert call(client, "GET", f"/documents/{doc}/url").status_code == 404
