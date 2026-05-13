from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide config for the sandbox service.

    All env vars are prefixed `SANDBOX_` so they don't collide with
    Capiro API config or anything ECS injects globally.
    """

    model_config = SettingsConfigDict(env_prefix="SANDBOX_", env_file=".env", extra="ignore")

    bind_host: str = "0.0.0.0"
    bind_port: int = 8001
    log_level: str = "INFO"

    # Bearer-token check on /run. Same shared-secret scheme the Clio
    # runtime uses to call the Capiro API — symmetry keeps the auth
    # model uniform across the three services.
    inbound_shared_secret: str = Field(default="", repr=False)

    # S3 bucket where run artifacts get uploaded.
    # Each run writes under tenants/<tenantId>/clio-runs/<runId>/<file>.
    assets_bucket: str = ""
    assets_region: str = "us-east-1"

    # Subprocess limits enforced on each /run.
    run_timeout_seconds: int = 30
    run_memory_mb: int = 512
    # Max bytes of stdout/stderr surfaced back. The API further
    # truncates these in the tool-result payload.
    run_max_stdout_bytes: int = 1_048_576  # 1MB
    run_max_stderr_bytes: int = 524_288  # 512KB
    # Maximum total size of files the runner can upload from /tmp/output.
    run_max_output_bytes: int = 52_428_800  # 50MB

    # Outbound network policy. Egress is restricted at the SG level
    # in CDK; this list is the python-side guard requests calls go
    # through. Comma-separated host suffixes.
    egress_allowlist: str = (
        "s3.amazonaws.com,"
        "s3.us-east-1.amazonaws.com,"
        "api.github.com,"
        "api.federalregister.gov,"
        "api.duckduckgo.com,"
        "duckduckgo.com,"
        "api.tavily.com"
    )


settings = Settings()
