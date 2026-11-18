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
    # text-embedding-3-large emits 3072 dimensions by default, above the
    # Firestore vector index ceiling (D3). text-embedding-3 models support
    # requesting fewer dimensions, so D2 and D3 are reconciled here. Must
    # match vectorConfig.dimension in firebase/firestore.indexes.json.
    embedding_dimensions: int = 1536

    # Firebase
    firebase_project_id: str = ""
    use_firestore_emulator: bool = True
    firestore_emulator_host: str = "localhost:8080"
    firebase_auth_emulator_host: str = "localhost:9099"

    # NFR2 budgets, re-scoped per D13. NFR2a is the interactive student
    # facing tutor turn, a single short call. NFR2b is curriculum
    # generation, 7 sequential model calls plus the FR3 self correction
    # loop, which measured 253s to 673s in the Step 3.3 dev runs.
    generation_timeout_seconds: int = 900
    tutor_turn_timeout_seconds: int = 15
    max_critic_regeneration_cycles: int = 2

    frontend_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# D8 critic strategy map. A new subject must be classified here before it
# can run (BUILD_GUIDE Step 3.3). quantitative gets the two pass
# independent solve protocol, open_ended gets claim verification.
SUBJECT_TYPES: dict[str, str] = {
    "math": "quantitative",
    "physics": "quantitative",
    "science": "open_ended",
    "history": "open_ended",
    "literature": "open_ended",
}


def subject_type(subject: str) -> str:
    try:
        return SUBJECT_TYPES[subject]
    except KeyError:
        raise ValueError(
            f"Subject '{subject}' is not classified in SUBJECT_TYPES, "
            "classify it before running the pipeline (D8)"
        ) from None
