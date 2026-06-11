# ADR 0001 — Clio analysis sandbox isolation (F4)

**Status:** Accepted · **Date:** 2026-06-10 · **Owner:** Clio platform

## Context

Assistant-parity F4 adds a `run_analysis` tool: Clio writes Python, the
platform executes it and returns stdout, result tables, and chart PNGs. The
code is model-generated from possibly prompt-injected context, so it must be
treated as hostile. Hard scope for v1: **no network egress, no DB credentials
inside the sandbox, read-only inputs.**

The plan called for a week-1 spike: gVisor vs nsjail vs Firecracker on current
infra. Current infra (memory + `infra/`): everything runs on **ECS Fargate**
(arm64, single cluster `capiro-dev`, CDK-managed), no EC2 capacity, no
self-managed container hosts.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| gVisor (runsc) | **Rejected** | Requires a custom container runtime on the host. Fargate does not allow alternative runtimes or privileged containers; adopting gVisor means standing up and patching an EC2 ECS fleet — a new ops surface that contradicts the all-Fargate model and is the single largest schedule risk in the plan. |
| nsjail | **Rejected** | Needs `CAP_SYS_ADMIN`/user-namespace privileges to build its jail; Fargate denies privileged mode and most cap-adds. Same EC2-fleet consequence as gVisor. |
| Firecracker (self-managed) | **Rejected** | Maximum isolation, maximum ops burden (bare-metal/`/dev/kvm` hosts). |
| **Fargate task as the microVM boundary** | **Accepted** | Fargate already runs every task in its own **Firecracker microVM** — the third option in the plan's list, operated by AWS instead of us. We get VM-level isolation from the API service and from other tenants' infrastructure with zero new host management. |

## Decision

Run the sandbox as a **separate ECS Fargate service** (`clio-sandbox`), with
isolation layered as follows (defense in depth, outermost first):

1. **MicroVM boundary (AWS Firecracker via Fargate).** The sandbox runner is
   its own task definition — a separate process on separate kernel/VM from
   the API. A container escape still lands inside a VM that has nothing in it.
2. **Network egress: deny-all at the infrastructure layer.** The sandbox
   service's security group has **no egress rules** except the VPC-local
   ingress from the API service's SG on the service port. No NAT route, no
   DNS resolution beyond VPC-internal (and nothing to connect to). This is
   enforced *outside* the sandboxed code's reach — stronger than any
   in-process block.
3. **No credential material.** The task role has **zero IAM permissions**; no
   DB connection string, no AWS keys, no Anthropic key in the task env. The
   only secret is the inbound bearer token the API uses to call it.
4. **Container hardening.** Non-root user, read-only root filesystem, tmpfs
   work directory (size-capped), pinned image containing exactly
   python + pandas/numpy/matplotlib and the Node runner; task-level ulimits
   (`nproc`, `nofile`).
5. **Per-run process hardening (harness.py).** Each run executes in a fresh
   temp directory via a harness that: sets POSIX rlimits (CPU 30s, address
   space 1 GB, 64 processes, 20 MB file size, 256 fds), installs a
   `sys.addaudithook` that raises on `socket.*`, `subprocess.*`,
   `os.system`/`os.exec*`, and `ctypes` loads, forces the matplotlib `Agg`
   backend, and wall-clock-kills from the Node side at 35s. Inputs are
   serialized dataset files written read-only into the workdir; outputs are
   capped (stdout 64 KB, ≤6 PNGs ≤2 MB each).

The API side talks to the runner over plain VPC-internal HTTP with a shared
bearer token; the `run_analysis` tool is registered **per tenant** (explicit
opt-in via tenant feature flags) behind a global env kill-switch
(`CLIO_ANALYSIS_SANDBOX_ENABLED`) that removes the tool from the registry
instantly. Every run is audit-logged (tenant, user, sha256 of code, dataset
names, outcome).

## Consequences

- No new host fleet; the sandbox ships like every other Capiro service
  (image → ECR → Fargate service via CDK). CDK work: one service, one SG
  pair, no task-role grants.
- The egress guarantee is infrastructure-level and pen-testable from inside
  the sandbox (socket/DNS attempts must fail) — covered by
  `apps/clio-sandbox/scripts/pentest.ts` plus the in-repo checklist.
- In-process hardening (rlimits/audit hooks) is the *inner* layer only; we
  do not rely on it for tenant isolation. Concurrent runs share one task in
  v1 (per-run temp dirs, per-run process); if cross-run isolation needs to
  harden further, the documented upgrade path is one Fargate task per run
  (RunTask) at higher latency/cost — an operational change, not a redesign.
- Local development on Windows lacks POSIX rlimits; the harness degrades
  gracefully (audit hooks still active) and the pen-test marks rlimit checks
  as skipped — the authoritative environment for the full checklist is the
  containerized runner.
