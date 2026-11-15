"""Write one document's verified facts to the graph. Runs one document at a time."""
import json

from .. import graph, llm
from ..text import skill_id, slug
from .chunk import Chunk
from .resolve import Context, Name, parse_name, resolve


def _mean(vectors: list[list[float]]) -> list[float] | None:
    return [sum(col) / len(vectors) for col in zip(*vectors)] if vectors else None


def _none(row: dict, *keys: str) -> dict:
    """Unknown strings arrive as ""; store them as missing."""
    return {**row, **{k: row[k] or None for k in keys}}


def _project_ref(org_ids: set[str], name: str, owner: str | None) -> tuple[str, str] | None:
    s = slug(name)
    if not s:
        return None
    if s in org_ids:
        return s, "org"
    return (f"{owner}:{s}", "personal") if owner else None


def _place(doc_id: str, person: dict, pid: str, resume: bool, org_ids: set[str]) -> None:
    """Record a placed person's mentions and what the document states about them."""
    if resume and person["isSubject"]:
        graph.run(graph.LINK_ABOUT, docId=doc_id, personId=pid)
    graph.run(graph.LINK_MENTIONS, personId=pid, mentions=person["mentions"])
    skills = [
        _none({**s, "id": skill_id(s["name"])}, "level") for s in person["skills"] if skill_id(s["name"])
    ]
    roles = [
        _none({**r, "orgId": slug(r["org"])}, "seniority", "start", "end")
        for r in person["roles"] if slug(r["org"])
    ]
    education = [
        _none({**e, "orgId": slug(e["school"])}, "start", "end")
        for e in person["education"] if slug(e["school"])
    ]
    projects = [
        _none({**pr, "id": ref[0], "scope": ref[1]}, "role", "contribution")
        for pr in person["projects"] if (ref := _project_ref(org_ids, pr["name"], pid))
    ]
    for query, rows in (
        (graph.UPSERT_SKILLS, skills), (graph.UPSERT_ROLES, roles),
        (graph.UPSERT_EDUCATION, education), (graph.UPSERT_PERSON_PROJECTS, projects),
    ):
        if rows:
            graph.run(query, personId=pid, rows=rows)


def write(doc_id: str, facts: dict, chunks: list[Chunk], embeddings: list[list[float]]) -> int:
    """Returns the number of mentions that could not be tied to a person."""
    resume = facts["kind"] == "resume"
    by_chunk = dict(zip((c.id for c in chunks), embeddings))
    text_of = {c.id: c.text for c in chunks}
    # A mention an earlier, failed write left waiting would be tried again beside this write's own
    # answer for it, and could then become a second person.
    graph.run(graph.CLEAR_DOC_PENDING, id=doc_id)

    # Projects a resume names are personal to its owner unless an organization project
    # with the same name already exists. shortcut: an org project created later does not
    # adopt earlier personal ones; ingest resumes first (run_job does) or re-link then.
    names = {pr["name"] for pr in facts["projects"]} | {pr["name"] for p in facts["people"] for pr in p["projects"]}
    slugs = {slug(n) for n in names} - {""}
    org_ids = {r["id"] for r in graph.run(graph.ORG_PROJECTS_BY_ID, ids=list(slugs))} if resume else slugs
    doc_skills = {skill_id(s["name"]) for p in facts["people"] for s in p["skills"]}
    doc_skills |= {skill_id(s["name"]) for pr in facts["projects"] for s in pr["skills"]}

    doc_people: list[tuple[Name, str]] = []
    touched: set[str] = set()
    subject: str | None = None
    unresolved = 0

    for person in sorted(facts["people"], key=lambda p: not p["isSubject"]):
        mention_chunks = list(dict.fromkeys(m["chunkId"] for m in person["mentions"]))
        ctx = Context(
            kind=facts["kind"],
            orgs={slug(r["org"]) for r in person["roles"]} - {""},
            projects=set() if resume else org_ids,
            roles={slug(pr["name"]): pr["role"] for pr in person["projects"] if pr["role"]},
            skills=doc_skills - {""},
            embedding=_mean([by_chunk[c] for c in mention_chunks] or embeddings),
            excerpt=text_of[mention_chunks[0]][:1500] if mention_chunks else chunks[0].text[:1500],
        )
        pid = resolve(person, ctx, doc_people)
        if pid is None:
            # Kept, so that a later document which settles who this is can still attach it.
            unresolved += 1
            graph.run(
                graph.SAVE_PENDING, id=f"{doc_id}|{person['name'] or ' '.join(person['emails'])}", docId=doc_id,
                facts=json.dumps(person),
                context=json.dumps({
                    "kind": ctx.kind, "orgs": sorted(ctx.orgs), "projects": sorted(ctx.projects), "roles": ctx.roles,
                    "skills": sorted(ctx.skills), "orgProjects": sorted(org_ids),
                }),
            )
            continue
        touched.add(pid)
        if name := parse_name(person["name"]):
            doc_people.append((name, pid))
        if resume and person["isSubject"]:
            subject = pid
        _place(doc_id, person, pid, resume, org_ids)

    rows = [
        _none(
            {**pr, "id": ref[0], "scope": ref[1],
             "skills": [{**s, "id": skill_id(s["name"])} for s in pr["skills"] if skill_id(s["name"])]},
            "description", "start", "end",
        )
        for pr in facts["projects"] if (ref := _project_ref(org_ids, pr["name"], subject))
    ]
    if rows:
        graph.run(graph.UPSERT_PROJECTS, rows=rows)

    refresh_embeddings(list(touched))
    return unresolved


