"""Neo4j driver, schema, and every Cypher statement the service runs.

All statements are fixed text with parameters; nothing here is built from user or model input.
"""
import os

import neo4j

from . import config

_driver: neo4j.Driver | None = None


def driver() -> neo4j.Driver:
    global _driver
    if _driver is None:
        _driver = neo4j.GraphDatabase.driver(
            config.require("NEO4J_URI"),
            auth=(os.environ.get("NEO4J_USERNAME", "neo4j"), config.require("NEO4J_PASSWORD")),
            # Silences "relationship type does not exist" hints on a graph that is still empty.
            notifications_min_severity="OFF",
        )
    return _driver


def run(query: str, **params) -> list[dict]:
    records, _, _ = driver().execute_query(
        query, parameters_=params, database_=os.environ.get("NEO4J_DATABASE", "neo4j")
    )
    return [r.data() for r in records]


def _vector_index(name: str, label: str, prop: str) -> str:
    return (
        f"CREATE VECTOR INDEX {name} IF NOT EXISTS FOR (n:{label}) ON (n.{prop}) "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {config.EMBED_DIM}, "
        "`vector.similarity_function`: 'cosine'}}"
    )


_VECTOR_INDEXES = (
    ("chunk_embedding_idx", "Chunk", "embedding"),
    ("person_profile_idx", "Person", "profileEmbedding"),
    ("skill_embedding_idx", "Skill", "embedding"),
)

SCHEMA = [
    *(
        f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE"
        for label in ("Person", "Skill", "Project", "Organization", "Document", "Chunk", "Meta")
    ),
    "CREATE CONSTRAINT spend_day IF NOT EXISTS FOR (n:Spend) REQUIRE n.day IS UNIQUE",
    "CREATE INDEX person_surname IF NOT EXISTS FOR (n:Person) ON (n.surnameKey)",
    "CREATE INDEX document_job IF NOT EXISTS FOR (n:Document) ON (n.jobId)",
]

# The embedding model the stored vectors and index sizes belong to, recorded on first use.
EMBEDDING_MODEL = "MERGE (m:Meta {id: 'embedding'}) ON CREATE SET m.model = $model RETURN m.model AS model"

SET_EMBEDDING_MODEL = "MERGE (m:Meta {id: 'embedding'}) SET m.model = $model"

VECTOR_INDEX_SIZES = """
SHOW INDEXES YIELD type, options WHERE type = 'VECTOR'
RETURN DISTINCT options.indexConfig['vector.dimensions'] AS size
"""

CLEAR_VECTORS = "MATCH (n) WHERE n:Chunk OR n:Person OR n:Skill REMOVE n.embedding, n.profileEmbedding"


class EmbeddingMismatch(Exception):
    pass


def check_embedding_model() -> None:
    """Refuse to mix vectors from two embedding models: they cannot be compared with each other."""
    stored = run(EMBEDDING_MODEL, model=config.EMBED_MODEL)[0]["model"]
    # The index sizes are checked too: emptying the graph removes the record but keeps the indexes.
    sizes = [r["size"] for r in run(VECTOR_INDEX_SIZES)]
    if stored != config.EMBED_MODEL or any(size != config.EMBED_DIM for size in sizes):
        raise EmbeddingMismatch(
            f"this database is set up for {stored} vectors (index sizes {sizes}) but EMBED_PROVIDER selects "
            f"{config.EMBED_MODEL} ({config.EMBED_DIM}). Run `skillpool reembed` to convert it, or set EMBED_PROVIDER back."
        )


def init_db() -> None:
    for statement in (*SCHEMA, *(_vector_index(*index) for index in _VECTOR_INDEXES)):
        run(statement)
    run("CALL db.awaitIndexes(120)")
    check_embedding_model()


def reset_vectors() -> None:
    """Drop every stored vector and rebuild the indexes at the configured model's size."""
    for name, _, _ in _VECTOR_INDEXES:
        run(f"DROP INDEX {name} IF EXISTS")
    run(CLEAR_VECTORS)
    run(SET_EMBEDDING_MODEL, model=config.EMBED_MODEL)
    init_db()


