import pytest

from exercises.incremental_jira_extractor.config import ConfigError, load_settings

VALID = {
    "JIRA_BASE_URL": "https://example.atlassian.net",
    "JIRA_EMAIL": "etl@example.com",
    "JIRA_API_TOKEN": "replace-with-an-api-token",
    "JIRA_JQL_FILTER": "project in (PAY, WAL)",
    "DATABASE_URL": "postgresql://postgres:postgres@localhost:5810/postgres",
}


def test_reads_required_values_and_applies_defaults() -> None:
    settings = load_settings(VALID | {"PAGE_SIZE": "50"})

    assert settings.page_size == 50
    assert (settings.database_schema, settings.overlap_minutes, settings.freshness_max_age_hours) == ("raw", 15, 48)
    assert "replace-with-an-api-token" not in repr(settings)  # SecretStr hides it from logs and tracebacks


def test_lists_every_missing_variable_at_once() -> None:
    with pytest.raises(ConfigError) as raised:
        load_settings({})

    message = str(raised.value)
    for variable in ("JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_JQL_FILTER", "DATABASE_URL"):
        assert variable in message


@pytest.mark.parametrize(
    ("variable", "value"),
    [("DATABASE_SCHEMA", "raw; DROP TABLE x"), ("PAGE_SIZE", "0"), ("JIRA_BASE_URL", "example.atlassian.net")],
)
def test_rejects_invalid_values(variable: str, value: str) -> None:
    with pytest.raises(ConfigError, match=variable):
        load_settings(VALID | {variable: value})
