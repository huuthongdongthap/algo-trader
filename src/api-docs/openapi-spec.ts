// OpenAPI 3.0 specification for algo-trade RaaS platform
// Auto-describes all REST endpoints: /api/*, /admin/*, /docs/*

/** OpenAPI 3.0 document shape (subset sufficient for codegen/Swagger UI) */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  security: Array<Record<string, string[]>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  paths: Record<string, unknown>;
}

// ─── Reusable schema fragments ────────────────────────────────────────────────

const ErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', example: 'Not Found' },
    message: { type: 'string' },
  },
  required: ['error'],
};

const StrategyNameEnum = {
  type: 'string',
  enum: ['cross-market-arb', 'market-maker', 'grid-trading', 'dca-bot', 'funding-rate-arb'],
};

const StrategyActionResponse = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: true },
    strategy: { ...StrategyNameEnum },
    action: { type: 'string', example: 'started' },
  },
  required: ['ok', 'strategy', 'action'],
};

const TradeSchema = {
  type: 'object',
  description: 'Single executed trade record',
  properties: {
    id: { type: 'string' },
    strategy: { type: 'string' },
    side: { type: 'string', enum: ['buy', 'sell'] },
    amount: { type: 'string' },
    price: { type: 'string' },
    fees: { type: 'string' },
    timestamp: { type: 'integer', format: 'int64' },
  },
};

const StrategyListingSchema = {
  type: 'object',
  description: 'Marketplace strategy listing',
  properties: {
    id: { type: 'string', example: 'strat-001' },
    name: { type: 'string', example: 'Grid Master Pro' },
    description: { type: 'string' },
    category: { type: 'string', enum: ['arbitrage', 'market-making', 'trend', 'dca', 'funding'] },
    author: { type: 'string' },
    priceUsdc: { type: 'number', example: 49.99 },
    downloads: { type: 'integer', example: 120 },
    rating: { type: 'number', example: 4.5 },
    createdAt: { type: 'integer', format: 'int64' },
    updatedAt: { type: 'integer', format: 'int64' },
  },
  required: ['id', 'name', 'description', 'category', 'author', 'priceUsdc'],
};

// ─── Path definitions ─────────────────────────────────────────────────────────