# Appends new chunk ids to a relationship's `sources` without duplicates.
def _append_sources(rel: str, new: str) -> str:
    return f"{rel}.sources = [x IN coalesce({rel}.sources, []) WHERE NOT x IN {new}] + {new}"


# --- documents and chunks -------------------------------------------------

DOCUMENT_STATUS = "MATCH (d:Document {id: $id}) RETURN d.status AS status"

UPSERT_DOCUMENT = """
MERGE (d:Document {id: $id})
ON CREATE SET d.createdAt = datetime()
SET d.path = $path, d.key = $key, d.mime = $mime, d.bytes = $bytes,
    d.jobId = $jobId, d.status = $status, d.error = $error
"""

# The same bytes arriving again. The path becomes the sender's, so an upload's key is recorded with
# it: otherwise a document loaded from a folder would keep no key under a path the sender chose.
TOUCH_DOCUMENT = "MATCH (d:Document {id: $id}) SET d.jobId = $jobId, d.path = $path, d.key = coalesce($key, d.key)"

SET_DOCUMENT_STATUS = """
MATCH (d:Document {id: $id})
SET d.status = $status, d.error = $error, d.kind = coalesce($kind, d.kind),
    d.droppedFacts = $dropped, d.unresolvedMentions = $unresolved
"""

UPSERT_CHUNKS = """
MATCH (d:Document {id: $docId})
UNWIND $chunks AS ch
MERGE (c:Chunk {id: ch.id})
SET c.text = ch.text, c.embedding = ch.embedding, c.`order` = ch.order, c.page = ch.page
MERGE (c)-[:CHUNK_OF]->(d)
"""

JOB_DOCUMENTS = """
MATCH (d:Document {jobId: $jobId})
RETURN d.id AS id, d.path AS path, d.status AS status, d.error AS error
ORDER BY d.path
"""

DOCUMENT_KEY = "MATCH (d:Document {id: $id}) RETURN d.key AS key, d.path AS path"

# --- people ---------------------------------------------------------------

# shortcut: scans all people; add a lookup node per email if the graph passes ~50k people.
PEOPLE_BY_EMAIL = """
MATCH (p:Person) WHERE any(e IN $emails WHERE e IN p.emails)
RETURN p.id AS id, p.name AS name, p.title AS title LIMIT 5
"""

CANDIDATES = """
MATCH (p:Person {surnameKey: $surname})
RETURN p.id AS id, p.name AS name, p.title AS title, p.emails AS emails,
  p.profileText AS profileText, p.profileEmbedding AS embedding,
  [(p)-[:WORKED_AT]->(o) | o.id] AS orgs,
  [(p)-[w:WORKED_ON]->(pr) WHERE pr.scope = 'org' | {id: pr.id, role: w.role}] AS projects,
  [(p)-[:HAS_SKILL]->(s) | s.id] AS skills,
  EXISTS { (:Document)-[:ABOUT]->(p) } AS hasResume
"""

CREATE_PERSON = """
CREATE (p:Person {id: $id, name: $name, aliases: $aliases, emails: $emails,
                  title: $title, surnameKey: $surnameKey})
"""

UPDATE_PERSON = """
MATCH (p:Person {id: $id})
SET p.name = $name, p.title = $title,
    p.aliases = [x IN coalesce(p.aliases, []) WHERE NOT x IN $aliases] + $aliases,
    p.emails = [x IN coalesce(p.emails, []) WHERE NOT x IN $emails] + $emails
"""

# A mention whose name fits someone on record with nothing else to confirm it: kept on the
# people it might mean, and never counted as evidence for them.
LINK_UNCONFIRMED = """
UNWIND $mentions AS m
MATCH (c:Chunk {id: m.chunkId})
MATCH (p:Person) WHERE p.id IN $people
MERGE (c)-[r:MAY_MENTION {surface: m.surface}]->(p)
SET r.reason = $reason
"""

# What a document said about someone who could not be placed, kept so that it can be tried again
# when a later document settles who was meant.
SAVE_PENDING = """
MERGE (n:Pending {id: $id})
SET n.docId = $docId, n.facts = $facts, n.context = $context
"""

PENDING = "MATCH (n:Pending) RETURN n.id AS id, n.docId AS docId, n.facts AS facts, n.context AS context ORDER BY n.id"

