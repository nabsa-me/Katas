import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { constructIdFor, ServiceAlarmsStack } from './alarms-stack';
import { SERVICE_NAME } from './config';
import { METRICS_NAMESPACE, requestMetricsEvent } from './emf';
import { USER_ROUTES } from './routes';

let template: Template;
beforeAll(() => {
  const stack = new ServiceAlarmsStack(new App(), 'IssuesServiceAlarms', {
    service: SERVICE_NAME,
    routes: USER_ROUTES,
  });
  template = Template.fromStack(stack);
}, 60_000); // loading aws-cdk-lib takes a few seconds

/** The dimensions of one route as the template lists them: sorted by name, an order CloudWatch ignores. */
const dimensionsFor = (route: string) => [
  { Name: 'Route', Value: route },
  { Name: 'Service', Value: SERVICE_NAME },
];

describe('ServiceAlarmsStack', () => {
  it('creates a p95 latency alarm and an error-rate alarm for each user route', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', USER_ROUTES.length * 2);
  });

  it.each(USER_ROUTES)('alarms on the p95 latency of %s above 300 ms in 3 of 5 minutes', (route) => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: METRICS_NAMESPACE,
      MetricName: 'Latency',
      ExtendedStatistic: 'p95',
      Dimensions: dimensionsFor(route),
      Period: 60,
      Threshold: 300,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
      TreatMissingData: 'notBreaching',
    });
  });

  it.each(USER_ROUTES)('alarms on the error rate of %s, computed as 100 * errors / requests', (route) => {
    const stat = (metricName: string) => ({
      Metric: { Namespace: METRICS_NAMESPACE, MetricName: metricName, Dimensions: dimensionsFor(route) },
      Period: 60,
      Stat: 'Sum',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Metrics: Match.arrayWith([
        Match.objectLike({ Expression: '100 * errors / requests', ReturnData: true }),
        { Id: 'errors', MetricStat: stat('Errors'), ReturnData: false },
        { Id: 'requests', MetricStat: stat('Requests'), ReturnData: false },
      ]),
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  it('sends every alarm and recovery to one topic', () => {
    const [topicId] = Object.keys(template.findResources('AWS::SNS::Topic'));
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    for (const alarm of alarms) {
      expect(alarm.Properties.AlarmActions).toEqual([{ Ref: topicId }]);
      expect(alarm.Properties.OKActions).toEqual([{ Ref: topicId }]);
    }
  });

  it('watches exactly the dimension set the service emits, or the alarm would watch a metric that does not exist', () => {
    const emitted = requestMetricsEvent({
      route: '/issues',
      method: 'GET',
      statusCode: 200,
      latencyMs: 1,
      correlationId: 'request-i',
      timestamp: 0,
    })._aws.CloudWatchMetrics[0]?.Dimensions.map((set) => [...set].sort());
    const alarms = Object.values(
      template.findResources('AWS::CloudWatch::Alarm', { Properties: { MetricName: 'Latency' } }),
    );
    for (const alarm of alarms) {
      const names = (alarm.Properties.Dimensions as { Name: string }[]).map((dimension) => dimension.Name);
      expect(emitted).toContainEqual(names);
    }
  });
});

describe('constructIdFor', () => {
  it('turns a route template into a construct id', () => {
    expect(constructIdFor('/issues/:key')).toBe('IssuesKey');
    expect(constructIdFor('/issues')).toBe('Issues');
  });
});
