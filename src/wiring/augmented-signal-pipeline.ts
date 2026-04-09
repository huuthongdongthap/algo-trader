/**
 * Augmented Signal Pipeline
 * Intercepts raw strategy signals, routes them through AI validation (DeepSeek),
 * then publishes validated signals to execution or rejected signals to audit log.
 *
 * Subscribes to:
 *   signal.simple-arb.detected
 *   signal.cross-market.candidate
 *   signal.delta-neutral.candidate
 *
 * Publishes to:
 *   signal.validated   — passed AI gate (confidence > MIN_CONFIDENCE)
 *   signal.rejected    — failed AI gate or below confidence threshold
 *
 * Env:
 *   AI_VALIDATION_ENABLED=false  → bypass AI, pass all signals through (for backtesting speed)
 *   AI_VALIDATION_MIN_CONFIDENCE → minimum confidence score (default 0.7)
 */

import { validateSignal } from '../intelligence/signal-validator.js';
import type { SignalCandidate, ValidationResult } from '../intelligence/signal-validator.js';
import { getMessageBus } from '../messaging/index.js';
import { Topics } from '../messaging/topic-schema.js';
import { logger } from '../utils/logger.js';
import type { MessageEnvelope } from '../messaging/message-bus-interface.js';

// Topics produced by this pipeline (not in Topics enum — added here as constants)
const TOPIC_SIGNAL_VALIDATED = 'signal.validated';
const TOPIC_SIGNAL_REJECTED = 'signal.rejected';

/** Minimum AI confidence required to pass a signal to execution */
const MIN_CONFIDENCE = Number(process.env.AI_VALIDATION_MIN_CONFIDENCE ?? 0.7);

/** When false, all signals pass through without AI validation (for backtesting speed) */
const AI_VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== 'false';

/** Shape of raw signal data arriving on NATS topics */
interface RawSignalData {
  signalType?: string;
  markets?: Array<{
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
  }>;
  expectedEdge?: number;
  reasoning?: string;
  [key: string]: unknown;
}

/** Envelope published to signal.validated */
interface ValidatedSignalEnvelope {
  original: RawSignalData;
  validation: ValidationResult;
  passedAt: number;
}

/** Envelope published to signal.rejected */
interface RejectedSignalEnvelope {
  original: RawSignalData;
  validation: ValidationResult;
  rejectedAt: number;
  reason: 'ai-rejected' | 'low-confidence' | 'bypass-off';
}

/** Map raw NATS data to SignalCandidate — fills safe defaults */
function toSignalCandidate(raw: RawSignalData, topic: string): SignalCandidate {
  const signalTypeMap: Record<string, SignalCandidate['signalType']> = {
    [Topics.SIGNAL_SIMPLE_ARB]: 'simple-arb',
    [Topics.SIGNAL_CROSS_MARKET]: 'cross-market',
    [Topics.SIGNAL_DELTA_NEUTRAL]: 'delta-neutral',
  };

  return {
    signalType: (raw.signalType as SignalCandidate['signalType']) ?? signalTypeMap[topic] ?? 'simple-arb',
    markets: raw.markets ?? [],
    expectedEdge: raw.expectedEdge ?? 0,
    reasoning: raw.reasoning ?? '(no reasoning provided)',
  };
}

/** Process a single raw signal through the AI validation gate */
async function processSignal(envelope: MessageEnvelope<RawSignalData>): Promise<void> {
  const { topic, data: raw, source } = envelope;

  logger.debug('[AugmentedPipeline] Received signal', { topic, source });

  // Bypass mode — pass straight through (for backtesting)
  if (!AI_VALIDATION_ENABLED) {
    const bus = getMessageBus();
    if (bus.isConnected()) {
      const passEnvelope: ValidatedSignalEnvelope = {
        original: raw,
        validation: {
          valid: true,
          confidence: 1,
          reasoning: 'AI validation bypassed (AI_VALIDATION_ENABLED=false)',
          risks: [],
        },
        passedAt: Date.now(),
      };
      await bus.publish(TOPIC_SIGNAL_VALIDATED, passEnvelope, 'augmented-signal-pipeline');
    }
    return;
  }

  const candidate = toSignalCandidate(raw, topic);
  let validation: ValidationResult;

  try {
    validation = await validateSignal(candidate);
  } catch (err) {
    logger.error('[AugmentedPipeline] Unexpected error during validation — rejecting signal', { err });
    validation = {
      valid: false,
      confidence: 0,
      reasoning: 'Unexpected validation error — signal rejected for safety',
      risks: ['internal-error'],
    };
  }

  const bus = getMessageBus();
  if (!bus.isConnected()) {
    logger.warn('[AugmentedPipeline] Message bus not connected — dropping signal');
    return;
  }

  const passed = validation.valid && validation.confidence >= MIN_CONFIDENCE;

  if (passed) {
    const passEnvelope: ValidatedSignalEnvelope = {
      original: raw,
      validation,
      passedAt: Date.now(),
    };
    await bus.publish(TOPIC_SIGNAL_VALIDATED, passEnvelope, 'augmented-signal-pipeline');
    logger.info('[AugmentedPipeline] Signal PASSED AI gate', {
      signalType: candidate.signalType,
      edge: candidate.expectedEdge,
      confidence: validation.confidence,
    });
  } else {
    const reason: RejectedSignalEnvelope['reason'] = !validation.valid ? 'ai-rejected' : 'low-confidence';
    const rejectEnvelope: RejectedSignalEnvelope = {
      original: raw,
      validation,
      rejectedAt: Date.now(),
      reason,
    };
    await bus.publish(TOPIC_SIGNAL_REJECTED, rejectEnvelope, 'augmented-signal-pipeline');
    logger.warn('[AugmentedPipeline] Signal REJECTED by AI gate', {
      signalType: candidate.signalType,
      edge: candidate.expectedEdge,
      confidence: validation.confidence,
      reason,
      aiReasoning: validation.reasoning,
      risks: validation.risks,
    });
  }
}

type Unsubscriber = () => void;

/** Start the augmented signal pipeline — subscribe to all signal topics */
export async function startAugmentedSignalPipeline(): Promise<() => Promise<void>> {
  const bus = getMessageBus();
  const unsubs: Unsubscriber[] = [];

  const signalTopics = [
    Topics.SIGNAL_SIMPLE_ARB,
    Topics.SIGNAL_CROSS_MARKET,
    Topics.SIGNAL_DELTA_NEUTRAL,
  ];

  logger.info('[AugmentedPipeline] Starting', {
    aiEnabled: AI_VALIDATION_ENABLED,
    minConfidence: MIN_CONFIDENCE,
    subscribingTo: signalTopics,
  });

  for (const topic of signalTopics) {
    const unsub = await bus.subscribe<RawSignalData>(topic, (envelope) => {
      // Fire-and-forget per signal — errors are caught inside processSignal
      processSignal(envelope).catch(err => {
        logger.error('[AugmentedPipeline] Unhandled error in processSignal', { topic, err });
      });
    });
    unsubs.push(unsub);
  }

  logger.info('[AugmentedPipeline] Subscribed to all signal topics');

  /** Call this to gracefully unsubscribe from all signal topics */
  return async function stopAugmentedSignalPipeline(): Promise<void> {
    logger.info('[AugmentedPipeline] Stopping subscriptions');
    for (const unsub of unsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
  };
}
