from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLIO_", env_file=".env", extra="ignore")

    bind_host: str = "0.0.0.0"
    bind_port: int = 8000
    log_level: str = "INFO"

    # Bedrock — model id is a cross-region inference profile to match the
    # ACTIVE list returned by `aws bedrock list-inference-profiles` in the
    # Capiro AWS account. Override per-env via CLIO_BEDROCK_MODEL_ID.
    bedrock_region: str = "us-east-1"
    bedrock_model_id: str = "us.anthropic.claude-sonnet-4-6"
    bedrock_max_tokens: int = 4096
    bedrock_temperature: float = 0.7

    # Capiro API base URL — used by tool-callback flow in later phases.
    # Empty in Phase 0 (no tools yet).
    capiro_api_base_url: str = ""

    # Shared secret used by Capiro API to authenticate to Clio. Phase 0
    # leaves this empty; Phase 1 wires it through Secrets Manager.
    inbound_shared_secret: str = Field(default="", repr=False)


settings = Settings()
