/**
 * Revenue Metrics Calculator
 * ROIaaS Phase 3 - Payment tracking and revenue metrics
 */

import type { Payment, PaymentStatusDistribution, RevenueMetrics } from '../payment-service';

export class RevenueMetricsCalculator {
  /**
   * Calculate revenue metrics from payments
   */
  static calculate(payments: Payment[]): RevenueMetrics {
    const totalRevenue = payments
      .filter((p) => p.status === 'success')
      .reduce((sum, p) => sum + p.amount, 0);

    const successCount = payments.filter((p) => p.status === 'success').length;
    const failedCount = payments.filter((p) => p.status === 'failed').length;
    const pendingCount = payments.filter((p) => p.status === 'pending').length;
    const refundedCount = payments.filter((p) => p.status === 'refunded').length;

    const totalPayments = payments.length;
    const paymentSuccessRate = totalPayments > 0
      ? successCount / totalPayments
      : 0;

    const activeLicenses = new Set(
      payments.filter((p) => p.status === 'success').map((p) => p.customerEmail)
    ).size;

    const avgLicenseValue = activeLicenses > 0
      ? totalRevenue / activeLicenses
      : 0;

    const mrr = this.calculateMRR(payments);

    return {
      mrr,
      totalRevenue,
      avgLicenseValue,
      paymentSuccessRate,
      paymentStatusDistribution: {
        success: successCount,
        failed: failedCount,
        pending: pendingCount,
        refunded: refundedCount,
      },
    };
  }

  /**
   * Calculate Monthly Recurring Revenue
   */
  private static calculateMRR(payments: Payment[]): number {
    const now = new Date();
    const monthlyPayments = payments.filter((p) => {
      const paymentDate = new Date(p.createdAt);
      return (
        p.status === 'success' &&
        paymentDate.getMonth() === now.getMonth() &&
        paymentDate.getFullYear() === now.getFullYear()
      );
    });

    return monthlyPayments.reduce((sum, p) => sum + p.amount, 0);
  }
}
