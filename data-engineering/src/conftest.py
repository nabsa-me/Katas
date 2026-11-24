"""Shared fixtures: one temporary database per test session and one schema per test that needs isolation."""

from collections.abc import Iterator

import pytest

from lib.database import PostgresUnavailableError, admin_url, check_postgres, temporary_database, temporary_schema


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """Connection string of `data_engineering_<suffix>`, dropped at the end. Stops the run if Postgres is down."""
    try:
        check_postgres(admin_url())
    except PostgresUnavailableError as error:
        pytest.exit(str(error), returncode=1)
    with temporary_database("data_engineering") as url:
        yield url


@pytest.fixture
def schema(database_url: str) -> Iterator[str]:
    """An empty schema for one test, dropped with everything in it afterwards."""
    with temporary_schema(database_url) as name:
        yield name
