const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

// Plesk-compatible production server, following the proven Moneymatters/Liquidation deployment pattern.
// Plesk may provide PORT as a numeric port or a named pipe depending on the hosting stack.
const canonicalRoot = fs.realpathSync(__dirname);
process.chdir(canonicalRoot);

const dev = false;
const hostname = '0.0.0.0';
const nextPort = 3000;
const listenTarget = process.env.PORT || nextPort;

const app = next({ dev, hostname, port: nextPort, dir: canonicalRoot });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(listenTarget, hostname, () => {
    console.log(`Moneymatters ready; listening on ${listenTarget}`);
  });
}).catch((error) => {
  console.error('Moneymatters startup failed:', error);
  process.exit(1);
});
