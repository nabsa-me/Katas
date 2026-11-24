import { adminReportResponse } from '../../../../exercises/oidc-nextjs/admin-report';
import { currentUser } from '../../../../exercises/oidc-nextjs/current-user';

export async function GET() {
  return adminReportResponse(await currentUser());
}
