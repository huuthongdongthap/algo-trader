/**
 * NOWPayments IPN Webhook Routes (Express)
 * Handles crypto payment notifications via HMAC-SHA512 signed webhooks
 *
 * IPN statuses handled:
 * - finished → activate subscription + license
 * - refunded → cancel subscription
 * - failed/expired → log + notify
 * - waiting/confirming/confirmed/sending → ignore (intermediate)
 */

import { Router, Request, Response } from 'express';
import { NowPaymentsService, NowPaymentsIpnPayload } from '../../../billing/nowpayments-service';
import { SubscriptionService } from '../../../billing/subscription-service';
import { PaymentService } from '../../../billing/payment-service';
import { LicenseService } from '../../../billing/license-service';
import { AuditLogService } from '../../../audit/audit-log-service';
import { logger } from '../../../utils/logger';
import {
  handleIpnFinished,
  handleIpnRefunded,
  handleIpnPaymentSuccess,
  handleIpnPaymentFailed,
} from './handlers';

export const nowpaymentsWebhookRouter: Router = Router();

// Capture raw body BEFORE express.json() parses it
nowpaymentsWebhookRouter.use(
  require('express').json({
    verify: (req: any, _res: any, buf: Buffer) => {
      req.rawBody = buf.toString('utf-8');
    },
  })
);

nowpaymentsWebhookRouter.post('/', async (req: Request, res: Response) => {
  const nowpaymentsService = NowPaymentsService.getInstance();
  const subscriptionService = SubscriptionService.getInstance();
  const paymentService = PaymentService.getInstance();
  const licenseService = LicenseService.getInstance();
  const auditService = AuditLogService.getInstance();

  const signature = req.headers['x-nowpayments-sig'] as string;
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  if (!signature) {
    return res.status(400).json({ error: 'Missing x-nowpayments-sig header' });
  }

  const isValid = await nowpaymentsService.verifyWebhook(rawBody, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid IPN signature' });
  }

  try {
    const ipn = req.body as NowPaymentsIpnPayload;

    // Coerce payment_id to string (NOWPayments sends it as number)
    ipn.payment_id = String(ipn.payment_id);

    const action = nowpaymentsService.getStatusAction(ipn.payment_status);

    logger.info(`[NOWPayments IPN] payment_id=${ipn.payment_id} status=${ipn.payment_status} action=${action}`);

    switch (action) {
      case 'activate':
        await handleIpnFinished(ipn, nowpaymentsService, subscriptionService, licenseService, auditService);
        await handleIpnPaymentSuccess(ipn, paymentService);
        break;

      case 'cancel':
        if (ipn.payment_status === 'refunded') {
          await handleIpnRefunded(ipn, subscriptionService);
        }
        await handleIpnPaymentFailed(ipn, paymentService);
        break;

      case 'ignore':
        logger.info(`[NOWPayments IPN] Intermediate status ${ipn.payment_status}, no action`);
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('[NOWPayments IPN] Processing error:', { error });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
