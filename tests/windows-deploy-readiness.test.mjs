import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const deployScript = readFileSync('scripts/deploy-windows.ps1', 'utf8');
const buildScript = readFileSync('scripts/build.js', 'utf8');
const readme = readFileSync('README.md', 'utf8');

test('Windows deployment is exposed as a documented npm command', () => {
  assert.equal(
    packageJson.scripts['deploy:windows'],
    'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-windows.ps1',
  );
  assert.match(readme, /npm run deploy:windows/);
  assert.match(readme, /Plesk \/ Windows/);
});

test('Windows deployment validates the supported Node runtime and lockfile', () => {
  assert.match(deployScript, /package-lock\.json/);
  assert.match(deployScript, /\[version\]'24\.18\.1'/);
  assert.match(deployScript, /\[version\]'25\.0\.0'/);
});

test('Windows deployment stops only app processes belonging to this project before replacing dependencies', () => {
  assert.match(deployScript, /Get-CimInstance Win32_Process/);
  assert.match(deployScript, /IndexOf\(\$projectRoot, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(deployScript, /Stop-Process -Id \$process\.ProcessId -Force/);
  assert.ok(deployScript.indexOf('Stop-Process -Id') < deployScript.indexOf('Remove-Item -LiteralPath ' + '$nodeModules'));
  assert.ok(deployScript.indexOf('Remove-Item -LiteralPath ' + '$nodeModules') < deployScript.indexOf("Invoke-NpmStep -Label 'Clean, lockfile-pinned dependency installation'"));
  assert.match(deployScript, /antivirus/);
  assert.doesNotMatch(deployScript, /Get-Process\s+node\s*\|\s*Stop-Process/);
});

test('Windows deployment gates install, typecheck, lint and build without executing live E2E fixtures', () => {
  for (const step of [
    "Invoke-NpmStep -Label 'Clean, lockfile-pinned dependency installation'",
    "Invoke-NpmStep -Label 'TypeScript'",
    "Invoke-NpmStep -Label 'ESLint'",
    "Invoke-NpmStep -Label 'Production build'",
  ]) assert.ok(deployScript.includes(step), 'missing deployment gate: ' + step);
  assert.match(deployScript, /if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(deployScript, /node_modules\\next\\dist\\bin\\next/);
});

test('build script explains a missing Next.js CLI instead of emitting an opaque module-not-found error', () => {
  assert.match(buildScript, /if \(!fs\.existsSync\(nextBin\)\)/);
  assert.match(buildScript, /Dependencies are incomplete/);
  assert.match(buildScript, /npm run deploy:windows/);
});
