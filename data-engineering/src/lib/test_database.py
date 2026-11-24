import psycopg
import pytest

from lib.database import (
    START_POSTGRES,
    PostgresUnavailableError,
    admin_url,
    check_postgres,
    libpq_environment,
    temporary_database,
    temporary_schema,
    with_database,
)


def database_exists(name: str) -> bool:
    with psycopg.connect(admin_url()) as connection:
        return connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", [name]).fetchone() is not None


def test_temporary_database_is_created_and_dropped(database_url: str) -> None:
    with temporary_database("lib_check") as url:
        name = psycopg.conninfo.conninfo_to_dict(url)["dbname"]
        assert isinstance(name, str) and name.startswith("lib_check_")
        assert database_exists(name)
    assert not database_exists(name)


def test_temporary_schema_is_dropped_with_its_tables(database_url: str) -> None:
    with temporary_schema(database_url) as name, psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(f"CREATE TABLE {name}.things (id int)")
    with psycopg.connect(database_url) as connection:
        found = connection.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", [name]).fetchone()
    assert found is None


def test_unreachable_postgres_fails_with_the_command_that_starts_it() -> None:
    with pytest.raises(PostgresUnavailableError, match="docker compose up -d --wait"):
        check_postgres("postgresql://postgres:postgres@127.0.0.1:1/postgres")
    assert "docker compose up -d --wait" in START_POSTGRES


def test_connection_strings_convert_to_libpq_variables() -> None:
    url = with_database("postgresql://postgres:secret@localhost:5810/postgres", "warehouse")
    assert libpq_environment(url) == {
        "PGHOST": "localhost",
        "PGPORT": "5810",
        "PGUSER": "postgres",
        "PGPASSWORD": "secret",
        "PGDATABASE": "warehouse",
    }
