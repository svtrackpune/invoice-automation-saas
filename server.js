const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

// Plesk-compatible production server. The same application entrypoint remains usable
// for self-hosted deployments while Docker uses Next.js standalone output.
const canonicalRoot = fs.realpathSync(__dirname);
process.chdir(canonicalRoot);

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
