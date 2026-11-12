"""Pure logic. No network, no database."""
import time

import httpx
import pymupdf
import pytest

from skillpool import config, llm, signing, storage
from skillpool.cli import identity_scores
from skillpool.ingest.chunk import chunk
from skillpool.ingest.extract import Extraction, PersonFacts, ProjectDef, ProjectSkill, SkillFact
from skillpool.ingest.parse import ParseError, parse
from skillpool.ingest.resolve import Context, Name, better_name, decide, name_match, parse_name, score
from skillpool.ingest.verify import Locator, verify
from skillpool.search.fuse import rrf
from skillpool.search.synthesize import check_sentence, validated
from skillpool.text import skill_id, slug, snippet


# --- chunking ---------------------------------------------------------------

def test_short_document_is_one_chunk():
    chunks = chunk("Aaron Brown\nSkills\nDocker", "doc")
    assert [c.text for c in chunks] == ["Aaron Brown\nSkills\nDocker"]


def test_empty_document_has_no_chunks():
    assert chunk("  \n ", "doc") == []


def test_chunks_cover_the_text_overlap_and_keep_the_tail():
    text = " ".join(f"word{i}" for i in range(2000))
    chunks = chunk(text, "doc", size=1000, overlap=100)
    assert chunks[0].start == 0 and chunks[-1].end == len(text)
    assert all(text[c.start : c.end] == c.text for c in chunks)
    assert all(b.start < a.end for a, b in zip(chunks, chunks[1:]))  # overlap, no gaps
    assert len({c.id for c in chunks}) == len(chunks)


def test_chunk_prefers_to_break_at_a_heading():
    text = "a " * 400 + "\nSkills\n" + "b " * 400
    first = chunk(text, "doc", size=1000, overlap=50)[0]
    assert first.text.endswith("a \n")


def test_chunk_records_the_page():
    chunks = chunk("x" * 30 + "y" * 30, "doc", page_starts=[0, 30], size=30, overlap=5)
    assert chunks[0].page == 1 and chunks[-1].page == 2


# --- parsing ----------------------------------------------------------------

def _pdf(text: str) -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((50, 60), text)
    return doc.tobytes()


def test_parse_pdf_and_text():
    text, pages = parse(_pdf("Hello resume"), ".pdf")
    assert "Hello resume" in text and pages == [0]
    assert parse("café".encode(), ".md") == ("café", [])


@pytest.mark.parametrize("data,ext,reason", [
    (b"not a pdf", ".pdf", "type_mismatch"),
    (b"\x00\x01binary", ".txt", "type_mismatch"),
    (b"\xff\xfe\xfa", ".txt", "not_utf8"),
    (b"   \n", ".txt", "no_text"),
])
def test_parse_rejects_bad_input(data, ext, reason):
    with pytest.raises(ParseError, match=reason):
        parse(data, ext)


def test_pdf_text_is_capped_like_a_text_file(monkeypatch):
    monkeypatch.setattr(config, "MAX_FILE_BYTES", 5)
    with pytest.raises(ParseError, match="too_large"):
        parse(_pdf("Hello resume"), ".pdf")


# --- quote verification -----------------------------------------------------

def _facts(text, people=(), projects=()):
    return verify(Extraction(kind="resume", people=list(people), projects=list(projects)), text, chunk(text, "doc"))


def _person(name="Aaron Brown", aliases=(), emails=(), skills=()):
    return PersonFacts(name=name, aliases=list(aliases), emails=list(emails), title="", isSubject=True,
                       skills=list(skills), roles=[], education=[], projects=[])


def test_quote_is_found_across_a_line_break():
    text = "Deployed applications\non cloud   platforms."
    chunks = chunk(text, "doc")
    assert Locator(text, chunks).sources("applications on cloud platforms") == [chunks[0].id]