CLEAR_PENDING = """
MATCH (n:Pending {id: $id})
OPTIONAL MATCH (c:Chunk)-[:CHUNK_OF]->(d:Document {id: n.docId})
OPTIONAL MATCH (c)-[r:MAY_MENTION]->(:Person) WHERE r.surface IN $surfaces
DELETE r
WITH DISTINCT n, d
SET d.unresolvedMentions = CASE WHEN d.unresolvedMentions > 0 THEN d.unresolvedMentions - 1 ELSE 0 END
DETACH DELETE n
"""

# People a document has already been tied to: a later mention in it cannot be one of them.
# What an earlier, failed write of this document left waiting. A second try decides again.
CLEAR_DOC_PENDING = """
MATCH (d:Document {id: $id})
OPTIONAL MATCH (c:Chunk)-[:CHUNK_OF]->(d)
OPTIONAL MATCH (c)-[r:MAY_MENTION]->(:Person)
DELETE r
WITH DISTINCT d
OPTIONAL MATCH (n:Pending {docId: d.id})
DETACH DELETE n
"""

DOC_PEOPLE = """
MATCH (d:Document {id: $docId})
OPTIONAL MATCH (d)<-[:CHUNK_OF]-(:Chunk)-[:MENTIONS]->(m:Person)
OPTIONAL MATCH (d)-[:ABOUT]->(a:Person)
WITH collect(DISTINCT m) + collect(DISTINCT a) AS people
UNWIND people AS p
RETURN DISTINCT p.id AS id, p.name AS name
"""

CHUNK_VECTORS = "MATCH (c:Chunk) WHERE c.id IN $ids RETURN c.id AS id, c.text AS text, c.embedding AS embedding"

LINK_ABOUT = "MATCH (d:Document {id: $docId}), (p:Person {id: $personId}) MERGE (d)-[:ABOUT]->(p)"

LINK_MENTIONS = """
MATCH (p:Person {id: $personId})
UNWIND $mentions AS m
MATCH (c:Chunk {id: m.chunkId})
MERGE (c)-[:MENTIONS {surface: m.surface}]->(p)
"""

# --- facts ----------------------------------------------------------------

UPSERT_SKILLS = f"""
MATCH (p:Person {{id: $personId}})
UNWIND $rows AS row
MERGE (s:Skill {{id: row.id}}) ON CREATE SET s.name = row.name
MERGE (p)-[r:HAS_SKILL]->(s)
SET r.level = coalesce(row.level, r.level), {_append_sources("r", "row.sources")}
"""

UPSERT_ROLES = f"""
MATCH (p:Person {{id: $personId}})
UNWIND $rows AS row
MERGE (o:Organization {{id: row.orgId}}) ON CREATE SET o.name = row.org
MERGE (p)-[r:WORKED_AT {{title: row.title}}]->(o)
SET r.seniority = coalesce(row.seniority, r.seniority), r.start = coalesce(row.start, r.start),
    r.`end` = coalesce(row.`end`, r.`end`), {_append_sources("r", "row.sources")}
"""

UPSERT_EDUCATION = f"""
MATCH (p:Person {{id: $personId}})
UNWIND $rows AS row
MERGE (o:Organization {{id: row.orgId}}) ON CREATE SET o.name = row.school
MERGE (p)-[r:STUDIED_AT {{degree: row.degree, field: row.field}}]->(o)
SET r.start = coalesce(row.start, r.start), r.`end` = coalesce(row.`end`, r.`end`),
    {_append_sources("r", "row.sources")}
"""

UPSERT_PERSON_PROJECTS = f"""
MATCH (p:Person {{id: $personId}})
UNWIND $rows AS row
MERGE (pr:Project {{id: row.id}}) ON CREATE SET pr.name = row.name, pr.scope = row.scope
MERGE (p)-[r:WORKED_ON]->(pr)
SET r.role = coalesce(row.role, r.role), r.contribution = coalesce(row.contribution, r.contribution),
    {_append_sources("r", "row.sources")}
"""

