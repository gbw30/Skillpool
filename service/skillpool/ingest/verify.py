"""Keep only facts whose quote is in the document, and record which chunks hold it (PRD R6)."""
import re
import unicodedata

from ..text import squash
from .chunk import Chunk
from .extract import Extraction
from .resolve import parse_name


# Names and titles are short. A long one is not a name: it is text trying to ride into the prompts
# these values are later placed in, or into the page.
MAX_NAME_CHARS = 80
MAX_FIELD_CHARS = 200
MAX_PROSE_CHARS = 600  # a contribution or a project description


def _plain(value: str, limit: int) -> bool:
    return len(value) <= limit and not any(unicodedata.category(ch).startswith("C") for ch in value)


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
            ids += [cid for cid in self._chunks_at(i, len(needle)) if cid not in ids]
            if not every:
                break
            i = hay.find(needle, i + 1)
        return ids

    def standalone(self, word: str) -> list[str]:
        """Ids of the chunks where `word` stands by itself: not inside a longer word or an email
        address, and not followed by another capitalised word, which would make it part of a
        longer name."""
        ids: list[str] = []
        for m in re.finditer(rf"(?<![\w@.-]){re.escape(word)}(?![\w@-]|\.\w|\s+[A-Z])", self.flat):
            ids += [cid for cid in self._chunks_at(m.start(), len(word)) if cid not in ids]
        return ids

    def _chunks_at(self, i: int, length: int) -> list[str]:
        a, b = self.pos[i], self.pos[i + length - 1] + 1
        return [c.id for c in self.chunks if c.start < b and a < c.end]


def verify(ex: Extraction, text: str, chunks: list[Chunk]) -> dict:
    """Plain-dict facts with `sources`; `dropped` counts facts and people that failed the check."""
    loc = Locator(text, chunks)
    dropped = 0

    def keep(items) -> list[dict]:
        nonlocal dropped
        out = []
        for item in items:
            src = loc.sources(item.quote)
            row = {k: squash(v) for k, v in item.model_dump(exclude={"quote"}).items()}
            if src and all(_plain(v, MAX_PROSE_CHARS if k == "contribution" else MAX_FIELD_CHARS) for k, v in row.items()):
                out.append({**row, "sources": src})
            else:
                dropped += 1
        return out

    people = []
    for p in ex.people:
        written = [s for s in dict.fromkeys(squash(x) for x in (p.name, *p.aliases)) if s and loc.sources(s)]
        surfaces = [s for s in written if "@" not in s and _plain(s, MAX_NAME_CHARS)]
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
                "title": title if _plain(title := squash(p.title), MAX_FIELD_CHARS) else "",
                "isSubject": p.isSubject,
                "skills": keep(p.skills),
                "roles": keep(p.roles),
                "education": keep(p.education),
                "projects": keep(p.projects),
                "mentions": mentions,
            }
        )

    # The model sometimes lists one person twice, by initial in a list ("N. Mahlangu") and in full
    # in a sentence. Fold the initial into the full name when exactly one full name fits and the
    # document says nothing that tells them apart. Two entries with different job titles or
    # different email addresses are two people and stay that way.
    names = [parse_name(p["name"]) for p in people]
    for short, initial in list(zip(people, names)):
        if not initial or not initial.last or len(initial.first) != 1:
            continue
        fits = [
            p for p, n in zip(people, names)
            if p is not short and n and n.last == initial.last and len(n.first) > 1 and n.first[0] == initial.first
        ]
        if len(fits) != 1:
            continue
        full = fits[0]
        differ = lambda a, b: bool(a and b and not {x.casefold() for x in a} & {x.casefold() for x in b})
        if differ([short["title"]], [full["title"]]) or differ(short["emails"], full["emails"]):
            continue
        full["aliases"] += [a for a in (short["name"], *short["aliases"]) if a not in full["aliases"]]
        full["emails"] += [e for e in short["emails"] if e not in full["emails"]]
        full["title"] = full["title"] or short["title"]
        full["isSubject"] = full["isSubject"] or short["isSubject"]
        for key in ("skills", "roles", "education", "projects", "mentions"):
            full[key] += short[key]
        people.remove(short)
        names = [parse_name(p["name"]) for p in people]  # keep the pairs below in step

    # A first name on its own ("Bao, can you look at this?") means the one person this document
    # names in full with that first name. The model is asked to list these as aliases and often
    # leaves them out, so they are found here. Nothing is added when it could mean someone else.
    parsed = [parse_name(p["name"]) for p in people]
    for p, name in zip(people, parsed):
        if not name or not name.last or len(name.first) < 2:
            continue
        could_be_another = any(
            other is not name and other and (other.first in (name.first, name.first[0]) or other.last == name.first)
            for other in parsed
        )
        first = next((t.strip(".,") for t in p["name"].split() if t.strip(".,").lower() == name.first), "")
        if could_be_another or not first or first in p["aliases"]:
            continue
        found = loc.standalone(first)
        if found:
            p["aliases"].append(first)
            p["mentions"] += [{"chunkId": cid, "surface": first} for cid in found]

    projects = []
    for pr in ex.projects:
        src = loc.sources(pr.name)
        if not src or not _plain(squash(pr.name), MAX_FIELD_CHARS):
            dropped += 1
            continue
        projects.append(
            {
                "name": squash(pr.name),
                "description": text if _plain(text := squash(pr.description), MAX_PROSE_CHARS) else "",
                "start": squash(pr.start),
                "end": squash(pr.end),
                "sources": src,
                "skills": keep(pr.skills),
            }
        )
    return {"kind": ex.kind, "people": people, "projects": projects, "dropped": dropped}