def test_fact_without_a_verbatim_quote_is_dropped():
    text = "Aaron Brown\nSkills\nDocker, expert"
    facts = _facts(text, [_person(skills=[
        SkillFact(name="Docker", level="expert", quote="Docker, expert"),
        SkillFact(name="Kubernetes", level="", quote="Kubernetes, expert"),  # not in the text
    ])])
    assert [s["name"] for s in facts["people"][0]["skills"]] == ["Docker"]
    assert facts["dropped"] == 1


def test_person_the_document_never_names_is_dropped():
    facts = _facts("Only Aaron Brown is here.", [_person(), _person(name="Zed Nobody")])
    assert [p["name"] for p in facts["people"]] == ["Aaron Brown"] and facts["dropped"] == 1


def test_email_written_as_a_name_becomes_an_email():
    facts = _facts("Contact A.Brown@Example.com about it.", [_person(name="A.Brown@Example.com")])
    person = facts["people"][0]
    assert person["name"] == "" and person["emails"] == ["a.brown@example.com"]
    assert person["mentions"][0]["surface"] == "a.brown@example.com"


def test_quote_spanning_two_chunks_cites_both():
    text = "x" * 50 + " the quoted span " + "y" * 50
    chunks = chunk(text, "doc", size=60, overlap=5)
    assert len(Locator(text, chunks).sources("the quoted span")) == 2


def test_project_must_be_named_in_the_text():
    text = "Atlas Migration uses Kafka."
    facts = _facts(text, projects=[
        ProjectDef(name="Atlas Migration", description="", start="", end="",
                   skills=[ProjectSkill(name="Kafka", quote="uses Kafka")]),
        ProjectDef(name="Phantom Project", description="", start="", end="", skills=[]),
    ])
    assert [p["name"] for p in facts["projects"]] == ["Atlas Migration"]
    assert facts["projects"][0]["skills"][0]["sources"]


# --- names and identity -----------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("Aaron Brown", Name("aaron", "brown")),
    ("Brown, Aaron", Name("aaron", "brown")),
    ("A. Brown", Name("a", "brown")),
    ("Dr. Adam Larsen MD", Name("adam", "larsen")),
    ("Adam Larsen, MD", Name("adam", "larsen")),
    ("Anthony Blackburn III", Name("anthony", "blackburn")),
    ("Aaron", Name("aaron", "")),
    ("aaron@example.com", None),
    ("", None),
])
def test_parse_name(raw, expected):
    assert parse_name(raw) == expected


def test_name_match():
    full, initial = Name("aaron", "brown"), Name("a", "brown")
    assert name_match(full, Name("aaron", "brown")) == "exact"
    assert name_match(full, initial) == "initial" and name_match(initial, full) == "initial"
    assert name_match(full, Name("alan", "brown")) is None
    assert name_match(full, Name("aaron", "browne")) is None
    assert name_match(Name("aaron", ""), full) is None  # a first name alone never blocks by surname


def test_better_name_prefers_the_fuller_form():
    assert better_name("A. Brown", "Brown, Aaron") == "Aaron Brown"
    assert better_name("Aaron Brown", "A. Brown") == "Aaron Brown"


def _ctx(**kw):
    return Context(**{"kind": "project_doc", "orgs": set(), "projects": set(), "roles": {}, "skills": set(),
                      "embedding": None, "excerpt": "", **kw})


def _cand(**kw):
    return {"orgs": [], "projects": [], "skills": [], "embedding": None, "title": None, "emails": [], **kw}


def test_score_counts_evidence_beyond_the_name():
    assert score("", [], _ctx(), _cand()) == 0
    on_atlas = _cand(projects=[{"id": "atlas", "role": "Tech Lead"}])
    assert score("", [], _ctx(projects={"atlas"}), on_atlas) == 0.5
    assert score("", [], _ctx(projects={"atlas"}, roles={"atlas": "tech lead"}), on_atlas) == 0.8
    assert score("Analyst", [], _ctx(), _cand(title="analyst")) == pytest.approx(0.2)


