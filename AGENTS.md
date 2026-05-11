cat > AGENTS.md <<'EOF'
# AGENTS.md

## Project
capirov2

## Setup
- Work from this repo root.
- Before edits, inspect existing structure.
- Prefer small, reviewable diffs.
- Do not delete files unless explicitly asked.
- Run tests or type checks after changes when available.

## Agent roles
- Hermes is the orchestrator.
- Claude Code handles broad implementation, refactors, repo understanding, and multi-file changes.
- Codex handles precise patches, test writing, debugging, reviews, and verification.

## Workflow
1. Hermes decomposes the request.
2. Claude Code drafts implementation.
3. Codex reviews, fixes, and tests.
4. Hermes summarizes final diff and next steps.

## Safety
- Never commit, push, delete branches, or overwrite secrets unless explicitly told.
- Ask before destructive migrations.
EOF