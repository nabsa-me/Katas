/**
 * ⚠️ Illustrative, not verified. What is verified: teams are searched under `team { teamSearchV2(...) }` (there is
 * also a `teamSearchV3`) and `siteId` is mandatory. The other arguments, the variable types and the result shape
 * below are assumptions modelled on the Relay pattern of the Goals API. Check them in the GraphQL Explorer before
 * using the query: https://developer.atlassian.com/platform/teams/teams-graphql-api/introduction/
 *
 * Paging, partial errors and rate limiting work exactly as in `searchGoals`; only the query and its schema change.
 */
export const TEAMS_SEARCH_QUERY = /* GraphQL */ `
  query TeamsSearch($siteId: String!, $first: Int, $after: String) {
    team {
      teamSearchV2(siteId: $siteId, first: $first, after: $after) {
        nodes {
          team {
            id
            displayName
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;
