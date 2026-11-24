"""Settings read from environment variables once, at startup, so a broken deployment fails before touching anything."""

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, ValidationError

# Settings field → environment variable.
ENVIRONMENT = {
    "jira_base_url": "JIRA_BASE_URL",
    "jira_email": "JIRA_EMAIL",
    "jira_api_token": "JIRA_API_TOKEN",
    "jql_filter": "JIRA_JQL_FILTER",
    "database_url": "DATABASE_URL",
    "database_schema": "DATABASE_SCHEMA",
    "page_size": "PAGE_SIZE",
    "overlap_minutes": "OVERLAP_MINUTES",
    "freshness_max_age_hours": "FRESHNESS_MAX_AGE_HOURS",
}


class ConfigError(Exception):
    """Lists every invalid or missing variable at once, not the first one only."""


class ExtractorSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    jira_base_url: HttpUrl
    jira_email: str = Field(min_length=3)
    jira_api_token: SecretStr = Field(min_length=1)
    jql_filter: str = Field(min_length=1, description="Bounds the search, for example `project in (PAY, WAL)`.")
    database_url: str = Field(min_length=1)
    # Goes into the connection's search_path, so it must be a plain identifier.
    database_schema: str = Field(default="raw", pattern=r"^[a-z_][a-z0-9_]*$")
    page_size: int = Field(default=100, ge=1)
    overlap_minutes: int = Field(default=15, ge=1)
    freshness_max_age_hours: int = Field(default=48, ge=1)


def load_settings(environ: Mapping[str, str]) -> ExtractorSettings:
    values = {field: environ[variable] for field, variable in ENVIRONMENT.items() if environ.get(variable)}
    try:
        return ExtractorSettings.model_validate(values)
    except ValidationError as error:
        problems = [f"{ENVIRONMENT[str(issue['loc'][0])]}: {issue['msg']}" for issue in error.errors()]
        raise ConfigError("Invalid configuration: " + "; ".join(problems)) from error
