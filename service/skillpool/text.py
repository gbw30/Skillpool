"""Small text helpers shared by ingestion and search."""
import re
import unicodedata

# Keys and values are slugs. Skills are never merged by embedding similarity:
# "Java" and "JavaScript" sit close in embedding space.
SKILL_ALIASES = {
    "js": "javascript",
    "ts": "typescript",
    "k8s": "kubernetes",
    "postgres": "postgresql",
    "golang": "go",
    "nodejs": "node.js",
    "node": "node.js",
    "reactjs": "react",
    "react.js": "react",
    "gcp": "google-cloud",
    "amazon-web-services": "aws",
    # The model's "canonical" name for these carries the vendor. As text they score no closer to
    # the plain name than COBOL does to Java (0.90), so the vector fallback cannot join them.
    "apache-kafka": "kafka",
    "apache-airflow": "airflow",
    "microsoft-excel": "excel",
    "ci-cd-pipelines": "ci-cd",
}


def slug(value: str) -> str:
    """Stable id from a name. Keeps + # . so C++, C#, and Node.js stay distinct."""
    value = unicodedata.normalize("NFKC", value).lower().strip()
    return re.sub(r"[^a-z0-9+#.]+", "-", value).strip("-").rstrip(".")


def skill_id(name: str) -> str:
    s = slug(name)
    return SKILL_ALIASES.get(s, s)


def squash(value: str) -> str:
    """NFKC and single spaces: the form quotes are compared in."""
    return " ".join(unicodedata.normalize("NFKC", value).split())


def snippet(text: str, terms: list[str], width: int = 480) -> str:
    """A window of `text` around the first matching term, else the start."""
    flat = squash(text)
    lower = flat.lower()
    pos = min((p for p in (lower.find(t.lower()) for t in terms if t) if p >= 0), default=0)
    start = max(0, pos - width // 3)
    end = min(len(flat), start + width)
    return ("…" if start else "") + flat[start:end].strip() + ("…" if end < len(flat) else "")
