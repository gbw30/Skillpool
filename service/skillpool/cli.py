"""Command line: database setup, local ingestion, evaluation, deletion."""
import argparse
import datetime
import json
import logging
import statistics
import time
import uuid
from pathlib import Path

from . import config, graph, llm, storage
from .ingest import job
from .ingest.upsert import refresh_embeddings
from .search import synthesize
from .search.retrieve import search
from .text import skill_id


def ingest_dir(root: Path, only: tuple[str, ...] = ("",)) -> dict:
    """Ingest every supported file under `root` (or its `only` subfolders) through the API's pipeline."""
    files = sorted(
        p for sub in only for p in (root / sub).rglob("*")
        if p.is_file() and p.suffix.lower() in config.ALLOWED_TYPES
    )
    job_id = uuid.uuid4().hex
    job.run_job(job_id, [job.Item(p.relative_to(root).as_posix(), None, p.read_bytes) for p in files])
    return job.status(job_id)


def reembed() -> dict:
    """Recompute every stored vector with the configured embedding model. No Claude calls.

    Run after changing EMBED_PROVIDER. Searches fail while it runs; if it stops part-way, run it again.
    """
    graph.reset_vectors()
    chunks = graph.run(graph.ALL_CHUNKS)
    for i in range(0, len(chunks), 256):
        part = chunks[i : i + 256]
        vectors = llm.embed([c["text"] for c in part])
        graph.run(graph.SET_CHUNK_EMBEDDINGS, rows=[{"id": c["id"], "embedding": v} for c, v in zip(part, vectors)])
    people = [r["id"] for r in graph.run(graph.ALL_PERSON_IDS)]
    refresh_embeddings(people)  # also embeds every skill, whose vectors were just cleared
    return {"model": config.EMBED_MODEL, "chunks": len(chunks), "people": len(people)}


def _pairs(n: int) -> int:
    return n * (n - 1) // 2


def identity_scores(truth: list[dict], subjects: dict[str, str], mentions: dict[tuple[str, str], str]) -> dict:
    """Pairwise precision and recall of person clusters over the labelled mentions.

    A labelled mention the graph has no person for counts as its own cluster, which costs recall.
    """
    by_truth: dict[str, int] = {}
    by_found: dict[str, int] = {}
    by_both: dict[tuple[str, str], int] = {}
    missing = 0
    for entry in truth:
        items = [subjects.get(entry["person"])] if entry.get("resume") else []
        items += [mentions.get((m["doc"], m["surface"].lower())) for m in entry["mentions"]]
        for found in items:
            if found is None:
                missing += 1
                found = f"missing-{missing}"
            by_truth[entry["person"]] = by_truth.get(entry["person"], 0) + 1
            by_found[found] = by_found.get(found, 0) + 1
            by_both[(entry["person"], found)] = by_both.get((entry["person"], found), 0) + 1
    hit = sum(_pairs(n) for n in by_both.values())
    same_found = sum(_pairs(n) for n in by_found.values())
    same_truth = sum(_pairs(n) for n in by_truth.values())
    return {
        "precision": hit / same_found if same_found else 1.0,
        "recall": hit / same_truth if same_truth else 1.0,
        "labelledMentions": sum(by_truth.values()),
        "mentionsNotInGraph": missing,
    }


def _p95(values: list[float]) -> float:
    return statistics.quantiles(values, n=20)[-1] if len(values) > 1 else (values[0] if values else 0.0)


