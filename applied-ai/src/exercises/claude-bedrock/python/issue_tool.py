"""The get_issue tool of the Python twin: its spec for toolConfig and how to run the calls the model makes."""

import json
import re
from pathlib import Path
from typing import Any

ISSUES_FILE = Path(__file__).resolve().parents[3] / "data" / "issues.json"
ISSUE_KEY = re.compile(r"^[A-Z][A-Z0-9_]+-\d+$")

GET_ISSUE_SPEC = {
    "toolSpec": {
        "name": "get_issue",
        "description": "Returns the summary, status, assignee, priority, type, last update and description of one "
        "Jira issue, by key. Use it whenever the user mentions an issue key such as PLAT-101. "
        "It cannot search or list issues.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "pattern": ISSUE_KEY.pattern, "description": "Jira issue key"}
                },
                "required": ["key"],
                "additionalProperties": False,
            }
        },
    }
}


def load_issues() -> dict[str, dict[str, Any]]:
    """The fictional issues shared with the TypeScript exercises, by key."""
    return {issue["key"]: issue for issue in json.loads(ISSUES_FILE.read_text(encoding="utf-8"))}


def run_tool(tool_use: dict[str, Any], issues: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Runs one tool call. The input comes from the model, so it is validated, and every failure becomes an error
    result the model can read and act on, never an exception that ends the conversation."""
    tool_use_id, name, tool_input = tool_use["toolUseId"], tool_use["name"], tool_use.get("input")

    def error(text: str) -> dict[str, Any]:
        return {"toolUseId": tool_use_id, "status": "error", "content": [{"text": text}]}

    if name != "get_issue":
        return error(f'Unknown tool "{name}". Available tools: get_issue.')
    key = tool_input.get("key") if isinstance(tool_input, dict) else None
    if not isinstance(key, str) or not ISSUE_KEY.match(key):
        return error("Invalid input for get_issue: expected a Jira issue key such as PLAT-101 in `key`.")
    issue = issues.get(key)
    if issue is None:
        return error(f"No issue {key} exists. Ask the user to check the key.")
    fields = issue["fields"]
    view = {
        "key": key,
        "summary": fields["summary"],
        "status": fields["status"]["name"],
        "assignee": (fields.get("assignee") or {}).get("displayName"),
        "priority": (fields.get("priority") or {}).get("name"),
        "type": (fields.get("issuetype") or {}).get("name"),
        "updated": fields["updated"],
        "description": fields.get("description"),
    }
    return {"toolUseId": tool_use_id, "status": "success", "content": [{"json": view}]}
