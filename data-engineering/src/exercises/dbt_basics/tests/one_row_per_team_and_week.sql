-- Singular test: returns the rows that break the rule. A duplicated team and week would double the team's
-- throughput on every dashboard that sums the mart.
select team_id, week_start, count(*) as rows_for_team_and_week
from {{ ref('fct_team_weekly_throughput') }}
group by team_id, week_start
having count(*) > 1
