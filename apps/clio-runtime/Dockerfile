# Clio runtime container.
#
# Build context: repository root.
#   docker buildx build --platform linux/arm64 -f apps/clio-runtime/Dockerfile -t clio-runtime:local .
#
# This runtime exposes the private Hermes-compatible API surface used by the
# Capiro backend and persists session events under HERMES_HOME (/opt/data).

ARG NODE_VERSION=20.16.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/clio-runtime/package.json apps/clio-runtime/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@capiro/clio-runtime

COPY apps/clio-runtime/src apps/clio-runtime/src
COPY apps/clio-runtime/tsconfig.json apps/clio-runtime/tsconfig.json
RUN pnpm --filter @capiro/clio-runtime build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV HERMES_HOME=/opt/data
RUN groupadd --system --gid 10000 clio \
 && useradd --system --uid 10000 --gid clio --home-dir /opt/data --shell /usr/sbin/nologin clio \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates dumb-init wget \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/data \
 && chown -R clio:clio /opt/data

WORKDIR /app
COPY --from=build /workspace/apps/clio-runtime/dist /app/dist
COPY --from=build /workspace/apps/clio-runtime/package.json /app/package.json

USER clio
VOLUME ["/opt/data"]
EXPOSE 8642
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]
