"""Upload run artifacts to S3 and mint short-lived presigned URLs.

The sandbox process has an IAM task role with PutObject on
assets/tenants/*/clio-runs/* only — that's the trust boundary. The
Capiro API can mint presigned-GET URLs separately if needed; we mint
them here too so the tool result handed to the model can include a
direct download link without an extra API call.
"""

from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path

import boto3
import structlog
from botocore.config import Config as BotoConfig

from .config import settings

log = structlog.get_logger(__name__)

# Presigned GETs are valid for 15 minutes. Long enough for the user to
# click through; short enough that a leaked URL doesn't hand someone
# permanent access to the file.
PRESIGNED_TTL_SECONDS = 15 * 60


@dataclass
class UploadedFile:
    name: str
    content_type: str
    size_bytes: int
    s3_key: str
    url: str


def s3_client():
    return boto3.client(
        "s3",
        region_name=settings.assets_region,
        config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def upload_outputs(
    output_dir: Path,
    *,
    tenant_id: str,
    run_id: str,
    max_total_bytes: int | None = None,
) -> list[UploadedFile]:
    """Walk `output_dir` recursively, upload everything to S3 under
    tenants/<tenantId>/clio-runs/<runId>/, and return a list of
    {name, content_type, size_bytes, s3_key, url}.

    Files outside output_dir are ignored entirely — the runner already
    constrained the workdir, this is belt-and-suspenders.

    `max_total_bytes` caps the cumulative upload. Once exceeded,
    remaining files are skipped and a warning is logged.
    """
    cap = max_total_bytes if max_total_bytes is not None else settings.run_max_output_bytes
    if not settings.assets_bucket:
        raise RuntimeError("SANDBOX_ASSETS_BUCKET is not configured")

    out: list[UploadedFile] = []
    total = 0
    client = s3_client()
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if total + size > cap:
            log.warning(
                "upload_outputs_cap_reached",
                tenant_id=tenant_id,
                run_id=run_id,
                file=str(path),
                size=size,
                cap=cap,
            )
            break
        rel = path.relative_to(output_dir)
        # Strip any leading slashes/dots so the S3 prefix stays clean.
        safe_rel = str(rel).replace("\\", "/").lstrip("./")
        key = f"tenants/{tenant_id}/clio-runs/{run_id}/{safe_rel}"
        content_type, _ = mimetypes.guess_type(path.name)
        content_type = content_type or "application/octet-stream"
        try:
            client.upload_file(
                str(path),
                settings.assets_bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "upload_outputs_failed",
                tenant_id=tenant_id,
                run_id=run_id,
                key=key,
                error=str(exc),
            )
            continue
        try:
            url = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.assets_bucket, "Key": key},
                ExpiresIn=PRESIGNED_TTL_SECONDS,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "presign_failed",
                tenant_id=tenant_id,
                run_id=run_id,
                key=key,
                error=str(exc),
            )
            url = ""
        out.append(
            UploadedFile(
                name=os.path.basename(safe_rel),
                content_type=content_type,
                size_bytes=size,
                s3_key=key,
                url=url,
            )
        )
        total += size
    return out
