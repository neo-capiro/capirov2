#!/bin/sh
# Capiro Workspace container entrypoint.
#
# Modes, selected by argv:
#   serve   (default) -- start the NestJS HTTP server.
#
# Phase 2 will add a `migrate` branch (prisma migrate deploy). For now we only
# handle `serve` and a default fall-through.

set -e

case "${1:-serve}" in
  serve)
    echo "Starting Capiro Workspace"
    exec node dist/main.js
    ;;
  *)
    echo "Unknown command: $1 (expected: serve)" >&2
    exit 1
    ;;
esac
