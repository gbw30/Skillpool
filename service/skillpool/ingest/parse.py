"""Bytes to text. Raises ParseError with a short reason shown to the user."""
import unicodedata

import pymupdf

from .. import config


class ParseError(Exception):
    pass


def parse(data: bytes, ext: str) -> tuple[str, list[int]]:
    """Return (text, page_starts). page_starts is empty for formats without pages."""
    if ext == ".pdf":
        # Check the content, not the name: the extension came from the uploader.
        if not data.startswith(b"%PDF-"):
            raise ParseError("type_mismatch")
        pages, starts, length = [], [], 0
        try:
            with pymupdf.open(stream=data, filetype="pdf") as doc:
                for page in doc:
                    raw = page.get_text()
                    # A small PDF can expand into far more text than a text file is allowed to hold.
                    if length + len(raw) > config.MAX_FILE_BYTES:
                        raise ParseError("too_large")
                    starts.append(length)
                    pages.append(unicodedata.normalize("NFKC", raw) + "\n")
                    length += len(pages[-1])
        except ParseError:
            raise
        except Exception as exc:
            raise ParseError("unreadable_pdf") from exc
        text = "".join(pages)
    else:
        if b"\x00" in data:
            raise ParseError("type_mismatch")
        try:
            text, starts = unicodedata.normalize("NFKC", data.decode("utf-8")), []
        except UnicodeDecodeError as exc:
            raise ParseError("not_utf8") from exc
    if not text.strip():
        raise ParseError("no_text")
    return text, starts
