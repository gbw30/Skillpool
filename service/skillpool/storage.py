"""Object storage: presigned browser uploads, listing, and reads. Any S3 API that supports
POST policy uploads works (AWS S3, MinIO)."""
import os
import re

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from . import config


def _client():
    endpoint = os.environ.get("S3_ENDPOINT_URL") or None
    return boto3.client(
        "s3",
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        endpoint_url=endpoint,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path" if endpoint else "auto"}),
    )


def _bucket() -> str:
    return config.require("S3_BUCKET")


def _clip(segment: str, limit: int = 120) -> str:
    """Shorten a long name from the middle of its stem, so the extension that says what the file is survives."""
    stem, dot, ext = segment.rpartition(".")
    if len(segment) <= limit or not dot or len(ext) > 10:
        return segment[:limit]
    return stem[: limit - len(ext) - 1] + "." + ext


def safe_path(path: str) -> str:
    """A relative path that is safe to use inside an object key. Raises ValueError if nothing is left."""
    parts = [_clip(re.sub(r"[^A-Za-z0-9._ -]", "_", seg).strip()) for seg in path.replace("\\", "/").split("/")]
    parts = [p for p in parts if p and set(p) != {"."}]
    if not parts:
        raise ValueError("empty path")
    return "/".join(parts)


def object_key(job_id: str, index: int, path: str) -> str:
    # The key is built here, never taken from the client.
    return f"jobs/{job_id}/{index:03d}/{safe_path(path)}"


def display_path(key: str) -> str:
    return key.split("/", 3)[3]


def presign_upload(key: str, content_type: str, size: int) -> dict:
    """A form POST the browser can make once, for exactly this key, type, and size."""
    return _client().generate_presigned_post(
        _bucket(), key,
        Fields={"Content-Type": content_type},
        Conditions=[{"Content-Type": content_type}, ["content-length-range", size, size]],
        ExpiresIn=config.UPLOAD_TTL_SECONDS,
    )


def list_keys(prefix: str) -> list[str]:
    pages = _client().get_paginator("list_objects_v2").paginate(Bucket=_bucket(), Prefix=prefix)
    return [obj["Key"] for page in pages for obj in page.get("Contents", [])]


def fetch(key: str) -> bytes:
    obj = _client().get_object(Bucket=_bucket(), Key=key)
    if obj["ContentLength"] > config.MAX_FILE_BYTES:
        raise ValueError("object larger than the upload limit")
    return obj["Body"].read()


def presign_get(key: str) -> str:
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=300
    )


def init_storage(web_origin: str) -> None:
    """Create the bucket if needed and let the web origin POST to it."""
    s3 = _client()
    try:
        s3.head_bucket(Bucket=_bucket())
    except ClientError:
        region = os.environ.get("S3_REGION", "us-east-1")
        # AWS requires the region to be stated for every region except us-east-1.
        where = {} if region == "us-east-1" or os.environ.get("S3_ENDPOINT_URL") else {
            "CreateBucketConfiguration": {"LocationConstraint": region}
        }
        s3.create_bucket(Bucket=_bucket(), **where)
    try:
        s3.put_bucket_cors(Bucket=_bucket(), CORSConfiguration={"CORSRules": [
            {"AllowedOrigins": [web_origin], "AllowedMethods": ["POST"], "AllowedHeaders": ["*"]}
        ]})
    except ClientError as exc:  # MinIO sets CORS server-wide and rejects this call
        print(f"bucket CORS not set ({exc.response['Error']['Code']}); set it on the storage server")
