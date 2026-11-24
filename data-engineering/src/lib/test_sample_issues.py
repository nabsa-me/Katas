from lib.sample_issues import sample_issues


def test_sample_has_unique_keys_and_every_requested_field() -> None:
    issues = sample_issues()

    keys = [issue["key"] for issue in issues]
    assert len(keys) == 31
    assert len(set(keys)) == len(keys)
    for issue in issues:
        assert set(issue["fields"]) == {
            "summary",
            "status",
            "issuetype",
            "project",
            "assignee",
            "created",
            "updated",
            "resolutiondate",
        }


def test_each_call_returns_an_independent_copy() -> None:
    sample_issues()[0]["fields"]["summary"] = "changed"

    assert sample_issues()[0]["fields"]["summary"] == "Retry failed card payments"
