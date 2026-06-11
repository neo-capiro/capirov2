# Clio analysis sandbox harness (assistant-parity F4).
#
# Inner hardening layer only — tenant isolation comes from the Fargate
# microVM + no-egress security group + zero-permission task role (see
# docs/adr/0001-clio-analysis-sandbox-isolation.md). This harness:
#   1. sets POSIX rlimits (CPU/memory/processes/file-size/fds),
#   2. installs an audit hook that raises on network, subprocess, and
#      native-code-loading events,
#   3. forces the matplotlib Agg backend,
#   4. executes ./code.py in a fresh namespace,
#   5. saves open matplotlib figures to ./out/fig_N.png and, if the script
#      defined a `results` object (dict / list / DataFrame), writes
#      ./out/results.json.
#
# Datasets are pre-written into the working directory by the runner
# (./data/<name>.csv or .json) before this harness starts.

import io
import json
import os
import sys

WORKDIR = os.getcwd()
OUT_DIR = os.path.join(WORKDIR, "out")
MAX_FIGURES = 6

os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. POSIX rlimits (degrade gracefully on non-POSIX dev hosts) ──────────
try:
    import resource

    CPU_SECONDS = int(os.environ.get("SANDBOX_CPU_SECONDS", "30"))
    MEM_BYTES = int(os.environ.get("SANDBOX_MEM_BYTES", str(1024 * 1024 * 1024)))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (MEM_BYTES, MEM_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024 * 1024, 20 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
except Exception:  # noqa: BLE001 - resource is unavailable on Windows dev hosts
    sys.stderr.write("[harness] rlimits unavailable on this platform\n")

# ── 2. Pre-import the allowed analysis stack BEFORE arming the hook ───────
# numpy's import chain legitimately loads native code (ctypes.dlopen); warm
# the allowed libraries first so the audit hook only constrains USER code.
try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot  # noqa: F401
except Exception:  # noqa: BLE001 - matplotlib genuinely optional
    pass
try:
    import numpy  # noqa: F401
    import pandas  # noqa: F401
except Exception:  # noqa: BLE001 - allow pure-python analysis without them
    pass

# ── 3. Audit hook: no network, no subprocesses, no NEW native loading ──────
BLOCKED_PREFIXES = (
    "socket.",
    "subprocess.",
    "os.system",
    "os.exec",
    "os.posix_spawn",
    "os.spawn",
    "os.fork",
    "ctypes.",
    "webbrowser.",
    "ftplib.",
    "smtplib.",
)
ALLOWED_EXACT = {
    # benign event some libraries touch at runtime
    "socket.gethostname",
}


def _audit(event, args):  # noqa: ANN001
    if event in ALLOWED_EXACT:
        return
    for prefix in BLOCKED_PREFIXES:
        if event.startswith(prefix):
            raise RuntimeError(f"sandbox: blocked operation '{event}'")


sys.addaudithook(_audit)

# ── 4. Run the user code ───────────────────────────────────────────────────
CODE_PATH = os.path.join(WORKDIR, "code.py")
with io.open(CODE_PATH, "r", encoding="utf-8") as fh:
    user_code = fh.read()

namespace = {"__name__": "__main__", "__file__": CODE_PATH}
exit_code = 0
try:
    exec(compile(user_code, "code.py", "exec"), namespace)  # noqa: S102
except SystemExit as exc:  # honor explicit sys.exit codes
    exit_code = int(exc.code or 0)
except Exception:  # noqa: BLE001 - report, don't crash the harness
    import traceback

    traceback.print_exc()
    exit_code = 1

# ── 5. Persist figures + results ───────────────────────────────────────────
try:
    import matplotlib.pyplot as plt

    for index, num in enumerate(plt.get_fignums()[:MAX_FIGURES]):
        plt.figure(num)
        plt.savefig(os.path.join(OUT_DIR, f"fig_{index + 1}.png"), format="png", dpi=110)
except Exception:  # noqa: BLE001
    pass

try:
    results = namespace.get("results")
    if results is not None:
        try:
            import pandas as pd

            if isinstance(results, pd.DataFrame):
                results = results.head(500).to_dict(orient="records")
        except Exception:  # noqa: BLE001
            pass
        with io.open(os.path.join(OUT_DIR, "results.json"), "w", encoding="utf-8") as fh:
            json.dump(results, fh, default=str)
except Exception:  # noqa: BLE001
    sys.stderr.write("[harness] could not serialize `results`\n")

sys.exit(exit_code)
