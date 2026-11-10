"""Reciprocal rank fusion: combine ranked lists without tuning weights."""


def rrf(lists: list[list[str]], k: int) -> list[str]:
    scores: dict[str, float] = {}
    for ranked in lists:
        for rank, item in enumerate(ranked, 1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda item: -scores[item])  # ties keep first-seen order
