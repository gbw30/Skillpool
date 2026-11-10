"""Claude and embedding calls, with a daily spend counter (PRD R19)."""
import datetime
import threading
from collections.abc import Iterator

import anthropic
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


def embed(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        _check_budget()
        resp = _openai().embeddings.create(model=config.EMBED_MODEL, input=texts[i : i + 64])
        _charge(resp.usage.total_tokens * config.PRICE_EMBED / 1e6)
        out.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
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
        yield from stream.text_stream
        _charge_claude(stream.get_final_message().usage)
