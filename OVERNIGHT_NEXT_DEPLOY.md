# §15. Deploy steps needed when Docker is back

Docker Desktop daemon crashed mid-session and I couldn't recover it from this shell. Two web commits are sitting in git on `dev/quizzical-goldstine-364ded` but the deployed web image still predates them.

## What's live in staging right now (last verified)

- Workspace 3-column layout, artifact panel, clarifying-question modal, markdown rendering, auto-titled sessions, tool-call ribbons (small chip form).
- All Clio backend features: per-user memory, web search, render artifact, get client context, etc.

## What's committed but NOT YET in the deployed web image

| Commit | What it adds |
|---|---|
| `ddd4bac` | Session delete via three-dots menu (hover-revealed). Collapsible left sidebar (icons-only mode). Collapsible right artifact panel (44px rail when closed). Expandable tool-call summary card ("Used N tools" → click to reveal per-tool details). Layout state persisted to localStorage. |
| `30c27e2` | New `/connectors` page (linked from primary nav with the API/plug icon). Card grid for 11 connector types grouped by category. Microsoft 365 is wired to the existing OAuth flow; the other 10 are "Coming soon" stubs that match the design spec. |

## How to deploy when Docker is back

1. Start Docker Desktop and wait for the daemon (`docker info` succeeds).
2. From the repo root in this worktree:

   ```bash
   docker buildx build --platform linux/arm64 \
     -f apps/web/Dockerfile \
     -t 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest \
     --push .
   ```

3. Force the ECS service to pull the new image:

   ```bash
   aws ecs update-service \
     --cluster capiro-staging \
     --service capiro-staging-web \
     --force-new-deployment
   ```

4. Wait ~3 minutes, hard-reload `https://app.staging.capiro.ai/workspace` and `/connectors`.

That's it — no DB migrations, no API changes, no CDK changes. Both commits are purely SPA-side.

## Why the build failed silently earlier

`docker buildx build --push` was running in the background and Docker Desktop's daemon process died midway. The Bash tool reported "Background command completed (exit code 0)" because the shell wrapper exited normally even though the buildx subprocess errored against a missing daemon socket. The output file was empty so I assumed success and moved on to the deploy step. Next time I see a 0-byte stdout from a docker build, I'll verify ECR push timestamp before declaring done.
