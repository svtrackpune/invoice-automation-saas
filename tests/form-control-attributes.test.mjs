import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const sourceRoots = ['app', 'components'];
const primitivePath = path.join(root, 'components', 'moneymatters', 'ui.tsx');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(tsx|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

test('all app form controls use the ID/name-enforcing shared wrappers', () => {
  const violations = sourceRoots
    .flatMap((directory) => walk(path.join(root, directory)))
    .filter((file) => file !== primitivePath)
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const controls = [...source.matchAll(/<(input|select|textarea)\b/g)];
      return controls.map((match) => `${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}: native <${match[1]}> bypasses the shared form wrappers`);
    });
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('shared form primitives generate fallback id and name attributes', () => {
  const source = fs.readFileSync(primitivePath, 'utf8');
  assert.match(source, /function useFormControlIdentity/);
  assert.match(source, /id=\{identity\.id\}/);
  assert.match(source, /name=\{identity\.name\}/);
  for (const control of ['FormInput', 'FormSelect', 'FormTextarea']) {
    assert.match(source, new RegExp(`export const ${control} = forwardRef`));
  }
});
