const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

// Plesk-compatible production server. The same application entrypoint remains usable
// for self-hosted deployments while Docker uses Next.js standalone output.
const canonicalRoot = fs.realpathSync(__dirname);
process.chdir(canonicalRoot);

// Plesk deployments without a native environment-variable UI may use a local
// .env.production file. Prefer process-manager environment variables when present,
// and load the local file only when the server-side Supabase configuration is absent.
// Node 24 provides process.loadEnvFile natively, so no dotenv dependency is required.
if (
  typeof process.loadEnvFile === 'function' &&
  (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
) {
  for (const fileName of ['.env.production', '.env']) {
    const filePath = path.join(canonicalRoot, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      process.loadEnvFile(filePath);
      break;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'env_file_load_failed',
        fileName,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

const dev = false;
const hostname = '0.0.0.0';
const nextPort = 3000;
const listenTarget = process.env.PORT || nextPort;
const shutdownTimeoutMs = 10_000;

const app = next({ dev, hostname, port: nextPort, dir: canonicalRoot });
const handle = app.getRequestHandler();
let server;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(JSON.stringify({ event: 'server_shutdown_started', signal }));

  if (!server) {
    process.exit(0);
    return;
  }

  const forceExitTimer = setTimeout(() => {
    console.error(JSON.stringify({ event: 'server_shutdown_timeout', timeoutMs: shutdownTimeoutMs }));
    process.exit(1);
  }, shutdownTimeoutMs);
  forceExitTimer.unref();

  server.close((error) => {
    clearTimeout(forceExitTimer);

    if (error) {
      console.error(JSON.stringify({
        event: 'server_shutdown_failed',
        name: error.name,
        message: error.message,
      }));
      process.exit(1);
      return;
    }

    console.log(JSON.stringify({ event: 'server_shutdown_complete' }));
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

app.prepare().then(() => {
  server = createServer((req, res) => {
    if (shuttingDown) {
      res.statusCode = 503;
      res.setHeader('Connection', 'close');
      res.end('Server is shutting down.');
      return;
    }

    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl).catch((error) => {
      console.error(JSON.stringify({
        event: 'request_handler_error',
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      }));

      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' } }));
      } else {
        res.destroy();
      }
    });
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;

  server.listen(listenTarget, hostname, () => {
    console.log(JSON.stringify({ event: 'server_ready', port: listenTarget }));
  });
}).catch((error) => {
  console.error(JSON.stringify({
    event: 'server_startup_failed',
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
