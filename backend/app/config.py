"""Application settings loaded from environment.

Model choices follow docs/DECISIONS.md D1 and D2. The critic runs on a
different vendor family than the generator for independent verification.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LLM providers
    anthropic_api_key: str = ""
    # Required when the Anthropic key is not scoped to a workspace
    anthropic_workspace_id: str = ""
    openai_api_key: str = ""
    generator_model: str = "claude-sonnet-4-6"
    critic_model: str = "gpt-4o"
    tutor_model: str = "claude-sonnet-4-6"
    tutor_fallback_model: str = "claude-haiku-4-5"
    embedding_model: str = "text-embedding-3-large"

    # Firebase
    firebase_project_id: str = ""
    use_firestore_emulator: bool = True
    firestore_emulator_host: str = "localhost:8080"
    firebase_auth_emulator_host: str = "localhost:9099"

    # NFR2 budget: generation plus scoring plus self correction within 15s
    generation_timeout_seconds: int = 15
    max_critic_regeneration_cycles: int = 2

    frontend_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
