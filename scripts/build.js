const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Plesk/Windows can expose the same physical directory with different casing.
// Resolve the real directory first, then launch Next from that canonical path.
const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
process.chdir(projectRoot);

const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
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