UPSERT_PROJECTS = f"""
UNWIND $rows AS row
MERGE (pr:Project {{id: row.id}}) ON CREATE SET pr.name = row.name, pr.scope = row.scope
SET pr.description = coalesce(row.description, pr.description),
    pr.startDate = coalesce(row.start, pr.startDate), pr.endDate = coalesce(row.`end`, pr.endDate)
WITH pr, row
UNWIND row.skills AS sk
MERGE (s:Skill {{id: sk.id}}) ON CREATE SET s.name = sk.name
MERGE (pr)-[u:USED_SKILL]->(s)
SET {_append_sources("u", "sk.sources")}
"""

ORG_PROJECTS_BY_ID = """
MATCH (pr:Project {scope: 'org'}) WHERE pr.id IN $ids RETURN pr.id AS id, pr.name AS name
"""

PROFILE_ROWS = """
MATCH (p:Person) WHERE p.id IN $ids
RETURN p.id AS id, p.name AS name, p.title AS title,
  [(p)-[:HAS_SKILL]->(s) | s.name] AS skills,
  [(p)-[r:WORKED_AT]->(o) | r.title + ' at ' + o.name] AS roles,
  [(p)-[w:WORKED_ON]->(pr) | pr.name + coalesce(' (' + w.role + ')', '')] AS projects
"""

SET_PROFILES = """
UNWIND $rows AS row
MATCH (p:Person {id: row.id})
SET p.profileText = row.text, p.profileEmbedding = row.embedding
"""

SKILLS_WITHOUT_EMBEDDING = "MATCH (s:Skill) WHERE s.embedding IS NULL RETURN s.id AS id, s.name AS name"

SET_SKILL_EMBEDDINGS = "UNWIND $rows AS row MATCH (s:Skill {id: row.id}) SET s.embedding = row.embedding"

# --- re-embedding after a change of embedding model -------------------------

ALL_CHUNKS = "MATCH (c:Chunk) RETURN c.id AS id, c.text AS text ORDER BY c.id"

SET_CHUNK_EMBEDDINGS = "UNWIND $rows AS row MATCH (c:Chunk {id: row.id}) SET c.embedding = row.embedding"

ALL_PERSON_IDS = "MATCH (p:Person) RETURN p.id AS id"

# --- search ---------------------------------------------------------------

SKILLS_BY_ID = "MATCH (s:Skill) WHERE s.id IN $ids RETURN s.id AS id, s.name AS name"

SKILL_BY_VECTOR = """
CALL db.index.vector.queryNodes('skill_embedding_idx', 1, $embedding) YIELD node, score
RETURN node.id AS id, node.name AS name, score
"""

VECTOR_PEOPLE = """
CALL db.index.vector.queryNodes('chunk_embedding_idx', $k, $embedding) YIELD node AS c, score
WHERE score >= $floor
MATCH (c)-[:CHUNK_OF]->(d:Document)
OPTIONAL MATCH (d)-[:ABOUT]->(a:Person)
OPTIONAL MATCH (c)-[:MENTIONS]->(m:Person)
WITH c, d, score, collect(DISTINCT a) + collect(DISTINCT m) AS people
UNWIND people AS p
WITH DISTINCT p, c, d, score ORDER BY score DESC
WITH p, collect({chunkId: c.id, score: score}) AS hits
RETURN p.id AS id, hits[0].score AS best, [h IN hits | h.chunkId][0..3] AS chunkIds
ORDER BY best DESC
"""

DIRECT_SKILL = """
MATCH (p:Person)-[r:HAS_SKILL]->(s:Skill) WHERE s.id IN $skills
RETURN p.id AS id, p.name AS name, collect({skill: s.name, level: r.level, sources: r.sources}) AS matches
"""

PROJECT_PATH = """
MATCH (p:Person)-[w:WORKED_ON]->(pr:Project)
WHERE pr.id IN $projects OR EXISTS { (pr)-[:USED_SKILL]->(s:Skill) WHERE s.id IN $skills }
OPTIONAL MATCH (pr)-[u:USED_SKILL]->(s:Skill) WHERE s.id IN $skills
WITH p, pr, w, [x IN collect({skill: s.name, sources: u.sources}) WHERE x.skill IS NOT NULL] AS used
RETURN p.id AS id, p.name AS name, pr.id AS projectId, pr.name AS project, pr.id IN $projects AS named,
       w.sources AS sources, used
"""