const apiPaths = {
  '/api/health': {
    get: {
      tags: ['System'],
      summary: 'Health check',
      description: 'Returns server liveness and uptime. No auth required.',
      security: [],
      responses: {
        200: {
          description: 'Server is healthy',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ok', 'degraded', 'down'], example: 'ok' },
                  uptime: { type: 'integer', description: 'Uptime in ms', example: 3600000 },
                  db: { type: 'string', enum: ['ok', 'error'], example: 'ok' },
                  pipeline: { type: 'string', enum: ['running', 'stopped'], example: 'running' },
                  wsClients: { type: 'integer', description: 'Active WebSocket connections', example: 42 },
                  version: { type: 'string', example: '0.1.0' },
                },
                required: ['status', 'uptime', 'db', 'pipeline', 'wsClients', 'version'],
              },
            },
          },
        },
        503: { description: 'Server unhealthy' },
      },
    },
  },

  '/api/metrics': {
    get: {
      tags: ['System'],
      summary: 'Prometheus metrics',
      description: 'Returns metrics in Prometheus text exposition format (v0.0.4). No auth required.',
      security: [],
      responses: {
        200: {
          description: 'Prometheus format metrics',
          content: {
            'text/plain; version=0.0.4; charset=utf-8': {
              schema: {
                type: 'string',
                example: '# HELP algo_trades_total Total trades executed\n# TYPE algo_trades_total counter\nalgo_trades_total{strategy="grid-trading"} 42'
              }
            }
          }
        }
      }
    }
  },

  '/api/status': {
    get: {
      tags: ['Engine'],
      summary: 'Engine status',
      description: 'Returns running strategies, trade counts, and server uptime. Requires authentication.',
      responses: {
        200: {
          description: 'Engine status object',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  running: { type: 'boolean', example: true },
                  strategies: { type: 'array', items: { type: 'string' }, example: ['grid-trading', 'dca-bot'] },
                  tradeCount: { type: 'integer', example: 123 },
                  config: { type: 'object', additionalProperties: true },
                  uptime: { type: 'integer', description: 'Uptime in ms', example: 7200000 }
                },
                required: ['running', 'strategies', 'tradeCount', 'uptime']
              }
            }
          }
        },
        401: { description: 'Missing or invalid authentication' },
      },
    },
  },

  '/api/trades': {
    get: {
      tags: ['Engine'],
      summary: 'Recent trades',
      description: 'Returns last 100 executed trades from the trade log. Requires authentication.',
      responses: {
        200: {
          description: 'Trade list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  trades: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        orderId: { type: 'string', example: 'order-001' },
                        marketId: { type: 'string', example: 'BTC/USD' },
                        side: { type: 'string', enum: ['buy', 'sell'], example: 'buy' },
                        fillPrice: { type: 'string', example: '42500.50' },
                        fillSize: { type: 'string', example: '0.1' },
                        fees: { type: 'string', example: '0.00425' },
                        timestamp: { type: 'integer', format: 'int64', example: 1700000000000 },
                        strategy: { ...StrategyNameEnum }
                      },
                      required: ['orderId', 'marketId', 'side', 'fillPrice', 'fillSize', 'fees', 'timestamp', 'strategy']
                    }
                  },
                  count: { type: 'integer', example: 42 }
                },
                required: ['trades', 'count']
              }
            }
          }
        },
        401: { description: 'Missing or invalid authentication' }
      },
    },
  },

  '/api/pnl': {
    get: {
      tags: ['Engine'],
      summary: 'P&L summary',
      description: 'Aggregates total fees paid and trade counts broken down by strategy. Requires authentication.',
      responses: {
        200: {
          description: 'PnL summary',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  totalFees: { type: 'string', example: '0.001234' },
                  tradeCount: { type: 'integer', example: 42 },
                  tradesByStrategy: {
                    type: 'object',
                    additionalProperties: { type: 'integer' },
                    example: { 'grid-trading': 20, 'dca-bot': 22 },
                  },
                },
                required: ['totalFees', 'tradeCount', 'tradesByStrategy']
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' }
      },
    },
  },

  '/api/strategy/start': {
    post: {
      tags: ['Strategy'],
      summary: 'Start a strategy',
      description: 'Start a named strategy. Requires authentication.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: StrategyNameEnum },
              required: ['name'],
            },
          },
        },
      },
      responses: {
        200: { description: 'Strategy started', content: { 'application/json': { schema: StrategyActionResponse } } },
        400: { description: 'Invalid strategy name', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/strategy/stop': {
    post: {
      tags: ['Strategy'],
      summary: 'Stop a strategy',
      description: 'Stop a running strategy. Requires authentication.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: StrategyNameEnum },
              required: ['name'],
            },
          },
        },
      },
      responses: {
        200: { description: 'Strategy stopped', content: { 'application/json': { schema: StrategyActionResponse } } },
        400: { description: 'Invalid strategy name', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/checkout': {
    post: {
      tags: ['Billing'],
      summary: 'Create checkout session',
      description: 'Create a Polar hosted checkout session for tier upgrades. Requires authentication.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                tier: { type: 'string', enum: ['pro', 'enterprise'], example: 'pro' },
                userId: { type: 'string', example: 'user-abc-123' },
                successUrl: { type: 'string', format: 'uri', example: 'https://example.com/success' },
                cancelUrl: { type: 'string', format: 'uri', example: 'https://example.com/cancel' }
              },
              required: ['tier', 'userId', 'successUrl']
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Checkout session created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  checkoutUrl: { type: 'string', format: 'uri', example: 'https://checkout.polar.sh/xyz123' },
                  checkoutId: { type: 'string', example: 'checkout-abc-123' }
                },
                required: ['checkoutUrl', 'checkoutId']
              }
            }
          }
        },
        400: { description: 'Missing or invalid fields', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        404: { description: 'User not found', content: { 'application/json': { schema: ErrorSchema } } },
        502: { description: 'Billing provider error', content: { 'application/json': { schema: ErrorSchema } } },
        503: { description: 'Billing not configured', content: { 'application/json': { schema: ErrorSchema } } }
      }
    }
  },

  '/api/webhooks/polar': {
    post: {
      tags: ['Billing'],
      summary: 'Polar webhook receiver',
      description: 'Receive Polar subscription events. HMAC-signed. No auth required.',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['subscription.created', 'subscription.updated', 'subscription.canceled'] },
                data: { type: 'object', additionalProperties: true }
              },
              required: ['type', 'data']
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Webhook acknowledged',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { acknowledged: { type: 'boolean', example: true } },
                required: ['acknowledged']
              }
            }
          }
        },
        400: { description: 'Invalid webhook payload or missing headers', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Webhook signature verification failed', content: { 'application/json': { schema: ErrorSchema } } }
      }
    }
  },

  '/api/marketplace': {
    get: {
      tags: ['Marketplace'],
      summary: 'List marketplace strategies',
      parameters: [
        { name: 'q', in: 'query', description: 'Keyword search', schema: { type: 'string' } },
        { name: 'category', in: 'query', description: 'Filter by category', schema: { type: 'string' } },
        { name: 'sortBy', in: 'query', description: 'Sort field', schema: { type: 'string', enum: ['downloads', 'rating', 'price', 'newest'] } },
      ],
      responses: {
        200: {
          description: 'Strategy listings',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  listings: { type: 'array', items: StrategyListingSchema },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['Marketplace'],
      summary: 'Publish a strategy',
      description: 'Creates a new listing in the marketplace.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: StrategyListingSchema } },
      },
      responses: {
        201: { description: 'Strategy published', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } } } },
        400: { description: 'Validation failed', content: { 'application/json': { schema: ErrorSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/marketplace/{id}/purchase': {
    post: {
      tags: ['Marketplace'],
      summary: 'Purchase a strategy',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { userId: { type: 'string', example: 'user-abc-123' } },
              required: ['userId'],
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Purchase recorded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  purchaseId: { type: 'string' },
                  strategyId: { type: 'string' },
                  userId: { type: 'string' },
                  priceUsdc: { type: 'number' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'Strategy not found', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  // ─── Sprint 7: Pipeline control ──────────────────────────────────────────────

  '/api/pipeline/start': {
    post: {
      tags: ['Pipeline'],
      summary: 'Start all enabled strategies',
      description: 'Starts all strategies that are enabled in config. Requires authentication.',
      responses: {
        200: { description: 'Pipeline started', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, started: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'started'] } } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/pipeline/stop': {
    post: {
      tags: ['Pipeline'],
      summary: 'Stop all running strategies',
      description: 'Stops all currently running strategies. Requires authentication.',
      responses: {
        200: { description: 'Pipeline stopped', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, stopped: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'stopped'] } } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/pipeline/status': {
    get: {
      tags: ['Pipeline'],
      summary: 'Get pipeline and strategy statuses',
      description: 'Returns running state of the pipeline and each strategy. Requires authentication.',
      responses: {
        200: {
          description: 'Pipeline status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  running: { type: 'boolean', example: true },
                  strategies: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        status: { type: 'string', enum: ['running', 'stopped', 'error'] },
                      },
                      required: ['name', 'status'],
                    },
                  },
                },
                required: ['running', 'strategies'],
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' },
      },
    },
  },

  '/api/pipeline/strategy/{id}/start': {
    post: {
      tags: ['Pipeline'],
      summary: 'Start specific strategy',
      description: 'Starts a single strategy by ID. Requires authentication.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Strategy ID or name' }],
      responses: {
        200: { description: 'Strategy started', content: { 'application/json': { schema: StrategyActionResponse } } },
        400: { description: 'Invalid strategy ID', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/pipeline/strategy/{id}/stop': {
    post: {
      tags: ['Pipeline'],
      summary: 'Stop specific strategy',
      description: 'Stops a single running strategy by ID. Requires authentication.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Strategy ID or name' }],
      responses: {
        200: { description: 'Strategy stopped', content: { 'application/json': { schema: StrategyActionResponse } } },
        400: { description: 'Invalid strategy ID', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        500: { description: 'Engine error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  // ─── Sprint 8: Portfolio analytics ───────────────────────────────────────────

  '/api/portfolio/summary': {
    get: {
      tags: ['Portfolio'],
      summary: 'Get portfolio summary',
      description: 'Returns aggregated portfolio metrics: total value, P&L, win rate. Requires authentication.',
      responses: {
        200: {
          description: 'Portfolio summary',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  totalValue: { type: 'string', example: '10500.00' },
                  totalPnl: { type: 'string', example: '500.00' },
                  totalPnlPct: { type: 'number', example: 5.0 },
                  winRate: { type: 'number', example: 0.62 },
                  tradeCount: { type: 'integer', example: 150 },
                },
                required: ['totalValue', 'totalPnl', 'totalPnlPct', 'winRate', 'tradeCount'],
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' },
      },
    },
  },

  '/api/portfolio/equity-curve': {
    get: {
      tags: ['Portfolio'],
      summary: 'Get equity curve data points',
      description: 'Returns time-series equity curve for charting. Requires authentication.',
      parameters: [
        { name: 'from', in: 'query', description: 'Start timestamp (ms)', schema: { type: 'integer', format: 'int64' } },
        { name: 'to', in: 'query', description: 'End timestamp (ms)', schema: { type: 'integer', format: 'int64' } },
      ],
      responses: {
        200: {
          description: 'Equity curve data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        ts: { type: 'integer', format: 'int64', example: 1700000000000 },
                        equity: { type: 'string', example: '10500.00' },
                      },
                      required: ['ts', 'equity'],
                    },
                  },
                },
                required: ['points'],
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' },
      },
    },
  },

  '/api/portfolio/strategies': {
    get: {
      tags: ['Portfolio'],
      summary: 'Get per-strategy breakdown',
      description: 'Returns P&L and trade stats broken down by strategy. Requires authentication.',
      responses: {
        200: {
          description: 'Per-strategy portfolio breakdown',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  strategies: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', example: 'grid-trading' },
                        pnl: { type: 'string', example: '250.00' },
                        tradeCount: { type: 'integer', example: 75 },
                        winRate: { type: 'number', example: 0.64 },
                      },
                      required: ['name', 'pnl', 'tradeCount', 'winRate'],
                    },
                  },
                },
                required: ['strategies'],
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' },
      },
    },
  },

  // ─── Sprint 8: ML signal feed ─────────────────────────────────────────────────

  '/api/signals/analyze': {
    post: {
      tags: ['Signals'],
      summary: 'Analyze trading signal for symbol',
      description: 'Runs ML inference on the requested symbol and returns a directional signal. Requires authentication.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', example: 'BTC/USD' },
                timeframe: { type: 'string', example: '1h', enum: ['1m', '5m', '15m', '1h', '4h', '1d'] },
              },
              required: ['symbol'],
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Signal analysis result',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  symbol: { type: 'string', example: 'BTC/USD' },
                  signal: { type: 'string', enum: ['long', 'short', 'neutral'], example: 'long' },
                  confidence: { type: 'number', example: 0.78 },
                  ts: { type: 'integer', format: 'int64', example: 1700000000000 },
                },
                required: ['symbol', 'signal', 'confidence', 'ts'],
              },
            },
          },
        },
        400: { description: 'Invalid request body', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Missing or invalid authentication' },
        503: { description: 'ML feed unavailable', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/signals/health': {
    get: {
      tags: ['Signals'],
      summary: 'Check ML signal feed health',
      description: 'Returns liveness and last-updated timestamp of the ML signal feed. Requires authentication.',
      responses: {
        200: {
          description: 'Signal feed health',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean', example: true },
                  lastUpdated: { type: 'integer', format: 'int64', example: 1700000000000 },
                  feedLatencyMs: { type: 'integer', example: 42 },
                },
                required: ['ok', 'lastUpdated'],
              },
            },
          },
        },
        401: { description: 'Missing or invalid authentication' },
        503: { description: 'ML feed down', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  // ─── Auth endpoints ───────────────────────────────────────────────────────

  '/api/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new user',
      security: [],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', minLength: 8, example: 'securepass123' },
            confirmPassword: { type: 'string', example: 'securepass123' },
            referralCode: { type: 'string', description: 'Optional referral code', example: 'ABC12345' },
          },
          required: ['email', 'password'],
        } } },
      },
      responses: {
        201: { description: 'User registered', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' }, referral: { type: 'object', nullable: true } } } } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
        409: { description: 'Email already registered', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Login and get JWT token',
      security: [],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } } },
      },
      responses: {
        200: { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' } } } } } },
        401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get current user profile',
      responses: {
        200: { description: 'User profile', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, tier: { type: 'string' }, apiKey: { type: 'string' }, createdAt: { type: 'integer' } } } } } },
        401: { description: 'Unauthorized' },
      },
    },
  },

  '/api/auth/api-key': {
    post: {
      tags: ['Auth'],
      summary: 'Rotate API key',
      responses: {
        200: { description: 'New API key', content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string' } } } } } },
        401: { description: 'Unauthorized' },
      },
    },
  },

  // ─── Backtest endpoints ─────────────────────────────────────────────────────

  '/api/backtest': {
    post: {
      tags: ['Backtest'],
      summary: 'Run a backtest simulation',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            strategy: { type: 'string', example: 'momentum-scalper' },
            market: { type: 'string', example: 'BTC-USD' },
            startDate: { type: 'string', format: 'date', example: '2025-01-01' },
            endDate: { type: 'string', format: 'date', example: '2025-12-31' },
            config: { type: 'object', properties: { initialCapital: { type: 'number', example: 10000 }, slippage: { type: 'number', example: 0.001 }, feeRate: { type: 'number', example: 0.0005 } } },
          },
          required: ['strategy', 'market'],
        } } },
      },
      responses: {
        200: { description: 'Backtest results', content: { 'application/json': { schema: { type: 'object', properties: { totalReturn: { type: 'number' }, winRate: { type: 'number' }, sharpeRatio: { type: 'number' }, maxDrawdown: { type: 'number' }, tradeCount: { type: 'integer' }, equityCurve: { type: 'array', items: { type: 'number' } } } } } } },
        400: { description: 'Invalid backtest config', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  // ─── Copy-trading endpoints ─────────────────────────────────────────────────

  '/api/leaders': {
    get: {
      tags: ['Copy Trading'],
      summary: 'Get top traders leaderboard',
      parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
      responses: { 200: { description: 'Ranked leaders list', content: { 'application/json': { schema: { type: 'object', properties: { leaders: { type: 'array', items: { type: 'object' } }, count: { type: 'integer' } } } } } } },
    },
  },

  '/api/leaders/{id}': {
    get: {
      tags: ['Copy Trading'],
      summary: 'Get single leader profile',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'Leader profile' },
        404: { description: 'Leader not found', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/copy/{leaderId}': {
    post: {
      tags: ['Copy Trading'],
      summary: 'Follow a leader (Pro+ only)',
      parameters: [{ name: 'leaderId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { allocationPct: { type: 'number', description: 'Capital allocation %', example: 0.1 } } } } } },
      responses: {
        200: { description: 'Now following leader' },
        403: { description: 'Pro/Enterprise tier required', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
    delete: {
      tags: ['Copy Trading'],
      summary: 'Unfollow a leader',
      parameters: [{ name: 'leaderId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Unfollowed' } },
    },
  },

  '/api/copy/my': {
    get: {
      tags: ['Copy Trading'],
      summary: 'List followed leaders',
      responses: { 200: { description: 'Following list with P&L attribution' } },
    },
  },

  // ─── Referral endpoints ─────────────────────────────────────────────────────

  '/api/referral/generate': {
    post: {
      tags: ['Referral'],
      summary: 'Generate a referral code',
      responses: {
        201: { description: 'Code generated', content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string', example: 'ABC12345' }, maxUses: { type: 'integer', example: 100 } } } } } },
      },
    },
  },

  '/api/referral/redeem': {
    post: {
      tags: ['Referral'],
      summary: 'Redeem a referral code',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } } } },
      responses: {
        200: { description: 'Code redeemed' },
        400: { description: 'Invalid or expired code', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/referral/stats': {
    get: {
      tags: ['Referral'],
      summary: 'Get referral stats for current user',
      responses: { 200: { description: 'Referral stats with conversions and revenue' } },
    },
  },

  '/api/referral/my-codes': {
    get: {
      tags: ['Referral'],
      summary: 'List all referral codes owned by user',
      responses: { 200: { description: 'Code list' } },
    },
  },

  // ─── OpenClaw AI endpoints ──────────────────────────────────────────────────

  '/api/openclaw/analyze': {
    post: {
      tags: ['OpenClaw AI'],
      summary: 'AI-powered trading analysis',
      description: 'Trigger AI analysis of recent trading activity. Returns structured insights.',
      responses: {
        200: { description: 'AI insights', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, insights: { type: 'string' }, model: { type: 'string' }, tokensUsed: { type: 'integer' } } } } } },
        429: { description: 'AI quota exceeded' },
        502: { description: 'AI gateway error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
  },

  '/api/openclaw/chat': {
    post: {
      tags: ['OpenClaw AI'],
      summary: 'Conversational AI chat (Pro/Enterprise)',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, context: { type: 'string', enum: ['general', 'strategy', 'portfolio', 'market'] }, history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } } }, required: ['message'] } } } },
      responses: {
        200: { description: 'AI response', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, reply: { type: 'string' }, model: { type: 'string' }, tokensUsed: { type: 'integer' } } } } } },
        429: { description: 'AI quota exceeded' },
      },
    },
  },

  '/api/openclaw/signals': {
    get: {
      tags: ['OpenClaw AI'],
      summary: 'Get AI-generated trade signals',
      parameters: [
        { name: 'market', in: 'query', schema: { type: 'string' }, description: 'Filter by market' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      ],
      responses: { 200: { description: 'Trade signals with stats' } },
    },
  },

  '/api/openclaw/signals/generate': {
    post: {
      tags: ['OpenClaw AI'],
      summary: 'Trigger AI signal generation',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { market: { type: 'string', example: 'BTC-USD' }, strategy: { type: 'string' }, data: { type: 'object' } }, required: ['market'] } } } },
      responses: {
        200: { description: 'Generated signal' },
        429: { description: 'AI quota exceeded' },
      },
    },
  },

  '/api/openclaw/status': {
    get: {
      tags: ['OpenClaw AI'],
      summary: 'OpenClaw AI health and config',
      responses: { 200: { description: 'AI subsystem status' } },
    },
  },

  '/api/openclaw/tune': {
    post: {
      tags: ['OpenClaw AI'],
      summary: 'AI-powered strategy parameter tuning',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', description: 'Strategy name' }, mode: { type: 'string', default: 'manual' } }, required: ['name'] } } } },
      responses: {
        200: { description: 'Tuning suggestions' },
        429: { description: 'AI quota exceeded' },
        502: { description: 'AI gateway error' },
      },
    },
  },

  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List all users',
      security: [{ AdminKey: [] }],
      responses: {
        200: { description: 'User list' },
        401: { description: 'Invalid X-Admin-Key' },
      },
    },
  },

  '/admin/system': {
    get: {
      tags: ['Admin'],
      summary: 'System overview stats',
      security: [{ AdminKey: [] }],
      responses: {
        200: { description: 'System stats including engine, users, uptime' },
        401: { description: 'Invalid X-Admin-Key' },
      },
    },
  },

  '/admin/maintenance': {
    post: {
      tags: ['Admin'],
      summary: 'Toggle maintenance mode',
      security: [{ AdminKey: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { enabled: { type: 'boolean', description: 'If omitted, toggles current state' } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Maintenance mode updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, maintenanceMode: { type: 'boolean' } },
              },
            },
          },
        },
        401: { description: 'Invalid X-Admin-Key' },
      },
    },
  },
};

// ─── Public export ────────────────────────────────────────────────────────────

/** Returns the complete OpenAPI 3.0 specification as a plain object */
export function getOpenApiSpec(): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Algo-Trade RaaS API',
      version: '1.0.0',
      description:
        'Remote-as-a-Service API for the algo-trade platform. ' +
        'Provides endpoints for engine control, strategy management, ' +
        'marketplace operations, and admin functions.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local dev server' },
      { url: 'https://api.algo-trade.io', description: 'Production' },
    ],
    security: [{ ApiKey: [] }],
    components: {
      securitySchemes: {
        ApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authenticated /api/* endpoints',
        },
        AdminKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Admin-Key',
          description: 'Admin key required for all /admin/* endpoints',
        },
      },
      schemas: {
        Error: ErrorSchema,
        Trade: TradeSchema,
        StrategyListing: StrategyListingSchema,
        StrategyActionResponse: StrategyActionResponse,
      },
    },
    paths: apiPaths,
  };
}