def test_conflicting_emails_count_against_a_merge():
    assert score("", ["a@x.com"], _ctx(projects={"atlas"}), _cand(projects=[{"id": "atlas", "role": None}], emails=["b@y.com"])) < 0


def test_decide():
    assert decide([]) == ("new", [])
    # A name match with nothing else never merges.
    assert decide([("p1", "exact", 0.0)]) == ("flag", ["p1"])
    # Evidence against (say, a different email) means a new person, not a flag.
    assert decide([("p1", "exact", -0.4)]) == ("new", [])
    assert decide([("p1", "exact", config.MERGE_SCORE_EXACT)]) == ("merge", ["p1"])
    # An initial needs more than a full name does.
    assert decide([("p1", "initial", config.MERGE_SCORE_EXACT)])[0] == "ask"
    # Two close candidates are never merged without asking.
    assert decide([("p1", "exact", 0.6), ("p2", "exact", 0.55)]) == ("ask", ["p1", "p2"])


def test_identity_scores():
    truth = [
        {"person": "a", "resume": True, "mentions": [{"doc": "d1", "surface": "A. Brown"}, {"doc": "d2", "surface": "Aaron"}]},
        {"person": "b", "resume": True, "mentions": [{"doc": "d1", "surface": "Bea Wu"}]},
    ]
    subjects = {"a": "P1", "b": "P2"}
    perfect = {("d1", "a. brown"): "P1", ("d2", "aaron"): "P1", ("d1", "bea wu"): "P2"}
    assert identity_scores(truth, subjects, perfect)["precision"] == 1.0
    assert identity_scores(truth, subjects, perfect)["recall"] == 1.0
    merged_wrongly = {**perfect, ("d1", "bea wu"): "P1"}
    assert identity_scores(truth, subjects, merged_wrongly)["precision"] < 1.0
    missed = {k: v for k, v in perfect.items() if k != ("d2", "aaron")}
    scores = identity_scores(truth, subjects, missed)
    assert scores["precision"] == 1.0 and scores["recall"] < 1.0 and scores["mentionsNotInGraph"] == 1


# --- text helpers -----------------------------------------------------------

def test_skill_ids_keep_distinct_skills_apart():
    assert skill_id("JS") == skill_id("JavaScript") == "javascript"
    assert skill_id("k8s") == "kubernetes"
    assert skill_id("Java") != skill_id("JavaScript")
    assert {slug("C++"), slug("C#"), slug("C")} == {"c++", "c#", "c"}
    assert slug("CI/CD") == "ci-cd" and slug("Node.js") == "node.js"


def test_snippet_centres_on_the_term():
    text = "start " + "filler " * 200 + "the Kafka cluster " + "filler " * 200
    assert "Kafka" in snippet(text, ["Kafka"]) and len(snippet(text, ["Kafka"])) < 520
    assert snippet("short text", ["absent"]) == "short text"


# --- search -----------------------------------------------------------------

def test_rrf_rewards_agreement():
    assert rrf([["a", "b", "c"], ["c", "a"], ["c"]], k=60)[:2] == ["c", "a"]
    assert rrf([[], []], k=60) == []


def test_citations_outside_the_evidence_are_removed():
    valid = {1, 2}
    assert check_sentence("Aaron knows Docker [1][7].", valid) == "Aaron knows Docker [1]."
    assert check_sentence("Aaron knows Docker [1, 9].", valid) == "Aaron knows Docker [1]."
    assert check_sentence("Bea leads Atlas [9].", valid) is None  # every citation was invalid
    assert check_sentence("Here are the candidates.", valid) == "Here are the candidates."


def test_stream_is_validated_sentence_by_sentence():
    deltas = ["Aaron knows Do", "cker [1]. Bea le", "ads Atlas [9]. Cal fits [2]."]
    assert "".join(validated(iter(deltas), {1, 2})) == "Aaron knows Docker [1]. Cal fits [2]."