PEOPLE_CARDS = """
MATCH (p:Person) WHERE p.id IN $ids
RETURN p.id AS id, p.name AS name, p.title AS title, EXISTS { (:Document)-[:ABOUT]->(p) } AS hasResume
"""

CHUNKS_BY_ID = """
MATCH (c:Chunk)-[:CHUNK_OF]->(d:Document) WHERE c.id IN $ids
RETURN c.id AS chunkId, c.text AS text, d.id AS docId, d.path AS path
"""

# --- read views -----------------------------------------------------------

PERSON = """
MATCH (p:Person {id: $id})
RETURN p.id AS id, p.name AS name, p.title AS title, p.aliases AS aliases,
  [(p)-[r:HAS_SKILL]->(s) | {name: s.name, level: r.level}] AS skills,
  [(p)-[r:WORKED_AT]->(o) | {org: o.name, title: r.title, seniority: r.seniority,
                             start: r.start, `end`: r.`end`}] AS roles,
  [(p)-[r:STUDIED_AT]->(o) | {school: o.name, degree: r.degree, field: r.field}] AS education,
  [(p)-[r:WORKED_ON]->(pr) | {id: pr.id, name: pr.name, scope: pr.scope, role: r.role,
     collaborators: [(pr)<-[:WORKED_ON]-(q) WHERE q <> p | {id: q.id, name: q.name}]}] AS projects,
  [(p)<-[r:MAY_MENTION]-(c)-[:CHUNK_OF]->(d) | {docId: d.id, path: d.path, surface: r.surface}] AS unconfirmed
"""

PERSON_EVIDENCE = """
MATCH (p:Person {id: $id})
OPTIONAL MATCH (d0:Document)-[:ABOUT]->(p)
OPTIONAL MATCH (c1:Chunk)-[:CHUNK_OF]->(d0)
WITH p, collect(DISTINCT c1) AS own
OPTIONAL MATCH (c2:Chunk)-[:MENTIONS]->(p)
WITH own, collect(DISTINCT c2) AS mentioned
WITH own + mentioned AS cs
UNWIND cs AS c
WITH DISTINCT c
MATCH (c)-[:CHUNK_OF]->(d:Document)
RETURN c.id AS chunkId, c.text AS text, d.id AS docId, d.path AS path, d.kind AS kind
ORDER BY d.path, c.`order` LIMIT 30
"""

STATS = """
RETURN COUNT { (:Document) } AS documents, COUNT { (:Chunk) } AS chunks,
       COUNT { (:Person) } AS people, COUNT { (:Skill) } AS skills,
       COUNT { (:Project) } AS projects, COUNT { (:Organization) } AS organizations,
       COUNT { (:Chunk)-[:MAY_MENTION]->(:Person) } AS unconfirmedMentions
"""

# --- graph view (landing page) ------------------------------------------------
# Organisation projects, the people on them, and the skills those projects used. Bounded,
# because the landing page draws every row it is given.

OVERVIEW_WORKED_ON = """
MATCH (p:Person)-[:WORKED_ON]->(pr:Project {scope: 'org'})
RETURN p.id AS person, p.name AS personName, pr.id AS project, pr.name AS projectName
ORDER BY project, person LIMIT $limit
"""

OVERVIEW_USED = """
MATCH (pr:Project {scope: 'org'})-[:USED_SKILL]->(s:Skill)
RETURN pr.id AS project, pr.name AS projectName, s.id AS skill, s.name AS skillName
ORDER BY project, skill LIMIT $limit
"""

OVERVIEW_HAS = """
MATCH (p:Person)-[:HAS_SKILL]->(s:Skill) WHERE p.id IN $people AND s.id IN $skills
RETURN p.id AS person, s.id AS skill ORDER BY person, skill LIMIT $limit
"""

# --- model spend (PRD R19) ---------------------------------------------------
# Kept in the graph so the daily cap survives a restart of the service.

SPEND_ON = "MATCH (s:Spend {day: $day}) RETURN sum(s.usd) AS usd"

