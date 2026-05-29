import { Injectable, Logger } from '@nestjs/common';

const NAMESPACE = 'Capiro/ProgramElementSync';

type AwsMetricUnit = 'Count' | 'Seconds' | 'None';

type CloudWatchMetricDatum = {
  MetricName: string;
  Value: number;
  Unit: AwsMetricUnit;
  Dimensions: Array<{ Name: string; Value: string }>;
  Timestamp: Date;
};

@Injectable()
export class ProgramElementMetricsService {
  private readonly logger = new Logger(ProgramElementMetricsService.name);

  async emitCount(metricName: string, value: number, source: string): Promise<void> {
    await this.emitMetric(metricName, value, source, 'Count');
  }

  async emitSeconds(metricName: string, value: number, source: string): Promise<void> {
    await this.emitMetric(metricName, value, source, 'Seconds');
  }

  async emitGauge(metricName: string, value: number, source: string): Promise<void> {
    await this.emitMetric(metricName, value, source, 'None');
  }

  private async emitMetric(
    metricName: string,
    value: number,
    source: string,
    unit: AwsMetricUnit,
  ): Promise<void> {
    if (!Number.isFinite(value)) return;

    const datum: CloudWatchMetricDatum = {
      MetricName: metricName,
      Value: value,
      Unit: unit,
      Dimensions: [{ Name: 'source', Value: source }],
      Timestamp: new Date(),
    };

    this.logger.log(
      JSON.stringify({
        _aws: { CloudWatchMetrics: [{ Namespace: NAMESPACE }] },
        ...datum,
      }),
    );
  }
}
