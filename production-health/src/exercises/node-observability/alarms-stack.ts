import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  Metric,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { METRICS_NAMESPACE } from './emf';

export interface ServiceAlarmsProps extends StackProps {
  service: string;
  /** Route templates as the service emits them (`/issues/:key`), one pair of alarms each. */
  routes: readonly string[];
  latencyP95ThresholdMs?: number;
  errorRateThresholdPercent?: number;
}

/**
 * Two alarms per route, on the metrics the EMF lines produce. A CloudWatch metric is identified by its namespace,
 * name and its full set of dimensions; the service emits `Service` + `Route`, so the alarms are per route too. An
 * alarm with only `Service` would watch a metric that does not exist and never fire.
 */
export class ServiceAlarmsStack extends Stack {
  readonly topic: Topic;

  constructor(scope: Construct, id: string, props: ServiceAlarmsProps) {
    super(scope, id, props);
    const { service, routes, latencyP95ThresholdMs = 300, errorRateThresholdPercent = 1 } = props;
    // Where the alarms go. Subscribe the on-call tool (PagerDuty, Opsgenie, a chat webhook) to this topic.
    this.topic = new Topic(this, 'AlarmTopic', { displayName: `${service} alarms` });

    for (const route of routes) {
      const metric = (metricName: string, statistic: string) =>
        new Metric({
          namespace: METRICS_NAMESPACE,
          metricName,
          statistic,
          dimensionsMap: { Service: service, Route: route },
          period: Duration.minutes(1),
        });

      // p95, not the average: the average hides the slowest 5 % of requests, which are the ones users notice.
      this.alarm(`LatencyP95${constructIdFor(route)}`, {
        description: `${service} ${route}: p95 latency above ${latencyP95ThresholdMs} ms in 3 of the last 5 minutes`,
        metric: metric('Latency', 'p95'),
        threshold: latencyP95ThresholdMs,
      });

      // A rate, not a count: 10 errors are an incident at 100 requests a minute and noise at 100,000.
      this.alarm(`ErrorRate${constructIdFor(route)}`, {
        description: `${service} ${route}: more than ${errorRateThresholdPercent} % of requests failing (5xx)`,
        metric: new MathExpression({
          expression: '100 * errors / requests',
          usingMetrics: { errors: metric('Errors', 'Sum'), requests: metric('Requests', 'Sum') },
          period: Duration.minutes(1),
          label: `${route} error rate (%)`,
        }),
        threshold: errorRateThresholdPercent,
      });
    }
  }

  /**
   * 3 breaching minutes out of 5: one slow minute does not page anybody, a sustained problem does. Missing data is
   * not breaching, because no traffic means no data points; a stopped service needs its own alarm (see README).
   */
  private alarm(
    id: string,
    { description, metric, threshold }: { description: string; metric: IMetric; threshold: number },
  ) {
    const alarm = new Alarm(this, id, {
      alarmDescription: description,
      metric,
      threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new SnsAction(this.topic));
    alarm.addOkAction(new SnsAction(this.topic));
    return alarm;
  }
}

/** `/issues/:key` → `IssuesKey`: construct ids are paths, so they can't contain `/`. */
export function constructIdFor(route: string): string {
  return route
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
}
