# clio-sandbox container.
#
# Build context: REPOSITORY ROOT (not apps/clio-sandbox).
#   docker buildx build --platform linux/arm64 \
#     -f apps/clio-sandbox/Dockerfile \
#     -t capiro-sandbox:local --push .
#
# Two stages:
#   1. base  — slim python with uv + the pinned wheels.
#   2. runtime — non-root user, the same wheels, no build deps.

ARG PYTHON_VERSION=3.12.7

FROM python:${PYTHON_VERSION}-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON=/usr/local/bin/python
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential libffi-dev libxml2-dev libxslt1-dev libjpeg-dev zlib1g-dev \
      libfreetype6-dev libtiff-dev libwebp-dev curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.5.11
WORKDIR /app

# Install deps in their own layer so source edits don't bust the cache.
COPY apps/clio-sandbox/pyproject.toml apps/clio-sandbox/uv.lock* ./
RUN uv sync --frozen --no-install-project || uv sync --no-install-project

# Copy source and install the package itself.
COPY apps/clio-sandbox/src ./src
RUN uv sync --no-dev || uv sync

# -------- runtime ----------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libxml2 libxslt1.1 libjpeg62-turbo zlib1g libfreetype6 libtiff6 libwebp7 \
      ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 sandbox \
 && useradd --system --uid 1001 --gid sandbox --create-home --shell /usr/sbin/nologin sandbox
WORKDIR /app

COPY --from=base /app /app
RUN chown -R sandbox:sandbox /app

USER sandbox
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=3).status==200 else 1)"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["uvicorn", "sandbox.server:app", "--host", "0.0.0.0", "--port", "8001"]
