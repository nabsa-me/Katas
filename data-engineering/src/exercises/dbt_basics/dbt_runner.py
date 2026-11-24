"""Runs the dbt CLI against a chosen database the way CI does: a subprocess, with the connection in libpq variables."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

from lib.database import libpq_environment

PROJECT_DIR = Path(__file__).parent


def dbt_executable() -> str:
    """The `dbt` installed in this virtual environment, next to the running Python, never another one on the PATH."""
    found = shutil.which("dbt", path=str(Path(sys.executable).parent))
    if found is None:
        raise FileNotFoundError("dbt is not installed in this environment: run `uv sync`")
    return found


def run_dbt(args: list[str], database_url: str) -> subprocess.CompletedProcess[str]:
    """`run_dbt(["build"], url)` is `dbt build` with this project and profile, pointed at `url`'s database."""
    env = os.environ | libpq_environment(database_url) | {"DBT_USE_COLORS": "false", "PYTHONUTF8": "1"}
    command = [dbt_executable(), *args, "--project-dir", str(PROJECT_DIR), "--profiles-dir", str(PROJECT_DIR)]
    return subprocess.run(command, env=env, capture_output=True, text=True, encoding="utf-8", check=False, timeout=600)