def evaluate(corpus: Path) -> dict:
    """Ingest the corpus (a no-op when already ingested) and measure PRD section 8."""
    truth = corpus / "truth"
    spend_before = llm.spent_today()
    ingest = ingest_dir(corpus, only=("resumes", "generated"))
    ingest_spend = llm.spent_today() - spend_before

    subjects = {r["doc"]: r["person"] for r in graph.run(graph.EVAL_SUBJECTS)}
    mentions = {(r["doc"], r["surface"]): r["person"] for r in graph.run(graph.EVAL_MENTIONS)}
    report: dict = {
        "date": datetime.date.today().isoformat(),
        "model": config.CLAUDE_MODEL,
        "embedModel": config.EMBED_MODEL,
        "ingest": {"counts": ingest["counts"], "modelSpendUsd": round(ingest_spend, 4)},
        "totals": graph.run(graph.EVAL_TOTALS)[0],
        "identity": identity_scores(json.loads((truth / "people.json").read_text()), subjects, mentions),
    }

    planted = json.loads((truth / "injection.json").read_text())
    planted_skills = graph.run(graph.EVAL_SKILL_HOLDERS, ids=[skill_id(s) for s in planted["skills"]])[0]["n"]
    planted_names = {n.lower() for n in planted["people"]}
    planted_in_results = 0

    queries = json.loads((truth / "queries.json").read_text())
    spend_before = llm.spent_today()
    for mode in ("hybrid", "vector"):
        recalls: dict[str, list[float]] = {}
        to_results, to_answer, abstained, bad_citations = [], [], [], 0
        for query in queries:
            started = time.monotonic()
            results = search(query["q"], mode)
            to_results.append(time.monotonic() - started)
            got = [p["id"] for p in results["people"]]
            planted_in_results += sum(p["name"].lower() in planted_names for p in results["people"])
            if mode == "hybrid":  # the written answer is only produced for the real mode
                text = "".join(synthesize.answer(query["q"], results))
                to_answer.append(time.monotonic() - started)
                valid = {e["n"] for p in results["people"] for e in p["evidence"]}
                cited = {int(x) for m in synthesize._CITE.finditer(text) for x in m.group(1).split(",")}
                bad_citations += len(cited - valid)
            if query["tag"] == "none":
                abstained.append(results["confidence"] == "none")
                continue
            expected = {subjects[k] for k in query["expected"] if k in subjects}
            score = len(expected & set(got)) / min(len(query["expected"]), config.TOP_PEOPLE)
            recalls.setdefault(query["tag"], []).append(score)
            recalls.setdefault("overall", []).append(score)
        report[mode] = {
            "recallAt10": {tag: round(statistics.mean(v), 3) for tag, v in recalls.items()},
            "abstainedOnNoneQuestions": f"{sum(abstained)}/{len(abstained)}",
            "p95SecondsToResults": round(_p95(to_results), 2),
        }
        if mode == "hybrid":
            report[mode]["p95SecondsToAnswer"] = round(_p95(to_answer), 2)
            report[mode]["citationsNotInEvidence"] = bad_citations
    report["injection"] = {"plantedSkillLinks": planted_skills, "plantedPeopleInResults": planted_in_results}
    report["searchModelSpendUsd"] = round(llm.spent_today() - spend_before, 4)

    out = corpus / "eval" / f"{report['date']}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="skillpool")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db", help="create constraints and indexes")
    p = sub.add_parser("init-storage", help="create the bucket and allow the web origin to upload")
    p.add_argument("--origin", required=True, help="web app origin, e.g. http://localhost:3000")
    p = sub.add_parser("ingest-dir", help="ingest every PDF, TXT, and MD file under a folder")
    p.add_argument("dir", type=Path)
    p = sub.add_parser("eval", help="ingest a corpus and score it against corpus/truth")
    p.add_argument("corpus", type=Path)
    sub.add_parser("reembed", help="recompute all vectors after changing EMBED_PROVIDER")
    p = sub.add_parser("delete-document", help="remove a document and the facts only it supported")
    p.add_argument("id")
    args = parser.parse_args()

    if args.command == "init-db":
        graph.init_db()
        print("schema ready")
    elif args.command == "init-storage":
        storage.init_storage(args.origin)
        print("bucket ready")
    elif args.command == "ingest-dir":
        result = ingest_dir(args.dir)
        print(json.dumps({"counts": result["counts"], "modelSpendUsd": round(llm.spent_today(), 4)}))
        for doc in result["documents"]:
            if doc["status"] == "failed":
                print(f"failed: {doc['path']}: {doc['error']}")
    elif args.command == "eval":
        print(json.dumps(evaluate(args.corpus), indent=2))
    elif args.command == "reembed":
        print(json.dumps({**reembed(), "modelSpendUsd": round(llm.spent_today(), 4)}))
    elif args.command == "delete-document":
        print("deleted" if graph.delete_document(args.id) else "no such document")


if __name__ == "__main__":
    main()
