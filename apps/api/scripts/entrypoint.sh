#!/bin/sh
# Capiro API container entrypoint.
#
# Two modes, selected by argv:
#   serve    (default) -- start the NestJS HTTP server.
#   migrate  -- run prisma migrate deploy and exit. The CDK migration task
#               definition overrides the container command to "migrate".
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
    exec node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
    ;;
  migrate-resolve)
    # Mark a specific migration as rolled-back so a subsequent `migrate
    # deploy` will retry it. Used to recover from a failed migration that
    # left the `_prisma_migrations` table in failed state. argv:
    #   migrate-resolve <migration-name>
    shift
    if [ -z "$1" ]; then echo "migrate-resolve requires a migration name" >&2; exit 1; fi
    echo "Marking migration $1 as rolled-back"
    exec node ./node_modules/prisma/build/index.js migrate resolve --rolled-back "$1" --schema=./prisma/schema.prisma
    ;;
  db-execute)
    # Run a SQL statement passed as a single argv against the configured
    # DATABASE_URL. Operations role: maintenance work like dropping
    # orphan tables left behind by an earlier branch's migrations.
    # argv: db-execute "<SQL>"
    shift
    if [ -z "$1" ]; then echo "db-execute requires a SQL string argv" >&2; exit 1; fi
    echo "Executing SQL via prisma db execute"
    printf '%s' "$1" | exec node ./node_modules/prisma/build/index.js db execute --stdin --schema=./prisma/schema.prisma
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
  serve)
    echo "Starting Capiro API"
    exec node dist/main.js
    ;;
  *)
    echo "Unknown command: $1 (expected: serve | migrate | bootstrap-capiro-admin | bootstrap-tenant | bootstrap-roles)" >&2
    exit 1
    ;;
esac
