"""Keep only facts whose quote is in the document, and record which chunks hold it (PRD R6)."""
from ..text import squash
from .chunk import Chunk
from .extract import Extraction


def index(text: str) -> tuple[str, list[int]]:
    """Whitespace-collapsed text, plus the offset in `text` of each of its characters."""
    out: list[str] = []
    pos: list[int] = []
    gap = True
    for i, ch in enumerate(text):
        if ch.isspace():
            if not gap:
                out.append(" ")
                pos.append(i)
            gap = True
        else:
            out.append(ch)
            pos.append(i)
            gap = False
    return "".join(out), pos


class Locator:
    def __init__(self, text: str, chunks: list[Chunk]):
        self.flat, self.pos = index(text)
        self.lower = self.flat.lower()
        self.chunks = chunks

    def sources(self, quote: str, every: bool = False, ignore_case: bool = False) -> list[str]:
        """Ids of the chunks containing `quote` (first occurrence, or every occurrence)."""
        needle = squash(quote)
        hay = self.flat
        if ignore_case:
            needle, hay = needle.lower(), self.lower
        ids: list[str] = []
        i = hay.find(needle) if needle else -1
        while i != -1:
            a, b = self.pos[i], self.pos[i + len(needle) - 1] + 1
            ids += [c.id for c in self.chunks if c.start < b and a < c.end and c.id not in ids]
            if not every:
                break
            i = hay.find(needle, i + 1)
        return ids


def verify(ex: Extraction, text: str, chunks: list[Chunk]) -> dict:
    """Plain-dict facts with `sources`; `dropped` counts facts and people that failed the check."""
    loc = Locator(text, chunks)
    dropped = 0

    def keep(items) -> list[dict]:
        nonlocal dropped
        out = []
        for item in items:
            src = loc.sources(item.quote)
            if src:
                row = {k: squash(v) for k, v in item.model_dump(exclude={"quote"}).items()}
                out.append({**row, "sources": src})
            else:
                dropped += 1
        return out

    people = []
    for p in ex.people:
        written = [s for s in dict.fromkeys(squash(x) for x in (p.name, *p.aliases)) if s and loc.sources(s)]
        surfaces = [s for s in written if "@" not in s]
        # An email address written in place of a name counts as an email, not as a name.
        given = dict.fromkeys(x.strip().lower() for x in (*p.emails, *(s for s in written if "@" in s)))
        emails = [e for e in given if e and loc.sources(e, ignore_case=True)]
        if not surfaces and not emails:
            dropped += 1  # a person the document never names
            continue
        mentions = [
            {"chunkId": cid, "surface": s}
            for s in (*surfaces, *emails)
            for cid in loc.sources(s, every=True, ignore_case=True)
        ]
        people.append(
            {
                "name": surfaces[0] if surfaces else "",
                "aliases": surfaces[1:],
                "emails": emails,
                "title": squash(p.title),
                "isSubject": p.isSubject,
                "skills": keep(p.skills),
                "roles": keep(p.roles),
                "education": keep(p.education),
                "projects": keep(p.projects),
                "mentions": mentions,
            }
        )

    projects = []
    for pr in ex.projects:
        src = loc.sources(pr.name)
        if not src:
            dropped += 1
            continue
        projects.append(
            {
                "name": squash(pr.name),
                "description": squash(pr.description),
                "start": squash(pr.start),
                "end": squash(pr.end),
                "sources": src,
                "skills": keep(pr.skills),
            }
        )
    return {"kind": ex.kind, "people": people, "projects": projects, "dropped": dropped}
