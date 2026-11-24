import { SERVICE_NAME } from './config';

export const METRICS_NAMESPACE = 'Katas/ProductionHealth';

/** One dimension set: per service and route. Every extra dimension multiplies the number of metrics billed. */
export const METRIC_DIMENSIONS = ['Service', 'Route'] as const;

/** Limits of the EMF specification, per event. */
export const EMF_LIMITS = { metrics: 100, dimensionsPerSet: 30 } as const;

export interface MetricDirective {
  Namespace: string;
  Dimensions: string[][];
  Metrics: { Name: string; Unit?: string }[];
}

/** An EMF event: the `_aws` metadata plus the values at the top level, next to any other property. */
export interface EmfEvent {
  _aws: { Timestamp: number; CloudWatchMetrics: MetricDirective[] };
  [key: string]: unknown;
}

export interface RequestMeasurement {
  route: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  correlationId: string;
  timestamp: number;
}

/**
 * One EMF line per request. CloudWatch Logs extracts `Latency`, `Requests` and `Errors` as metrics with the
 * dimensions `Service` and `Route`; everything else (status code, method, correlation id) stays a property of the
 * log event, searchable in Logs Insights and free of metric cost. A correlation id as a dimension would create
 * one metric per request. `Errors` counts only 5xx, and is 0 rather than absent: no data points look the same as a
 * service that stopped reporting.
 */
export function requestMetricsEvent(measurement: RequestMeasurement): EmfEvent {
  return {
    _aws: {
      Timestamp: measurement.timestamp,
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [[...METRIC_DIMENSIONS]],
          Metrics: [
            { Name: 'Latency', Unit: 'Milliseconds' },
            { Name: 'Requests', Unit: 'Count' },
            { Name: 'Errors', Unit: 'Count' },
          ],
        },
      ],
    },
    Service: SERVICE_NAME,
    Route: measurement.route,
    Latency: Math.round(measurement.latencyMs * 100) / 100,
    Requests: 1,
    Errors: measurement.statusCode >= 500 ? 1 : 0,
    StatusCode: measurement.statusCode,
    Method: measurement.method,
    correlationId: measurement.correlationId,
  };
}

/**
 * What CloudWatch would reject or silently drop: every metric needs a number at the top level, every dimension a
 * string, and the counts stay within the specification's limits. Empty when the event is valid.
 */
export function emfProblems(event: EmfEvent): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(event._aws.Timestamp)) problems.push('_aws.Timestamp must be epoch milliseconds');
  for (const directive of event._aws.CloudWatchMetrics) {
    if (directive.Metrics.length > EMF_LIMITS.metrics) problems.push(`more than ${EMF_LIMITS.metrics} metrics`);
    for (const metric of directive.Metrics) {
      if (typeof event[metric.Name] !== 'number') problems.push(`metric ${metric.Name} has no numeric value`);
    }
    for (const set of directive.Dimensions) {
      if (set.length > EMF_LIMITS.dimensionsPerSet)
        problems.push(`more than ${EMF_LIMITS.dimensionsPerSet} dimensions`);
      for (const name of set) {
        if (typeof event[name] !== 'string') problems.push(`dimension ${name} has no string value`);
      }
    }
  }
  return problems;
}

/**
 * Writes events as single JSON lines on stdout, where the Lambda runtime or the CloudWatch agent picks them up.
 * Not through the logger: a metric must not disappear because someone raised LOG_LEVEL to `warn`.
 */
export function createEmfWriter(write: (line: string) => void = (line) => process.stdout.write(line)) {
  return (event: EmfEvent): void => write(`${JSON.stringify(event)}\n`);
}
