/**
 * Polar Webhook Routes
 * ROIaaS Phase 3 - Polar.sh webhook event processing
 *
 * Events handled:
 * - subscription.created/active/updated/cancelled
 * - checkout.created
 * - payment.success/failed
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PolarService } from '../../../billing/polar-service';
import { SubscriptionService } from '../../../billing/subscription-service';
import { PaymentService } from '../../../billing/payment-service';
import { LicenseService } from '../../../billing/license-service';
import { AuditLogService } from '../../../audit/audit-log-service';
import {
  handleSubscriptionCreated,
  handleSubscriptionActive,
  handleSubscriptionUpdated,
  handleSubscriptionCancelled,
  handleCheckoutCreated,
  handlePaymentSuccess,
  handlePaymentFailed,
} from './handlers';

interface PolarWebhookPayload {
  type: string;
  data: { object: Record<string, unknown> };
}

export async function polarWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  const polarService = PolarService.getInstance();
  const subscriptionService = SubscriptionService.getInstance();
  const paymentService = PaymentService.getInstance();
  const licenseService = LicenseService.getInstance();
  const auditService = AuditLogService.getInstance();

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'data'],
          properties: {
            type: { type: 'string' },
            data: {
              type: 'object',
              required: ['object'],
              properties: { object: { type: 'object' } },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: PolarWebhookPayload }>, reply: FastifyReply) => {
      const signature = request.headers['polar-signature'] as string;
      const payload = JSON.stringify(request.body);

      const isValid = await polarService.verifyWebhook(payload, signature);
      if (!isValid) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
        });
      }

      try {
        const { type, data } = request.body;
        const eventData = data.object as { id?: string };

        fastify.log.info({ eventType: type, eventId: eventData.id }, 'Processing Polar webhook');

        switch (type) {
          case 'subscription.created':
            await handleSubscriptionCreated(
              eventData as unknown as { id: string; product_id: string; customer_email: string; status: string; current_period_start: string; current_period_end: string; amount?: number; currency?: string },
              subscriptionService,
              auditService
            );
            break;

          case 'subscription.active':
            await handleSubscriptionActive(
              eventData as unknown as { id: string; product_id: string; customer_email: string; status: string; current_period_start: string; current_period_end: string; amount?: number; currency?: string },
              subscriptionService,
              licenseService,
              auditService
            );
            break;

          case 'subscription.updated':
            await handleSubscriptionUpdated(
              eventData as unknown as { id: string; product_id: string; customer_email: string; status: string; current_period_start: string; current_period_end: string; amount?: number; currency?: string },
              subscriptionService,
              licenseService
            );
            break;

          case 'subscription.cancelled':
            await handleSubscriptionCancelled(
              eventData as unknown as { id: string; product_id: string; customer_email: string; status: string; current_period_start: string; current_period_end: string; amount?: number; currency?: string },
              subscriptionService
            );
            break;

          case 'checkout.created':
            await handleCheckoutCreated(eventData as unknown as { id: string; product_id: string; customer_email?: string; status: string; created_at: string });
            break;

          case 'payment.success':
            await handlePaymentSuccess(
              eventData as unknown as { id: string; amount: number; currency: string; status: string; customer_email?: string; subscription_id?: string },
              paymentService
            );
            break;

          case 'payment.failed':
            await handlePaymentFailed(
              eventData as unknown as { id: string; amount: number; currency: string; status: string; customer_email?: string; subscription_id?: string },
              paymentService
            );
            break;

          default:
            fastify.log.warn({ eventType: type }, 'Unknown Polar webhook event');
        }

        return reply.code(200).send({ received: true });
      } catch (error) {
        fastify.log.error({ error }, 'Error processing Polar webhook');
        return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process webhook' });
      }
    }
  );
}
