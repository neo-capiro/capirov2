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
  # ── Federal data sync jobs ─────────────────────────────────────────────
  # These populate the Data Explorer source tables (LDA, Congress, FedReg,
  # Hearings, GAO, CRS, FEC, FARA, SEC, RSS intel, state bills, economic
  # indicators, grants). Wired so EventBridge can dispatch each as a
  # one-off ECS task — keep the case names in kebab-case matching the
  # script file so cron rules stay trivially mappable.
  sync-lda)               exec ./node_modules/.bin/tsx scripts/sync-lda.ts ;;
  sync-congress)          exec ./node_modules/.bin/tsx scripts/sync-congress.ts ;;
  sync-federal-register)  exec ./node_modules/.bin/tsx scripts/sync-federal-register.ts ;;
  sync-regulations)       exec ./node_modules/.bin/tsx scripts/sync-regulations.ts ;;
  sync-hearings)          exec ./node_modules/.bin/tsx scripts/sync-hearings.ts ;;
  sync-gao)               exec ./node_modules/.bin/tsx scripts/sync-gao.ts ;;
  sync-crs)               exec ./node_modules/.bin/tsx scripts/sync-crs.ts ;;
  sync-fec)               exec ./node_modules/.bin/tsx scripts/sync-fec.ts ;;
  sync-fara)              exec ./node_modules/.bin/tsx scripts/sync-fara.ts ;;
  sync-sec-edgar)         exec ./node_modules/.bin/tsx scripts/sync-sec-edgar.ts ;;
  sync-rss-intel)         exec ./node_modules/.bin/tsx scripts/sync-rss-intel.ts ;;
  sync-openstates)        exec ./node_modules/.bin/tsx scripts/sync-openstates.ts ;;
  sync-bls)               exec ./node_modules/.bin/tsx scripts/sync-bls.ts ;;
  sync-bea)               exec ./node_modules/.bin/tsx scripts/sync-bea.ts ;;
  sync-census)            exec ./node_modules/.bin/tsx scripts/sync-census.ts ;;
  sync-grants)            exec ./node_modules/.bin/tsx scripts/sync-grants.ts ;;
  sync-openlobby)         exec ./node_modules/.bin/tsx scripts/sync-openlobby.ts ;;
  sync-openspending)      exec ./node_modules/.bin/tsx scripts/sync-openspending.ts ;;
  sync-lobby-trending)    exec ./node_modules/.bin/tsx scripts/sync-lobby-trending.ts ;;
  refresh-lobby-intel-mv) exec ./node_modules/.bin/tsx scripts/refresh-lobby-intel-mv.ts ;;
  serve)
    echo "Starting Capiro API"
    exec node dist/main.js
    ;;
  *)
    echo "Unknown command: $1 (expected: serve | migrate | seed-workflows | bootstrap-capiro-admin | bootstrap-tenant | bootstrap-roles | emit-changes | backfill-sectors | generate-briefings | compute-health-scores | check-comment-periods | sync-lda | sync-congress | sync-federal-register | sync-regulations | sync-hearings | sync-gao | sync-crs | sync-fec | sync-fara | sync-sec-edgar | sync-rss-intel | sync-openstates | sync-bls | sync-bea | sync-census | sync-grants | sync-openlobby | sync-openspending | sync-lobby-trending | refresh-lobby-intel-mv)" >&2
    exit 1
    ;;
esac
