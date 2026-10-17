const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Plesk/Windows can expose the same physical directory with different casing.
// Resolve the real directory first, then launch Next from that canonical path.
const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
process.chdir(projectRoot);

const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
if (!fs.existsSync(nextBin)) {
  console.error('[build] Next.js CLI is missing: ' + nextBin);
  console.error('[build] Dependencies are incomplete. Do not retry the build until npm ci completes successfully.');
  if (process.platform === 'win32') {
    console.error('[build] On Windows/Plesk, stop the site application pool or use: npm run deploy:windows');
  } else {
    console.error('[build] Run npm ci from the project root, then rerun npm run build.');
  }
  process.exit(1);
}
const result = spawnSync(process.execPath, [nextBin, 'build', '--turbopack'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
