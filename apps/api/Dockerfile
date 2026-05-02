# Capiro API container.
#
# Build context: REPOSITORY ROOT (not apps/api).
#   docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t capiro-api:local --push .
#
# Multi-stage:
#   1. base    pnpm + corepack on slim node
#   2. build   install + compile, then `pnpm prune --prod` in place
#   3. runtime minimal node slim, non-root user, copies the pruned workspace
#
# Why we DON'T use `pnpm deploy`: it doesn't carry generated Prisma client
# files (which live under pnpm's symlinked store at .pnpm/@prisma+client@*/.prisma).
# Instead, we prune dev deps in place and copy the whole workspace.

ARG NODE_VERSION=20.16.0

# -------- base ----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

# -------- build ---------------------------------------------------------------
FROM base AS build
# Prisma's binary engine wants libssl. Bookworm ships OpenSSL 3 but Prisma
# can't detect it without the package present.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@capiro/api... --filter=@capiro/shared...

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/nest-cli.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/scripts apps/api/scripts

RUN pnpm --filter @capiro/shared build
RUN pnpm --filter @capiro/api exec prisma generate
RUN pnpm --filter @capiro/api build

# Prune dev dependencies in place (keeps the .pnpm store with the generated
# Prisma client intact).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter=@capiro/api... --filter=@capiro/shared...

# -------- runtime -------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
RUN groupadd --system --gid 1001 capiro \
 && useradd --system --uid 1001 --gid capiro --shell /usr/sbin/nologin capiro \
 && apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates dumb-init openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy the entire workspace — pnpm's symlinked node_modules + the generated
# Prisma client + the compiled API. Larger image (~250MB) but reliable.
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/packages/shared/dist /app/packages/shared/dist
COPY --from=build /workspace/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /workspace/apps/api/dist /app/apps/api/dist
COPY --from=build /workspace/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /workspace/apps/api/prisma /app/apps/api/prisma
COPY --from=build /workspace/apps/api/package.json /app/apps/api/package.json
# bootstrap-* commands run TS scripts via tsx at task launch — copy the
# sources so `node tsx scripts/<name>.ts` resolves at runtime.
COPY --from=build /workspace/apps/api/scripts /app/apps/api/scripts
COPY apps/api/scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && chown -R capiro:capiro /app

USER capiro
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["serve"]
