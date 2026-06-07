#!/usr/bin/env python3
"""Shared helper (Step 0.1): emit a `_document` provenance header into extractor artifacts.

Every committed extraction artifact can carry a self-describing header so the SourceDocument
registry (apps/api/src/program-element/source-document/) and backfill have a fingerprint of
the *source PDF* (not just the artifact JSON), the page count, and which tool/version produced
it.

    from _doc_header import build_document_header
    out["_document"] = build_document_header(
        pdf_path, source_url=url, page_count=n, tool="extract_jbook_r1.py")

Note: `extracted_at` is a wall-clock timestamp, so re-extracting an unchanged PDF yields a new
artifact byte-for-byte. That is intentional — a fresh extraction is a new document VERSION in
the registry. Committed artifacts are NOT regenerated as part of this change.
"""
import hashlib
import os
from datetime import datetime, timezone

# Bump when the extraction logic of any tool that emits this header changes materially.
TOOL_VERSION = "0.1.0"


def sha256_of_file(path):
    """SHA-256 of a local file, streamed; None when the path is missing/not a file."""
    if not path or not os.path.isfile(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_document_header(pdf_path=None, source_url=None, page_count=None, tool=None,
                          tool_version=TOOL_VERSION):
    """Build the `_document` header dict for an artifact."""
    return {
        "source_url": source_url,
        "sha256_of_pdf": sha256_of_file(pdf_path),
        "page_count": page_count,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "tool": tool,
        "tool_version": tool_version,
    }
