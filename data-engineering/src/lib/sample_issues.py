"""The fictional Jira issues every exercise uses, in the shape Jira's search endpoint returns them."""

import copy
import json
from pathlib import Path
from typing import Any

SAMPLE_PATH = Path(__file__).parent.parent / "data" / "jira_issues.json"

_issues: list[dict[str, Any]] = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))


def sample_issues() -> list[dict[str, Any]]:
    """A deep copy, so a test can change an issue without affecting the next one."""
    return copy.deepcopy(_issues)
