"""Bytes to text. Raises ParseError with a short reason shown to the user."""
import io
import multiprocessing
import unicodedata

from pypdf import PdfReader

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
            reader = PdfReader(io.BytesIO(data))
            if len(reader.pages) > config.MAX_PDF_PAGES:
                raise ParseError("too_long")
            for page in reader.pages:
                raw = page.extract_text()
                # A small PDF can expand into far more text than a document is allowed to hold.
                if length + len(raw) > config.MAX_TEXT_CHARS:
                    raise ParseError("too_long")
                if not raw.endswith("\n"):
                    raw += "\n"  # every page ends its last line, whichever way the file was written
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
            raw = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ParseError("not_utf8") from exc
        if len(raw) > config.MAX_TEXT_CHARS:  # before normalising, which is slow on a huge text and can lengthen it
            raise ParseError("too_long")
        text, starts = unicodedata.normalize("NFKC", raw), []
    if not text.strip():
        raise ParseError("no_text")
    if len(text) > config.MAX_TEXT_CHARS:
        raise ParseError("too_long")
    return text, starts


def _parse_in_child(conn, data: bytes, ext: str) -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (config.PARSE_MEMORY_BYTES, config.PARSE_MEMORY_BYTES))
    except (ImportError, ValueError, OSError):  # no such limit on this platform: the deadline still applies
        pass
    try:
        conn.send(("ok", parse(data, ext)))
    except ParseError as exc:
        conn.send(("error", str(exc)))
    except MemoryError:
        conn.send(("error", "too_large"))


def parse_safely(data: bytes, ext: str) -> tuple[str, list[int]]:
    """`parse`, with a PDF opened in a child process that is killed if it runs long or grows large.

    Text files are read here: they are capped by length before any work is done on them.
    """
    if ext != ".pdf":
        return parse(data, ext)
    here, there = multiprocessing.Pipe(duplex=False)
    child = multiprocessing.get_context("spawn").Process(target=_parse_in_child, args=(there, data, ext), daemon=True)
    child.start()
    there.close()
    try:
        if not here.poll(config.PARSE_SECONDS):
            raise ParseError("too_slow")
        kind, value = here.recv()
    except EOFError:  # the child was killed for memory, or the parser crashed
        raise ParseError("unreadable_pdf") from None
    finally:
        child.kill()
        child.join()
    if kind == "error":
        raise ParseError(value)
    return value
