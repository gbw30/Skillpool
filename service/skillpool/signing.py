"""Request signing between the web app and this service.

signature = hex(HMAC-SHA256(secret, "{timestamp}.{METHOD}.{path}." + body))
The web app's copy is web/lib/service.ts; the two must stay in step.
"""
import hashlib
import hmac
import time

from . import config


def sign(secret: str, timestamp: str, method: str, path: str, body: bytes) -> str:
    message = f"{timestamp}.{method.upper()}.{path}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify(secret: str, timestamp: str, signature: str, method: str, path: str, body: bytes,
           now: float | None = None) -> bool:
    try:
        sent = int(timestamp)
    except ValueError:
        return False
    if abs((now if now is not None else time.time()) - sent) > config.SIGNATURE_SKEW_SECONDS:
        return False
    # As bytes: compare_digest refuses text that is not ASCII, and the header is whatever was sent.
    return hmac.compare_digest(sign(secret, timestamp, method, path, body).encode(), signature.lower().encode())
