-- Governed metric: issue throughput per team per week. One row per team and week with at least one resolved issue.
select
    teams.team_id,
    teams.team_name,
    resolved.week_start,
    cast(count(*) as integer) as resolved_issues
from {{ ref('int_resolved_issues_by_team') }} as resolved
inner join {{ ref('teams') }} as teams
    on resolved.team_id = teams.team_id
group by teams.team_id, teams.team_name, resolved.week_start
