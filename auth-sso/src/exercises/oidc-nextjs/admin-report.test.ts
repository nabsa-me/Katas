import { describe, expect, it } from 'vitest';
import { ACCESS_REVIEW, adminReportResponse } from './admin-report';
import { problemAdminReportResponse } from './admin-report.problem';
import type { SessionUser } from './session';

const ada: SessionUser = { sub: 'ada', name: 'Ada Lovelace', roles: ['admin'] };
const grace: SessionUser = { sub: 'grace', name: 'Grace Hopper', roles: ['reader'] };

describe('problem: role check only in the UI', () => {
  it('returns the admin data to anyone who calls the URL', async () => {
    const response = problemAdminReportResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: ACCESS_REVIEW });
  });
});

describe('solution: role checked on the server', () => {
  it('answers 401 without a session', () => {
    expect(adminReportResponse(null).status).toBe(401);
  });

  it('answers 403 to a signed-in reader', async () => {
    const response = adminReportResponse(grace);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('returns the data to an admin', async () => {
    const response = adminReportResponse(ada);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: ACCESS_REVIEW });
  });
});
