import { parse, type OperationDefinitionNode } from 'graphql';
import { HttpResponse } from 'msw/http';
import { graphql } from 'msw/graphql';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import allGoals from '../../data/goals.json';
import { basicAuth } from '../../lib/basic-auth';
import { GOALS_SEARCH_QUERY, searchGoals } from './goals';
import { fetchGoals } from './goals.problem';
import { createGraphqlClient } from './graphql-client';
import { TEAMS_SEARCH_QUERY } from './teams-query';

const ENDPOINT = 'https://katas-example.atlassian.net/gateway/api/graphql';
const AUTHORIZATION = basicAuth('ada@example.com', 'replace-with-an-api-token');
const CONTAINER_ID = 'ari:cloud:townsquare::site/fictional-site';
const SEARCH = 'status = on_track';
const PAGE_SIZE = 3;

type GoalsPage = { goals_search: { edges: { node: Record<string, unknown> }[]; pageInfo: unknown } };
type PageOverride = (data: GoalsPage) => {
  data: Record<string, unknown> | null;
  errors?: { message: string; path: (string | number)[] }[];
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A fake Goals API: pages of three goals with opaque cursors, and scripted responses by request number. */
function setup() {
  const requests: { variables: Record<string, unknown>; authorization: string | null }[] = [];
  const overrides = new Map<number, PageOverride>();
  server.use(
    graphql.link(ENDPOINT).query('GoalsSearch', ({ variables, request }) => {
      requests.push({ variables, authorization: request.headers.get('authorization') });
      const start = variables.after ? Number(String(variables.after).replace('opaque-cursor-', '')) : 0;
      const end = Math.min(start + PAGE_SIZE, allGoals.length);
      const hasNextPage = end < allGoals.length;
      const data: GoalsPage = {
        goals_search: {
          edges: allGoals.slice(start, end).map((goal) => ({ node: structuredClone(goal) })),
          pageInfo: { hasNextPage, endCursor: hasNextPage ? `opaque-cursor-${end}` : null },
        },
      };
      const override = overrides.get(requests.length);
      return HttpResponse.json(override ? override(data) : { data });
    }),
  );
  const client = createGraphqlClient({ endpoint: ENDPOINT, authorization: AUTHORIZATION });
  return { requests, overrides, client };
}

/** The owner of the second goal can't be read: `null` in data, an entry in errors, and the rest still resolves. */
const ownerNotReadable: PageOverride = (data) => {
  const node = data.goals_search.edges[1]?.node;
  if (node) node.owner = null;
  return {
    data,
    errors: [{ message: 'Missing scope to read this field', path: ['goals_search', 'edges', 1, 'node', 'owner'] }],
  };
};

const searchRejected: PageOverride = () => ({
  data: null,
  errors: [{ message: 'Invalid containerId', path: ['goals_search'] }],
});

describe('flawed goals fetch', () => {
  it('reads only the first page', async () => {
    setup();
    const goals = await fetchGoals(ENDPOINT, AUTHORIZATION, CONTAINER_ID, SEARCH);
    expect(goals).toHaveLength(PAGE_SIZE);
  });

  it('drops the errors: a field nulled by an error looks like a goal without an owner', async () => {
    const { overrides } = setup();
    overrides.set(1, ownerNotReadable);
    const goals = await fetchGoals(ENDPOINT, AUTHORIZATION, CONTAINER_ID, SEARCH);
    expect(goals[1].owner).toBeNull();
    // Nothing in what it returns says that the owner exists but could not be read.
  });

  it('crashes with a TypeError on an error response, because the status is 200', async () => {
    const { overrides } = setup();
    overrides.set(1, searchRejected);
    await expect(fetchGoals(ENDPOINT, AUTHORIZATION, CONTAINER_ID, SEARCH)).rejects.toThrow(TypeError);
  });
});

describe('searchGoals', () => {
  it('reads every page by sending endCursor back as after', async () => {
    const { requests, client } = setup();
    const result = await searchGoals(client, { containerId: CONTAINER_ID, searchString: SEARCH, pageSize: 3 });
    expect(result.goals.map((goal) => goal.id)).toEqual(allGoals.map((goal) => goal.id));
    expect(result).toMatchObject({ errors: [], allPagesRead: true });
    expect(requests.map((r) => r.variables.after)).toEqual([undefined, 'opaque-cursor-3']);
    expect(requests[0]?.variables).toMatchObject({ containerId: CONTAINER_ID, searchString: SEARCH, first: 3 });
    expect(requests[0]?.authorization).toBe(AUTHORIZATION);
  });

  it('keeps the valid data of a partial response and reports the error with its path', async () => {
    const { overrides, client } = setup();
    overrides.set(1, ownerNotReadable);
    const result = await searchGoals(client, { containerId: CONTAINER_ID, searchString: SEARCH });
    expect(result.goals).toHaveLength(allGoals.length);
    expect(result.goals[1]).toMatchObject({ name: allGoals[1]?.name, ownerAccountId: null });
    expect(result.goals[0]?.ownerAccountId).toBe('fictional-account-marta-vidal');
    expect(result.errors).toEqual([
      { message: 'Missing scope to read this field', path: ['goals_search', 'edges', 1, 'node', 'owner'] },
    ]);
    expect(result.allPagesRead).toBe(true);
  });

  it('reports an error that nulls the whole response instead of crashing', async () => {
    const { overrides, client } = setup();
    overrides.set(1, searchRejected);
    const result = await searchGoals(client, { containerId: CONTAINER_ID, searchString: SEARCH });
    expect(result).toEqual({
      goals: [],
      errors: [{ message: 'Invalid containerId', path: ['goals_search'] }],
      allPagesRead: false,
    });
  });

  it('keeps the pages already read when a later page fails', async () => {
    const { overrides, client } = setup();
    overrides.set(2, () => ({
      data: { goals_search: null },
      errors: [{ message: 'Timed out', path: ['goals_search'] }],
    }));
    const result = await searchGoals(client, { containerId: CONTAINER_ID, searchString: SEARCH, pageSize: 3 });
    expect(result.goals).toHaveLength(PAGE_SIZE);
    expect(result.errors).toEqual([{ message: 'Timed out', path: ['goals_search'] }]);
    expect(result.allPagesRead).toBe(false);
  });

  it('reports a response with an unexpected shape as an error', async () => {
    const { overrides, client } = setup();
    overrides.set(1, () => ({ data: { goals_search: { edges: 'not a list' } } }));
    const result = await searchGoals(client, { containerId: CONTAINER_ID, searchString: SEARCH });
    expect(result.allPagesRead).toBe(false);
    expect(result.errors[0]?.message).toMatch(/^Unexpected response shape/);
  });
});

describe('queries', () => {
  it('are valid GraphQL documents with a named operation', () => {
    const names = [GOALS_SEARCH_QUERY, TEAMS_SEARCH_QUERY].map(
      (query) => (parse(query).definitions[0] as OperationDefinitionNode).name?.value,
    );
    expect(names).toEqual(['GoalsSearch', 'TeamsSearch']);
  });
});
