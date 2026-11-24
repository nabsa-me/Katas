import { ephemeral, reportMessage, type IssueReport, type SlackMessage } from './report-message';
import type { SlashCommandJob } from './slash-command-handler';

export interface ReportWorkerOptions {
  /** The slow part: in a real app a Jira search that can take several seconds. */
  buildReport: (projectKey: string) => Promise<IssueReport>;
}

/**
 * Runs a job after the acknowledgement: builds the report and posts it to the command's `response_url`, which
 * accepts JSON messages (up to five times, for thirty minutes). If the report fails, the user is told so in the
 * same place, instead of being left with "Building…" forever, and the error is rethrown to be logged.
 */
export function createReportWorker({ buildReport }: ReportWorkerOptions) {
  return async function processJob(job: SlashCommandJob): Promise<void> {
    let report: IssueReport;
    try {
      report = await buildReport(job.projectKey);
    } catch (error) {
      await postToResponseUrl(job.responseUrl, ephemeral(`Could not build the report for ${job.projectKey}.`));
      throw error;
    }
    await postToResponseUrl(job.responseUrl, reportMessage(report, job.userId));
  };
}

async function postToResponseUrl(responseUrl: string, message: SlackMessage): Promise<void> {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`Slack rejected the response_url message with ${response.status}`);
}