# --- signing and storage ----------------------------------------------------

def test_signature_round_trip_and_tampering():
    ts = str(int(time.time()))
    sig = signing.sign("secret", ts, "POST", "/search", b'{"q":"x"}')
    assert signing.verify("secret", ts, sig, "POST", "/search", b'{"q":"x"}')
    assert not signing.verify("secret", ts, sig, "POST", "/search", b'{"q":"y"}')  # body changed
    assert not signing.verify("secret", ts, sig, "POST", "/stats", b'{"q":"x"}')  # replayed elsewhere
    assert not signing.verify("other", ts, sig, "POST", "/search", b'{"q":"x"}')
    assert not signing.verify("secret", "nonsense", sig, "POST", "/search", b"")


def test_signature_expires():
    old = str(int(time.time()) - config.SIGNATURE_SKEW_SECONDS - 5)
    sig = signing.sign("secret", old, "GET", "/stats", b"")
    assert not signing.verify("secret", old, sig, "GET", "/stats", b"")


def test_object_keys_cannot_escape_the_job_prefix():
    assert storage.object_key("job", 3, "../../etc/passwd") == "jobs/job/003/etc/passwd"
    assert storage.object_key("job", 0, "team docs/résumé (1).pdf") == "jobs/job/000/team docs/r_sum_ _1_.pdf"
    assert storage.display_path("jobs/job/000/a/b.pdf") == "a/b.pdf"
    with pytest.raises(ValueError):
        storage.object_key("job", 0, "../..")


# --- embedding providers -----------------------------------------------------

def test_voyage_embeddings_retry_keep_order_and_mark_questions(monkeypatch):
    sent, replies = [], [
        httpx.Response(429, request=httpx.Request("POST", "https://x")),
        httpx.Response(200, request=httpx.Request("POST", "https://x"), json={
            "data": [{"index": 1, "embedding": [2.0]}, {"index": 0, "embedding": [1.0]}], "usage": {"total_tokens": 7},
        }),
    ]

    def post(url, json, headers, timeout):
        sent.append((url, json, headers))
        return replies[len(sent) - 1]

    monkeypatch.setenv("VOYAGE_API_KEY", "key")
    monkeypatch.setattr(config, "EMBED_MODEL", "voyage-4-lite")
    monkeypatch.setattr(llm.httpx, "post", post)
    monkeypatch.setattr(llm.time, "sleep", lambda seconds: None)
    assert llm._embed_voyage(["a", "b"], query=True) == ([[1.0], [2.0]], 7)
    url, body, headers = sent[1]
    assert len(sent) == 2 and url == "https://api.voyageai.com/v1/embeddings" and headers == {"Authorization": "Bearer key"}
    assert body == {"model": "voyage-4-lite", "input": ["a", "b"], "input_type": "query"}
    assert llm._voyage_url("al-abc") == "https://ai.mongodb.com/v1/embeddings"


def test_embed_charges_the_selected_provider_and_batches(monkeypatch):
    calls, charged = [], []
    monkeypatch.setattr(llm, "_model_checked", True)
    monkeypatch.setattr(llm, "_check_budget", lambda: None)
    monkeypatch.setattr(llm, "_charge", charged.append)
    monkeypatch.setattr(config, "EMBED_PROVIDER", "voyage")
    monkeypatch.setitem(llm._EMBED, "voyage", lambda texts, query: (calls.append((len(texts), query)) or [[0.0]] * len(texts), 1_000_000))
    assert len(llm.embed(["t"] * 70)) == 70 and llm.embed([]) == []
    assert calls == [(64, False), (6, False)] and charged == [config.PRICE_EMBED] * 2


def test_each_embedding_provider_is_fully_described():
    assert set(config.EMBEDDERS) == set(llm._EMBED)
    assert config.EMBEDDERS[config.EMBED_PROVIDER] == (config.EMBED_MODEL, config.EMBED_DIM, config.PRICE_EMBED)
