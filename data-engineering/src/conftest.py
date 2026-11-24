"""Shared fixtures: one temporary database per test session, one schema per test that needs isolation, and the
warehouse that dbt builds once per session."""

import subprocess
from collections.abc import Iterator

import pytest

from exercises.dbt_basics.dbt_runner import run_dbt
from exercises.dbt_basics.load_raw_issues import load_raw_issues
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


@pytest.fixture(scope="session")
def dbt_build(database_url: str) -> subprocess.CompletedProcess[str]:
    """The fictional issues landed in `raw` and `dbt build` run once, as the nightly job would. Returns its output."""
    load_raw_issues(database_url)
    build = run_dbt(["build"], database_url)
    if build.returncode != 0:
        pytest.fail(f"dbt build failed:\n{build.stdout}\n{build.stderr}")
    return build
