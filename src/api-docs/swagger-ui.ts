// Swagger UI HTTP handler — serves /docs and /docs/openapi.json
// Uses CDN-loaded Swagger UI (unpkg.com). Zero npm dependencies.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getOpenApiSpec } from './openapi-spec.js';

// ─── HTML template ────────────────────────────────────────────────────────────

const SWAGGER_UI_VERSION = '5.17.14';
const CDN_BASE = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

function buildHtmlPage(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Algo-Trade RaaS — API Docs</title>
  <link rel="stylesheet" href="${CDN_BASE}/swagger-ui.css" />
  <style>
    /* Dark theme overrides */
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      background: #1a1a2e;
      color: #e0e0e0;
    }
    .swagger-ui .topbar {
      background: #0f0f1a;
      border-bottom: 1px solid #2d2d4e;
    }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #7c83fd; }
    .swagger-ui .info p,
    .swagger-ui .info li { color: #b0b0c0; }
    .swagger-ui .scheme-container { background: #1a1a2e; box-shadow: none; }
    .swagger-ui .opblock-tag { color: #7c83fd; border-bottom: 1px solid #2d2d4e; }
    .swagger-ui .opblock { border-radius: 6px; margin-bottom: 8px; }
    .swagger-ui .opblock .opblock-summary-operation-id,
    .swagger-ui .opblock .opblock-summary-path { color: #e0e0e0; }
    .swagger-ui section.models { background: #1a1a2e; }
    .swagger-ui section.models .model-container { background: #22223b; }
    #swagger-ui { max-width: 1200px; margin: 0 auto; padding: 0 16px 64px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${CDN_BASE}/swagger-ui-bundle.js"></script>
  <script src="${CDN_BASE}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        tryItOutEnabled: true,
        filter: true,
        syntaxHighlight: { activated: true, theme: 'agate' },
      });
    };
  </script>
</body>
</html>`;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendHtml(res: ServerResponse, html: string): void {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.byteLength,
  });
  res.end(body);
}

function sendJson(res: ServerResponse, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// ─── Public handler factory ───────────────────────────────────────────────────

/**
 * Returns a request handler for the /docs sub-tree.
 *
 * Routes handled:
 *   GET /docs              → Swagger UI HTML page
 *   GET /docs/openapi.json → Raw OpenAPI spec JSON
 *
 * All other paths return 404.
 *
 * Usage in main server:
 *   const docsHandler = createDocsHandler();
 *   if (pathname.startsWith('/docs')) docsHandler(req, res, pathname);
 */
export function createDocsHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
) => void {
  // Memoize the spec — it never changes at runtime
  const specJson = getOpenApiSpec();
  const htmlPage = buildHtmlPage('/api/docs/openapi.json');

  return function docsHandler(
    _req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): void {
    if (pathname === '/docs' || pathname === '/docs/') {
      sendHtml(res, htmlPage);
      return;
    }

    if (pathname === '/docs/openapi.json') {
      sendJson(res, specJson);
      return;
    }

    sendNotFound(res);
  };
}
