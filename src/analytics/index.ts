// Analytics & Reporting barrel export

export type {
  DailyReturn,
  PerformanceReport,
} from './performance-metrics.js';

export {
  calculateDailyReturns,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,
  generatePerformanceReport,
} from './performance-metrics.js';

export type {
  TaxableEvent,
  TaxSummary,
} from './tax-reporter.js';

export {
  calculateGainLoss,
  generateTaxReport,
  exportToCsv as exportTaxToCsv,
  getSummary,
} from './tax-reporter.js';

export type {
  ExportFormat,
  CsvColumn,
  EmailSummaryData,
} from './report-exporter.js';

export {
  exportToJson,
  exportToCsv,
  exportToHtml,
  buildEmailSummary,
} from './report-exporter.js';
