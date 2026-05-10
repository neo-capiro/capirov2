# Capiro Clio agent runtime container.
# Build context: REPOSITORY ROOT (matches apps/api/Dockerfile pattern).
#   docker buildx build --platform linux/arm64 -f apps/clio/Dockerfile -t capiro-clio:local --push .
#
# Multi-stage:
#   1. base    uv (Astral's installer + venv manager) on python 3.13 slim
#   2. build   uv sync into /opt/clio/.venv from pyproject.toml + uv.lock
#   3. runtime debian-slim with the venv + source copied; runs as a non-root
#              user, listens on 8000, no shell access by default
#
# Why uv: matches the pattern Hermes uses upstream, an order of magnitude
# faster than pip for cold installs in CI, and resolves a single lockfile
# deterministically across architectures.

ARG PYTHON_VERSION=3.13
ARG UV_VERSION=0.5.4

# -------- uv source layer (multi-arch) ---------------------------------------
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv_source

# -------- build --------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
COPY --from=uv_source /uv /usr/local/bin/uv

WORKDIR /opt/clio

# Layer-cache deps separately from source so source-only changes don't bust
# the wheel cache.
COPY apps/clio/pyproject.toml apps/clio/uv.lock* /opt/clio/
RUN uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

COPY apps/clio/src /opt/clio/src
COPY apps/clio/README.md /opt/clio/README.md
RUN uv sync --frozen --no-dev || uv sync --no-dev

# -------- runtime ------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/clio/.venv/bin:$PATH" \
    CLIO_BIND_HOST=0.0.0.0 \
    CLIO_BIND_PORT=8000

# Non-root user matching the API container's uid range; ECS doesn't care
# about specific uids but we want consistency for any shared volumes.
RUN useradd --uid 10001 --create-home --home-dir /home/clio --shell /usr/sbin/nologin clio
WORKDIR /opt/clio

# Copy the resolved venv and the source tree from the build stage.
COPY --from=build --chown=clio:clio /opt/clio /opt/clio

USER clio
EXPOSE 8000

# Healthcheck hits the application's /healthz endpoint so ECS uses the same
# signal as the ALB target group, no separate process needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
    sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)" \
    || exit 1

CMD ["uvicorn", "clio.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
