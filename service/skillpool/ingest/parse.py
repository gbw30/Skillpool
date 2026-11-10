"""Bytes to text. Raises ParseError with a short reason shown to the user."""
import unicodedata

import pymupdf


class ParseError(Exception):
    pass


def parse(data: bytes, ext: str) -> tuple[str, list[int]]:
    """Return (text, page_starts). page_starts is empty for formats without pages."""
    if ext == ".pdf":
        # Check the content, not the name: the extension came from the uploader.
        if not data.startswith(b"%PDF-"):
            raise ParseError("type_mismatch")
        try:
            with pymupdf.open(stream=data, filetype="pdf") as doc:
                pages = [unicodedata.normalize("NFKC", page.get_text()) for page in doc]
        except Exception as exc:
            raise ParseError("unreadable_pdf") from exc
        text, starts = "", []
        for page in pages:
            starts.append(len(text))
            text += page + "\n"
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