ADD_SPEND = "MERGE (s:Spend {day: $day}) ON CREATE SET s.usd = $usd ON MATCH SET s.usd = s.usd + $usd"

# --- evaluation ------------------------------------------------------------

EVAL_MENTIONS = """
MATCH (d:Document)<-[:CHUNK_OF]-(:Chunk)-[m:MENTIONS]->(p:Person)
RETURN DISTINCT d.path AS doc, toLower(m.surface) AS surface, p.id AS person
"""

EVAL_UNCONFIRMED = """
MATCH (d:Document)<-[:CHUNK_OF]-(:Chunk)-[m:MAY_MENTION]->(:Person)
RETURN DISTINCT d.path AS doc, toLower(m.surface) AS surface
"""

EVAL_SUBJECTS = "MATCH (d:Document)-[:ABOUT]->(p:Person) RETURN d.path AS doc, p.id AS person"

EVAL_SKILL_HOLDERS = """
MATCH (n)-[:HAS_SKILL|USED_SKILL]->(s:Skill) WHERE s.id IN $ids RETURN count(n) AS n
"""

EVAL_TOTALS = """
MATCH (d:Document)
RETURN sum(coalesce(d.droppedFacts, 0)) AS droppedFacts,
       sum(coalesce(d.unresolvedMentions, 0)) AS unresolvedMentions,
       sum(CASE d.status WHEN 'failed' THEN 1 ELSE 0 END) AS failedDocuments
"""

# --- deletion (PRD R9) ----------------------------------------------------

_DOC_CHUNK_IDS = "MATCH (c:Chunk)-[:CHUNK_OF]->(:Document {id: $id}) RETURN collect(c.id) AS ids"

# shortcut: scans every relationship; fine for a demo graph, index sources if deletes get frequent.
_STRIP_SOURCES = """
MATCH ()-[r]->() WHERE r.sources IS NOT NULL AND any(x IN r.sources WHERE x IN $ids)
SET r.sources = [x IN r.sources WHERE NOT x IN $ids]
WITH r WHERE size(r.sources) = 0
DELETE r
"""

_DELETE_DOC = """
MATCH (d:Document {id: $id})
OPTIONAL MATCH (c:Chunk)-[:CHUNK_OF]->(d)
OPTIONAL MATCH (n:Pending {docId: $id})
DETACH DELETE c, d, n
"""

_DELETE_ORPHANS = """
MATCH (n) WHERE (n:Person OR n:Skill OR n:Project OR n:Organization) AND NOT (n)--()
DELETE n
"""


def delete_document(doc_id: str) -> bool:
    """Remove a document, its chunks, and every fact only it supported."""

    def work(tx: neo4j.ManagedTransaction) -> bool:
        ids = tx.run(_DOC_CHUNK_IDS, id=doc_id).single()["ids"]
        found = tx.run("MATCH (d:Document {id: $id}) RETURN count(d) AS n", id=doc_id).single()["n"]
        tx.run(_STRIP_SOURCES, ids=ids).consume()
        tx.run(_DELETE_DOC, id=doc_id).consume()
        tx.run(_DELETE_ORPHANS).consume()
        return bool(found)

    with driver().session(database=os.environ.get("NEO4J_DATABASE", "neo4j")) as session:
        return session.execute_write(work)


def overview(limit: int) -> dict:
    """Nodes and links for the graph view: at most `limit` links of each kind."""
    worked = run(OVERVIEW_WORKED_ON, limit=limit)
    used = run(OVERVIEW_USED, limit=limit)
    people = {r["person"]: r["personName"] for r in worked}
    projects = {r["project"]: r["projectName"] for r in (*worked, *used)}
    skills = {r["skill"]: r["skillName"] for r in used}
    has = run(OVERVIEW_HAS, people=list(people), skills=list(skills), limit=limit)

    def named(found: dict) -> list[dict]:
        return [{"id": key, "name": name} for key, name in found.items()]

    return {
        "people": named(people), "projects": named(projects), "skills": named(skills),
        "workedOn": [[r["person"], r["project"]] for r in worked],
        "used": [[r["project"], r["skill"]] for r in used],
        "has": [[r["person"], r["skill"]] for r in has],
    }
