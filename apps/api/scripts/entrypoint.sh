#!/bin/sh
# Capiro API container entrypoint.
#
# Modes, selected by argv:
#   serve           (default) -- start the NestJS HTTP server.
#   migrate         -- run prisma migrate deploy, then seed workflow templates,
#                      and exit. The CDK migration task definition overrides the
#                      container command to "migrate". The data seed is
#                      idempotent (upserts) so re-running on every deploy is
#                      safe and keeps the workflow catalog in sync with the
#                      seed file in git.
#   seed-workflows  -- run only the workflow template seed (idempotent upserts).
#                      Useful for one-shot reseeds without invoking migrations.
#
# In both modes we compose DATABASE_URL from the individual DB_* secrets
# injected by ECS from the Aurora master credential. We require sslmode=require
# because Aurora's parameter group has rds.force_ssl=1.

set -e

if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "Missing DB_* env vars (got DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_USER=$DB_USER DB_NAME=$DB_NAME)" >&2
  exit 1
fi

# URL-encode the password — Aurora passwords occasionally contain characters
# that are not URL-safe. Pure-shell encoding because we want zero deps.
encode() {
  awk -v str="$1" 'BEGIN {
    for (i = 1; i <= length(str); i++) {
      c = substr(str, i, 1)
      if (c ~ /[A-Za-z0-9._~-]/) printf "%s", c
      else printf "%%%02X", ord_lookup[c] ? ord_lookup[c] : 0 + sprintf("%d", c)
    }
  }'
}
# Fallback: use node since it's always present in this image.
ENCODED_PASSWORD=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")

export DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

case "${1:-serve}" in
  migrate)
    echo "Running prisma migrate deploy"
    # Auto-resolve any previously failed migrations before deploying.
    # Prisma refuses to apply new migrations if a prior one is in failed state.
    # We query the _prisma_migrations table directly for any failed entries and
    # mark them as rolled-back so migrate deploy can proceed cleanly.
    node -e "
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      (async () => {
        try {
          const failed = await p.\$queryRaw\`
            SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NULL AND rolled_back_at IS NULL
          \`;
          for (const row of failed) {
            console.log('Resolving failed migration:', row.migration_name);
            await p.\$executeRaw\`
              UPDATE _prisma_migrations
              SET rolled_back_at = NOW()
              WHERE migration_name = \${row.migration_name}
            \`;
          }
        } catch (e) { /* table may not exist on first run */ }
        await p.\$disconnect();
      })();
    "
    node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
    echo "Seeding workflow templates"
    # Data seed (idempotent UPSERTs). Source of truth is prisma/seed-workflows.ts.
    # Re-asserts the catalog on every migration deploy so prod / staging stay in
    # sync with the file in git.
    exec ./node_modules/.bin/tsx prisma/seed-workflows.ts
    ;;
  seed-workflows)
    echo "Seeding workflow templates"
    exec ./node_modules/.bin/tsx prisma/seed-workflows.ts
    ;;
  bootstrap-capiro-admin)
    shift
    echo "Running bootstrap-capiro-admin $*"
    # node_modules/.bin/tsx is a shell wrapper that invokes node against
    # tsx's JS entry; call it directly.
    exec ./node_modules/.bin/tsx scripts/bootstrap-capiro-admin.ts "$@"
    ;;
  bootstrap-tenant)
    shift
    echo "Running bootstrap-tenant $*"
    exec ./node_modules/.bin/tsx scripts/bootstrap-tenant.ts "$@"
    ;;
  bootstrap-roles)
    shift
    echo "Running bootstrap-roles (rotate capiro_app password)"
    exec ./node_modules/.bin/tsx scripts/bootstrap-roles.ts "$@"
    ;;
  emit-changes)
    echo "Running emit-changes (post-sync IntelligenceChange emitter)"
    exec ./node_modules/.bin/tsx scripts/emit-changes.ts
    ;;
  backfill-sectors)
    echo "Running backfill-sector-tags"
    exec ./node_modules/.bin/tsx scripts/backfill-sector-tags.ts
    ;;
  generate-briefings)
    echo "Running generate-briefings"
    exec ./node_modules/.bin/tsx scripts/generate-briefings.ts
    ;;
  compute-health-scores)
    echo "Running compute-health-scores"
    exec ./node_modules/.bin/tsx scripts/compute-health-scores.ts
    ;;
  check-comment-periods)
    echo "Running check-comment-periods"
    exec ./node_modules/.bin/tsx scripts/check-comment-periods.ts
    ;;
  serve)
    echo "Starting Capiro API"
    exec node dist/main.js
    ;;
  *)
    echo "Unknown command: $1 (expected: serve | migrate | seed-workflows | bootstrap-capiro-admin | bootstrap-tenant | bootstrap-roles | emit-changes | backfill-sectors | generate-briefings | compute-health-scores | check-comment-periods)" >&2
    exit 1
    ;;
esac
