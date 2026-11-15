"""Claude and embedding calls, with a daily spend counter (PRD R19)."""
import datetime
import threading
import time
from collections.abc import Iterator

import anthropic
import httpx
import openai

from . import config, graph

_lock = threading.Lock()
_clients: dict = {}
# Today's spend: read from the graph on first use, then kept here and written through, so a
# restart does not reset the cap.
# shortcut: a process only sees its own charges after that first read; with several instances
# the cap can be overshot. Read the stored total on every check when running more than one.
_spend: dict[str, float] = {}


class BudgetExceeded(Exception):
    pass


class Refused(Exception):
    pass


def _claude() -> anthropic.Anthropic:
    if "claude" not in _clients:
        _clients["claude"] = anthropic.Anthropic(max_retries=4)  # 5 tries, SDK backs off on 429/5xx
    return _clients["claude"]


def _openai() -> openai.OpenAI:
    if "openai" not in _clients:
        _clients["openai"] = openai.OpenAI(max_retries=4)
    return _clients["openai"]


def _today() -> str:
    return datetime.date.today().isoformat()


def _spent(day: str) -> float:
    with _lock:
        if day not in _spend:
            _spend[day] = float(graph.run(graph.SPEND_ON, day=day)[0]["usd"])
        return _spend[day]


def spent_today() -> float:
    return _spent(_today())


def _check_budget() -> None:
    if spent_today() >= config.DAILY_MODEL_BUDGET_USD:
        raise BudgetExceeded("daily model budget reached")


def _charge(usd: float) -> None:
    day = _today()
    _spent(day)  # load the stored total before adding to it
    with _lock:
        _spend[day] += usd
    graph.run(graph.ADD_SPEND, day=day, usd=usd)


def _charge_claude(usage) -> None:
    _charge((usage.input_tokens * config.PRICE_IN + usage.output_tokens * config.PRICE_OUT) / 1e6)


def _embed_openai(texts: list[str], query: bool) -> tuple[list[list[float]], int]:
    resp = _openai().embeddings.create(model=config.EMBED_MODEL, input=texts)
    return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)], resp.usage.total_tokens


def _voyage_url(key: str) -> str:
    # Keys made in MongoDB Atlas start with "al-" and only work at Atlas's address; older keys use Voyage's own.
    return ("https://ai.mongodb.com/v1" if key.startswith("al-") else "https://api.voyageai.com/v1") + "/embeddings"


def _embed_voyage(texts: list[str], query: bool) -> tuple[list[list[float]], int]:
    # Voyage embeds a search question differently from the text it is matched against.
    body = {"model": config.EMBED_MODEL, "input": texts, "input_type": "query" if query else "document"}
    key = config.require("VOYAGE_API_KEY")
    headers = {"Authorization": f"Bearer {key}"}
    for attempt in range(5):  # 5 tries with backoff on rate limits and server errors, like the SDK clients
        try:
            resp = httpx.post(_voyage_url(key), json=body, headers=headers, timeout=60)
            again = resp.status_code == 429 or resp.status_code >= 500
        except httpx.TransportError:
            if attempt == 4:
                raise
            again = True
        if not again or attempt == 4:
            break
        time.sleep(2**attempt)
    resp.raise_for_status()
    data = resp.json()
    return [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])], data["usage"]["total_tokens"]


_EMBED = {"openai": _embed_openai, "voyage": _embed_voyage}
_model_checked = False


def embed(texts: list[str], query: bool = False) -> list[list[float]]:
    """Vectors for `texts`. `query` marks a search question, as opposed to stored text."""
    global _model_checked
    if not texts:
        return []
    if not _model_checked:  # once per process: the stored vectors must come from the same model
        graph.check_embedding_model()
        _model_checked = True
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        _check_budget()
        vectors, tokens = _EMBED[config.EMBED_PROVIDER](texts[i : i + 64], query)
        _charge(tokens * config.PRICE_EMBED / 1e6)
        out.extend(vectors)
    return out


def parse(system: str, user: str, output_format: type, max_tokens: int = 16000):
    """One structured-output call. Returns a validated instance of `output_format`."""
    _check_budget()
    resp = _claude().messages.parse(
        model=config.CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=output_format,
        output_config={"effort": "low"},
    )
    _charge_claude(resp.usage)
    if resp.stop_reason == "refusal":
        raise Refused("model declined the request")
    if resp.stop_reason == "max_tokens" or resp.parsed_output is None:
        raise ValueError(f"incomplete model output (stop_reason={resp.stop_reason})")
    return resp.parsed_output


def stream_text(system: str, user: str, max_tokens: int = 4000) -> Iterator[str]:
    _check_budget()
    with _claude().messages.stream(
        model=config.CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": "low"},
    ) as stream:
        sent, finished = 0, False
        try:
            for text in stream.text_stream:
                sent += len(text)
                yield text
            finished = True
        finally:
            # Runs when the reader stops early too: closing the browser tab ends this generator at
            # the yield above, and what was generated up to then has still been paid for.
            try:
                usage = stream.current_message_snapshot.usage
            except AssertionError:  # the stream ended before its first event: no token counts exist
                usage = None
            if usage:
                # Output tokens are reported at the end of a stream. Before that, go by the text sent.
                output = usage.output_tokens if finished else max(usage.output_tokens or 0, sent // 3)
                _charge((usage.input_tokens * config.PRICE_IN + output * config.PRICE_OUT) / 1e6)
