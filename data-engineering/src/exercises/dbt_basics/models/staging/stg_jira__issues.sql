-- One row per Jira issue, with consistent names and values. Cleaning only: no joins, no business rules.
select
    issue_key,
    upper(project_key) as project_key,
    summary,
    status,
    lower(status_category) as status_category,
    issue_type,
    assignee_account_id,
    created_at,
    updated_at,
    resolved_at,
    loaded_at
from {{ source('jira', 'jira_issues') }}