def reconcile() -> int:
    """Try the mentions that are waiting again, now that more is known. Returns how many were placed.

    A mention waits when its name fits someone on record and nothing else confirmed it. A later
    document can supply what was missing, most often by putting that person on the project the
    mention came from. Nothing here asks the model, so waiting mentions cost nothing.
    shortcut: a resume's own project descriptions and dates are not stored when its subject is
    placed here instead of in `write`; that takes an email conflict on a resume. Re-ingest it then.
    shortcut: every waiting mention is tried after every batch; fine for hundreds, look them up
    by surname if a deployment ever holds many thousands.
    """
    placed: list[str] = []
    for row in graph.run(graph.PENDING):
        person, saved = json.loads(row["facts"]), json.loads(row["context"])
        found = graph.run(graph.CHUNK_VECTORS, ids=list(dict.fromkeys(m["chunkId"] for m in person["mentions"])))
        if not found:
            continue
        ctx = Context(
            kind=saved["kind"], orgs=set(saved["orgs"]), projects=set(saved["projects"]), roles=saved["roles"],
            skills=set(saved["skills"]), embedding=_mean([f["embedding"] for f in found]), excerpt=found[0]["text"][:1500],
        )
        here = [(n, r["id"]) for r in graph.run(graph.DOC_PEOPLE, docId=row["docId"]) if (n := parse_name(r["name"]))]
        pid = resolve(person, ctx, here, ask=False)
        if pid is None:
            continue
        _place(row["docId"], person, pid, saved["kind"] == "resume", set(saved["orgProjects"]))
        graph.run(graph.CLEAR_PENDING, id=row["id"], surfaces=[m["surface"] for m in person["mentions"]])
        placed.append(pid)
    refresh_embeddings(placed)
    return len(placed)


def profile_text(row: dict) -> str:
    parts = [row["name"], row["title"] or ""]
    for label, key in (("Skills", "skills"), ("Roles", "roles"), ("Projects", "projects")):
        if row[key]:
            parts.append(f"{label}: " + ", ".join(sorted(set(row[key]))))
    return ". ".join(p for p in parts if p)


def refresh_embeddings(person_ids: list[str]) -> None:
    """Recompute profile text and vectors for people whose facts changed, and embed new skills."""
    profiles = graph.run(graph.PROFILE_ROWS, ids=person_ids) if person_ids else []
    skills = graph.run(graph.SKILLS_WITHOUT_EMBEDDING)
    texts = [profile_text(r) for r in profiles]
    vectors = llm.embed(texts + [s["name"] for s in skills]) if profiles or skills else []
    if profiles:
        graph.run(graph.SET_PROFILES, rows=[
            {"id": r["id"], "text": t, "embedding": v} for r, t, v in zip(profiles, texts, vectors)
        ])
    if skills:
        graph.run(graph.SET_SKILL_EMBEDDINGS, rows=[
            {"id": s["id"], "embedding": v} for s, v in zip(skills, vectors[len(profiles):])
        ])
