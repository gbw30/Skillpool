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


SCHEMA = [
    *(
        f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE"
        for label in ("Person", "Skill", "Project", "Organization", "Document", "Chunk")
    ),
    "CREATE INDEX person_surname IF NOT EXISTS FOR (n:Person) ON (n.surnameKey)",
    "CREATE INDEX document_job IF NOT EXISTS FOR (n:Document) ON (n.jobId)",
    _vector_index("chunk_embedding_idx", "Chunk", "embedding"),
    _vector_index("person_profile_idx", "Person", "profileEmbedding"),
    _vector_index("skill_embedding_idx", "Skill", "embedding"),
]


def init_db() -> None:
    for statement in SCHEMA:
        run(statement)
    run("CALL db.awaitIndexes(120)")


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

TOUCH_DOCUMENT = "MATCH (d:Document {id: $id}) SET d.jobId = $jobId, d.path = $path"

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

FLAG_POSSIBLE_SAME = """
MATCH (a:Person {id: $a}), (b:Person {id: $b})
MERGE (a)-[r:POSSIBLE_SAME_AS]->(b)
SET r.score = $score, r.reason = $reason
"""

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
RETURN p.id AS id, collect({skill: s.name, level: r.level, sources: r.sources}) AS matches
"""

PROJECT_PATH = """
MATCH (p:Person)-[w:WORKED_ON]->(pr:Project)
WHERE pr.id IN $projects OR EXISTS { (pr)-[:USED_SKILL]->(s:Skill) WHERE s.id IN $skills }
OPTIONAL MATCH (pr)-[u:USED_SKILL]->(s:Skill) WHERE s.id IN $skills
WITH p, pr, w, [x IN collect({skill: s.name, sources: u.sources}) WHERE x.skill IS NOT NULL] AS used
RETURN p.id AS id, pr.id AS projectId, pr.name AS project, pr.id IN $projects AS named,
       w.sources AS sources, used
"""

PEOPLE_CARDS = "MATCH (p:Person) WHERE p.id IN $ids RETURN p.id AS id, p.name AS name, p.title AS title"

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
  [(p)-[:POSSIBLE_SAME_AS]-(q) | {id: q.id, name: q.name}] AS possibleSame
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
       COUNT { (:Person)-[:POSSIBLE_SAME_AS]->(:Person) } AS flaggedPairs
"""

# --- evaluation ------------------------------------------------------------

EVAL_MENTIONS = """
MATCH (d:Document)<-[:CHUNK_OF]-(:Chunk)-[m:MENTIONS]->(p:Person)
RETURN DISTINCT d.path AS doc, toLower(m.surface) AS surface, p.id AS person
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
DETACH DELETE c, d
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
