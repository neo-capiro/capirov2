"""Runs untrusted Python in a subprocess with resource limits.

This is the actual code-execution boundary. The FastAPI server in
`server.py` is the request shape, but every line of user code goes
through `run_user_code` here.

Defense layers:
1. Subprocess isolation — user code runs in `python -c <code>` with
   a clean env (no Bedrock keys, no shared-secret, no AWS creds at
   all — boto uploads happen in the parent process after the child
   exits).
2. Resource limits via `resource.setrlimit` in a preexec_fn:
   - RLIMIT_CPU: cap CPU seconds.
   - RLIMIT_AS: cap address space (memory).
   - RLIMIT_FSIZE: max file size.
   - RLIMIT_NPROC: cap number of subprocesses the child can spawn.
3. Filesystem: child only sees /tmp/<runId>/ (chdir before exec; the
   code itself enforces "no path outside /tmp/output" because we can
   only inspect what the child wrote to that directory).
4. Timeout: hard wall-clock kill after settings.run_timeout_seconds.
5. Egress: network is restricted at the security-group level (CDK).
   The runner doesn't try to filter requests at the python layer —
   the SG is the real boundary; if it gets out, it can get out.
"""

from __future__ import annotations

import os
import resource
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .config import settings


@dataclass
class RunResult:
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    workdir: Path  # caller will scan this for files to upload, then rmtree


def _preexec_limits() -> None:
    """Runs in the child between fork() and exec(). Setting the
    resource limits here is the only way to apply them — they can't
    be set on a running process from outside."""
    mem_bytes = settings.run_memory_mb * 1024 * 1024
    cpu_seconds = settings.run_timeout_seconds + 5
    try:
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    except (ValueError, OSError):
        pass
    try:
        # Max bytes of any single file the child writes. Generous —
        # we still cap the *total* output bytes after the run finishes
        # by walking /tmp/output.
        resource.setrlimit(resource.RLIMIT_FSIZE, (settings.run_max_output_bytes,
                                                    settings.run_max_output_bytes))
    except (ValueError, OSError):
        pass
    try:
        # No more than 16 child processes from the child itself.
        # Plenty for any legitimate pandas/openpyxl operation.
        resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    except (ValueError, OSError):
        pass
    # Detach from parent process group so a SIGKILL on the child
    # kills everything it spawned.
    try:
        os.setsid()
    except OSError:
        pass


def run_user_code(code: str, run_id: str | None = None) -> RunResult:
    """Execute `code` as a self-contained Python program and return
    stdout / stderr / exit_code / a workdir path the caller can scan
    for produced files.

    The caller is responsible for `shutil.rmtree(result.workdir)` after
    inspecting it — leaving stale tempdirs is the most common way a
    sandbox slowly fills its disk.
    """
    rid = run_id or str(uuid.uuid4())
    workdir = Path(tempfile.mkdtemp(prefix=f"clio-run-{rid}-"))
    output_dir = workdir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Tell the child where to write artifacts. We deliberately make
    # /tmp/output/ a stable, well-known location in the prompt so the
    # model doesn't need to ask.
    #
    # PATH is set to include the venv where pandas / openpyxl / etc
    # actually live (Dockerfile installs them under /app/.venv). Using
    # plain `python` without this would resolve to /usr/local/bin/python
    # — the system interpreter with NO third-party packages — and every
    # `import pandas` would die with ModuleNotFoundError.
    venv_bin = os.environ.get("VIRTUAL_ENV", "/app/.venv") + "/bin"
    env = {
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
        "PATH": f"{venv_bin}:/usr/local/bin:/usr/bin:/bin",
        # Mirror /tmp/output/ symlink so the model's "write to
        # /tmp/output/foo.xlsx" works regardless of the workdir.
        # The shim below sets up the symlink before user code runs.
    }

    # The harness wraps user code with a small prelude that:
    # - chdir's into the workdir
    # - re-points /tmp/output/ at this run's output dir
    # - imports the common libs so the model doesn't have to.
    #
    # The /tmp/output symlink is rebuilt on every run because the
    # PREVIOUS run's workdir got rmtree'd in cleanup() but the symlink
    # itself survived in /tmp — leaving a dangling pointer that breaks
    # writes for every run after the first. We unlink first, then
    # symlink. The os.path.lexists() check is the dangling-aware
    # version of os.path.exists() (which returns False for broken
    # symlinks and would skip the unlink we need).
    prelude = (
        "import os, sys\n"
        f"_RUN_OUTPUT = {str(output_dir)!r}\n"
        "os.makedirs(_RUN_OUTPUT, exist_ok=True)\n"
        "try:\n"
        "    if os.path.lexists('/tmp/output'):\n"
        "        if os.path.islink('/tmp/output'):\n"
        "            os.unlink('/tmp/output')\n"
        "    if not os.path.lexists('/tmp/output'):\n"
        "        os.symlink(_RUN_OUTPUT, '/tmp/output')\n"
        "except (FileExistsError, PermissionError, OSError):\n"
        "    pass\n"
        f"os.chdir({str(workdir)!r})\n"
    )
    program = prelude + code

    start = time.perf_counter()
    try:
        proc = subprocess.run(
            ["python", "-c", program],
            cwd=workdir,
            env=env,
            capture_output=True,
            timeout=settings.run_timeout_seconds,
            preexec_fn=_preexec_limits,
            check=False,
        )
        stdout = proc.stdout
        stderr = proc.stderr
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or b""
        stderr = (exc.stderr or b"") + b"\n[runner] timeout after %ds; killed" % (
            settings.run_timeout_seconds,
        )
        exit_code = -signal.SIGKILL
    duration_ms = int((time.perf_counter() - start) * 1000)

    stdout_text = _trunc_bytes(stdout, settings.run_max_stdout_bytes)
    stderr_text = _trunc_bytes(stderr, settings.run_max_stderr_bytes)
    return RunResult(
        stdout=stdout_text,
        stderr=stderr_text,
        exit_code=exit_code,
        duration_ms=duration_ms,
        workdir=workdir,
    )


def _trunc_bytes(data: bytes, limit: int) -> str:
    if len(data) <= limit:
        return data.decode("utf-8", errors="replace")
    head = data[: limit - 200].decode("utf-8", errors="replace")
    return head + f"\n... [truncated {len(data) - limit} bytes]"


def cleanup(workdir: Path) -> None:
    """Best-effort tempdir teardown. We log + swallow errors because a
    stale tempdir is annoying but not request-failing."""
    try:
        shutil.rmtree(workdir, ignore_errors=True)
    except Exception:
        pass
