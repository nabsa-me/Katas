-- The throughput definition, written once: an issue counts when its status category is done, once, in the
-- ISO week (starting Monday, in UTC) of its resolution date, for the team that owns its project.
select
    issues.issue_key,
    team_projects.team_id,
    issues.resolved_at,
    cast(date_trunc('week', issues.resolved_at at time zone 'UTC') as date) as week_start
from {{ ref('stg_jira__issues') }} as issues
inner join {{ ref('team_projects') }} as team_projects
    on issues.project_key = team_projects.project_key
where issues.status_category = 'done'
    and issues.resolved_at is not null
