"""Temporary databases and schemas on the kata's Postgres, so every test session starts from nothing."""

import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

DEFAULT_ADMIN_URL = "postgresql://postgres:postgres@localhost:5810/postgres"
START_POSTGRES = "Start Postgres first: docker compose up -d --wait"


class PostgresUnavailableError(RuntimeError):
    """Postgres does not answer; the message says how to start it."""


def admin_url() -> str:
    """The connection used to create and drop databases; `DATABASE_ADMIN_URL` overrides it (for example in CI)."""
    return os.environ.get("DATABASE_ADMIN_URL", DEFAULT_ADMIN_URL)


def with_database(conninfo: str, dbname: str) -> str:
    """The same server and credentials, another database."""
    return make_conninfo(conninfo, dbname=dbname)


def libpq_environment(conninfo: str) -> dict[str, str]:
    """`PGHOST`, `PGPORT`, … for tools that read the standard libpq variables, such as the dbt profile."""
    names = {"host": "PGHOST", "port": "PGPORT", "user": "PGUSER", "password": "PGPASSWORD", "dbname": "PGDATABASE"}
    params = conninfo_to_dict(conninfo)
    return {env: str(params[key]) for key, env in names.items() if key in params}


def check_postgres(conninfo: str) -> None:
    """Fails fast, with the command that fixes it, instead of a connection error in the middle of a test."""
    try:
        with psycopg.connect(conninfo, connect_timeout=3) as connection:
            connection.execute("SELECT 1")
    except psycopg.OperationalError as error:
        raise PostgresUnavailableError(START_POSTGRES) from error


@contextmanager
def temporary_database(prefix: str, conninfo: str | None = None) -> Iterator[str]:
    """Creates `<prefix>_<random suffix>`, yields its connection string and drops it afterwards, even on failure."""
    admin = conninfo or admin_url()
    check_postgres(admin)
    name = f"{prefix}_{secrets.token_hex(4)}"
    with psycopg.connect(admin, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield with_database(admin, name)
    finally:
        with psycopg.connect(admin, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


@contextmanager
def temporary_schema(conninfo: str, prefix: str = "test") -> Iterator[str]:
    """Creates `<prefix>_<random suffix>` in an existing database, yields its name and drops it with its tables."""
    name = f"{prefix}_{secrets.token_hex(4)}"
    with psycopg.connect(conninfo, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    try:
        yield name
    finally:
        with psycopg.connect(conninfo, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(name)))
