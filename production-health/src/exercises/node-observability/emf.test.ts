import { describe, expect, it } from 'vitest';
import { createEmfWriter, EMF_LIMITS, emfProblems, METRICS_NAMESPACE, requestMetricsEvent, type EmfEvent } from './emf';

const measurement = {
  route: '/issues/:key',
  method: 'GET',
  statusCode: 200,
  latencyMs: 12.3456,
  correlationId: 'request-g',
  timestamp: Date.UTC(2026, 10, 24, 9, 0, 0),
};

describe('requestMetricsEvent', () => {
  it('follows the EMF structure: metadata under _aws, values at the top level', () => {
    expect(requestMetricsEvent(measurement)).toEqual({
      _aws: {
        Timestamp: 1795510800000,
        CloudWatchMetrics: [
          {
            Namespace: METRICS_NAMESPACE,
            Dimensions: [['Service', 'Route']],
            Metrics: [
              { Name: 'Latency', Unit: 'Milliseconds' },
              { Name: 'Requests', Unit: 'Count' },
              { Name: 'Errors', Unit: 'Count' },
            ],
          },
        ],
      },
      Service: 'issues-service',
      Route: '/issues/:key',
      Latency: 12.35,
      Requests: 1,
      Errors: 0,
      StatusCode: 200,
      Method: 'GET',
      correlationId: 'request-g',
    });
  });

  it('counts only server errors as errors', () => {
    expect(requestMetricsEvent({ ...measurement, statusCode: 404 }).Errors).toBe(0);
    expect(requestMetricsEvent({ ...measurement, statusCode: 503 }).Errors).toBe(1);
  });

  it('keeps the correlation id out of the dimensions, where it would create one metric per request', () => {
    const [directive] = requestMetricsEvent(measurement)._aws.CloudWatchMetrics;
    expect(directive?.Dimensions.flat()).not.toContain('correlationId');
  });

  it('produces events that pass the validation', () => {
    expect(emfProblems(requestMetricsEvent(measurement))).toEqual([]);
  });
});

describe('emfProblems', () => {
  const base = (): EmfEvent => requestMetricsEvent(measurement);

  it('finds a metric or a dimension without a value', () => {
    const event = base();
    delete event.Latency;
    event.Route = 42;
    expect(emfProblems(event)).toEqual(['metric Latency has no numeric value', 'dimension Route has no string value']);
  });

  it('enforces the limits of the specification', () => {
    const event = base();
    const directive = event._aws.CloudWatchMetrics[0]!;
    directive.Metrics = Array.from({ length: EMF_LIMITS.metrics + 1 }, (_, index) => ({ Name: `M${index}` }));
    directive.Dimensions = [Array.from({ length: EMF_LIMITS.dimensionsPerSet + 1 }, () => 'Service')];
    for (const metric of directive.Metrics) event[metric.Name] = 1;

    expect(emfProblems(event)).toEqual(['more than 100 metrics', 'more than 30 dimensions']);
  });

  it('wants the timestamp in epoch milliseconds', () => {
    const event = base();
    event._aws.Timestamp = 1795510800.5;
    expect(emfProblems(event)).toEqual(['_aws.Timestamp must be epoch milliseconds']);
  });
});

describe('createEmfWriter', () => {
  it('writes each event as one JSON line', () => {
    const written: string[] = [];
    const event = requestMetricsEvent(measurement);
    createEmfWriter((line) => written.push(line))(event);

    expect(written).toHaveLength(1);
    expect(written[0]?.endsWith('\n')).toBe(true);
    expect(written[0]?.trimEnd()).not.toContain('\n');
    expect(JSON.parse(written[0] ?? '')).toEqual(event);
  });
});
