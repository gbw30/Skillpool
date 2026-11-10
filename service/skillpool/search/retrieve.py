"""Three ranked lists of people (text similarity, direct skill, project path), fused."""
from itertools import chain, zip_longest

from .. import config, graph
from ..text import snippet
from .fuse import rrf
from .query import understand

_LEVELS = {"beginner": 1, "intermediate": 2, "advanced": 3, "expert": 4, "fluent": 4}


def _interleave(*lists: list[str]) -> list[str]:
    """Round-robin, so evidence comes from each kind of match before repeating one."""
    merged = (x for x in chain.from_iterable(zip_longest(*lists)) if x)
    return list(dict.fromkeys(merged))


def search(question: str, mode: str = "hybrid") -> dict:
    vector, skills, projects = understand(question, mode)
    skill_ids = [s["id"] for s in skills]
    project_ids = [p["id"] for p in projects]

    by_text = graph.run(
        graph.VECTOR_PEOPLE, k=config.VECTOR_K, embedding=vector, floor=config.VECTOR_FLOOR
    )
    direct = graph.run(graph.DIRECT_SKILL, skills=skill_ids) if skill_ids else []
    direct.sort(key=lambda r: (
        -len(r["matches"]), -sum(_LEVELS.get((m["level"] or "").lower(), 0) for m in r["matches"]), r["id"],
    ))
    path_rows = graph.run(graph.PROJECT_PATH, projects=project_ids, skills=skill_ids) if skill_ids or project_ids else []
    paths: dict[str, list[dict]] = {}
    for row in path_rows:
        paths.setdefault(row["id"], []).append(row)

    def path_strength(pid: str) -> tuple[int, int]:
        rows = paths[pid]
        return sum(r["named"] for r in rows), len({u["skill"] for r in rows for u in r["used"]})

    by_path = sorted(paths, key=lambda pid: (*(-x for x in path_strength(pid)), pid))

    top = rrf([[r["id"] for r in by_text], [r["id"] for r in direct], by_path], config.RRF_K)
    top = top[: config.TOP_PEOPLE]
    if not top:
        return {"confidence": "none", "skills": skills, "projects": projects, "people": []}

    text_hits = {r["id"]: r["chunkIds"] for r in by_text}
    direct_hits = {r["id"]: r["matches"] for r in direct}
    wanted: dict[str, list[str]] = {}
    for pid in top:
        from_paths = [s for r in paths.get(pid, []) for s in (*(r["sources"] or []), *(x for u in r["used"] for x in u["sources"] or []))]
        from_skills = [s for m in direct_hits.get(pid, []) for s in m["sources"] or []]
        wanted[pid] = _interleave(from_paths, from_skills, text_hits.get(pid, []))[: config.EVIDENCE_PER_PERSON]

    cards = {r["id"]: r for r in graph.run(graph.PEOPLE_CARDS, ids=top)}
    chunks = {r["chunkId"]: r for r in graph.run(graph.CHUNKS_BY_ID, ids=list(set(chain.from_iterable(wanted.values()))))}

    people, n = [], 0
    for pid in top:
        card = cards[pid]
        terms = [m["skill"] for m in direct_hits.get(pid, [])]
        terms += [x for r in paths.get(pid, []) for x in (*(u["skill"] for u in r["used"]), r["project"])]
        terms.append(card["name"])
        evidence = []
        for cid in wanted[pid]:
            if cid in chunks:
                n += 1
                c = chunks[cid]
                evidence.append({"n": n, "chunkId": cid, "docId": c["docId"], "path": c["path"], "text": snippet(c["text"], terms)})
        people.append({
            "id": pid,
            "name": card["name"],
            "title": card["title"],
            "matchedSkills": [{"name": m["skill"], "level": m["level"]} for m in direct_hits.get(pid, [])],
            "paths": [
                f"{card['name']} → worked on → {r['project']}"
                + (f" → used → {', '.join(sorted(u['skill'] for u in r['used']))}" if r["used"] else "")
                for r in paths.get(pid, [])[:3]
            ],
            "evidence": evidence,
        })
    return {"confidence": "ok", "skills": skills, "projects": projects, "people": people}
