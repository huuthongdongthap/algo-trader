import { describe, it, expect } from 'vitest';
import { formatPrometheus, createMetricsHandler } from '../../src/metrics/prometheus-exporter.js';
import { MetricsCollector } from '../../src/metrics/metrics-collector.js';

describe('formatPrometheus', () => {
  it('should format counter metric', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('test_counter', 'Test counter');
    mc.increment('test_counter');
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('# HELP test_counter Test counter');
    expect(output).toContain('# TYPE test_counter counter');
  });

  it('should format gauge metric', () => {
    const mc = MetricsCollector.getInstance();
    mc.gauge('test_gauge', 'Test gauge', 42);
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('# HELP test_gauge Test gauge');
    expect(output).toContain('# TYPE test_gauge gauge');
    expect(output).toContain('test_gauge 42');
  });

  it('should format histogram metric with buckets', () => {
    const mc = MetricsCollector.getInstance();
    mc.histogram('test_histogram', 'Test histogram');
    mc.observe('test_histogram', 10);
    mc.observe('test_histogram', 50);
    mc.observe('test_histogram', 100);
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('# HELP test_histogram Test histogram');
    expect(output).toContain('# TYPE test_histogram histogram');
    expect(output).toContain('test_histogram_bucket');
    expect(output).toContain('test_histogram_sum');
    expect(output).toContain('test_histogram_count');
  });

  it('should handle labels in metric output', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('test_labeled', 'Test with labels');
    mc.increment('test_labeled', { method: 'GET', status: '200' });
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('method="GET"');
    expect(output).toContain('status="200"');
  });

  it('should escape special characters in labels', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('test_escaped', 'Test escaping');
    mc.increment('test_escaped', { path: '/api/test"quote' });
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('\\"');
  });

  it('should end output with newline', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('test_newline', 'Test newline');
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output.endsWith('\n')).toBe(true);
  });

  it('should separate metrics with blank line', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('metric1', 'First');
    mc.gauge('metric2', 'Second', 10);
    const metrics = mc.getAll();
    const output = formatPrometheus(metrics);

    expect(output).toContain('\n\n');
  });

  it('should emit 0 for empty counters', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('empty_counter', 'Empty counter');
    const metrics = mc.getAll().filter(m => m.name === 'empty_counter');
    const output = formatPrometheus(metrics);

    expect(output).toContain('empty_counter 0');
  });

  it('should handle histogram buckets correctly', () => {
    const mc = MetricsCollector.getInstance();
    mc.histogram('latency', 'Latency histogram');
    mc.observe('latency', 5);
    mc.observe('latency', 15);
    mc.observe('latency', 150);
    const metrics = mc.getAll().filter(m => m.name === 'latency');
    const output = formatPrometheus(metrics);

    expect(output).toContain('le="1"');
    expect(output).toContain('le="10"');
    expect(output).toContain('le="100"');
    expect(output).toContain('le="+Inf"');
  });
});

describe('createMetricsHandler', () => {
  it('should create HTTP request handler', () => {
    const handler = createMetricsHandler();
    expect(typeof handler).toBe('function');
  });

  it('should handle GET request with 200 status', () => {
    const handler = createMetricsHandler();
    const req = {} as any;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': expect.stringContaining('text/plain'),
      })
    );
  });

  it('should set correct content type', () => {
    const handler = createMetricsHandler();
    const req = {} as any;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    handler(req, res);

    const call = res.writeHead.mock.calls[0];
    expect(call[1]['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('should include all registered metrics', () => {
    const mc = MetricsCollector.getInstance();
    mc.counter('api_test', 'Test');
    mc.increment('api_test');

    const handler = createMetricsHandler();
    const req = {} as any;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    handler(req, res);

    expect(res.end).toHaveBeenCalled();
    const body = res.end.mock.calls[0][0];
    expect(body.toString()).toContain('api_test');
  });
});

// Mock vi for the handler tests
import { vi } from 'vitest';
