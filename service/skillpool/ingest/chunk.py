"""Split text into overlapping chunks that remember where they came from."""
import bisect
import hashlib
import re
from dataclasses import dataclass

from .. import config

# A Markdown heading, or a short capitalized line on its own ("Experience", "Skills").
_HEADING = re.compile(r"\n(?=#|[A-Z][A-Za-z &/]{2,40}\n)")


@dataclass
class Chunk:
    order: int
    text: str
    start: int  # offsets into the document text
    end: int
    page: int | None = None
    id: str = ""


def _break(text: str, start: int, end: int) -> int:
    """Prefer ending a chunk at a heading, then a line break, then a space."""
    span = end - start
    headings = list(_HEADING.finditer(text, start + int(span * 0.6), end))
    if headings:
        return headings[-1].start() + 1
    for sep in ("\n", " "):
        i = text.rfind(sep, start + int(span * 0.75), end)
        if i != -1:
            return i + 1
    return end


def chunk(
    text: str,
    doc_id: str,
    page_starts: list[int] | None = None,
    size: int = config.CHUNK_CHARS,
    overlap: int = config.OVERLAP_CHARS,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    start, n = 0, len(text)
    while start < n:
        end = min(n, start + size)
        if end < n:
            end = _break(text, start, end)
        if text[start:end].strip():  # keep short tails: a short document is still a document
            order = len(chunks)
            page = bisect.bisect_right(page_starts, start) if page_starts else None
            cid = hashlib.sha1(f"{doc_id}|{order}".encode()).hexdigest()
            chunks.append(Chunk(order, text[start:end], start, end, page, cid))
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks
