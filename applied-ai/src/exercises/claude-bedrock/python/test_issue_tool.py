import pytest

from issue_tool import GET_ISSUE_SPEC, load_issues, run_tool

ISSUES = load_issues()


def call(tool_input, name="get_issue"):
    return run_tool({"toolUseId": "tooluse-1", "name": name, "input": tool_input}, ISSUES)


def test_spec_requires_a_key_that_looks_like_a_jira_key():
    schema = GET_ISSUE_SPEC["toolSpec"]["inputSchema"]["json"]
    assert schema["required"] == ["key"]
    assert schema["properties"]["key"]["pattern"] == r"^[A-Z][A-Z0-9_]+-\d+$"


def test_a_valid_key_returns_the_issue_as_json():
    result = call({"key": "PLAT-104"})
    assert result["status"] == "success"
    assert result["content"][0]["json"] | {"description": None} == {
        "key": "PLAT-104",
        "summary": "Payments API returning 503 for all customers",
        "status": "In Progress",
        "assignee": "Mei Tanaka",
        "priority": "Highest",
        "type": "Bug",
        "updated": "2026-11-21T08:20:00.000+0000",
        "description": None,
    }


@pytest.mark.parametrize(
    ("tool_input", "name", "message"),
    [
        ({"key": "plat 104"}, "get_issue", "Invalid input for get_issue"),
        ({"issue": "PLAT-104"}, "get_issue", "Invalid input for get_issue"),
        ({"key": "PLAT-999"}, "get_issue", "No issue PLAT-999 exists"),
        ({}, "delete_issue", 'Unknown tool "delete_issue"'),
    ],
)
def test_failures_are_error_results_the_model_can_read(tool_input, name, message):
    result = call(tool_input, name)
    assert result["status"] == "error"
    assert result["content"][0]["text"].startswith(message)
