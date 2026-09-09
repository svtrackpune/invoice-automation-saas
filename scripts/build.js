const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Plesk/Windows can retain files from an older deployment when a file has been
// removed or renamed in Git. Normalize the legacy Supabase package casing in
// those known server-entry files before Next resolves the module graph. This is
// intentionally narrow: it changes no application logic and only repairs the
// case-sensitive package specifier used by older deployment copies.
const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
process.chdir(projectRoot);

const legacySupabaseFiles = [
  'middleware.ts',
  path.join('src', 'infrastructure', 'supabase', 'server.ts'),
];

for (const relativeFile of legacySupabaseFiles) {
  const file = path.join(projectRoot, relativeFile);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const normalized = source.replaceAll("@Supabase/ssr", "@supabase/ssr");
  if (normalized !== source) {
    fs.writeFileSync(file, normalized, 'utf8');
    console.log('[build] normalized legacy @Supabase/ssr import:', relativeFile);
  }
}

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
