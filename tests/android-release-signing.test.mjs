import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Android release signing contract stays fail-closed and secret-free', async () => {
  const gradle = await read('android/app/build.gradle');
  const rootGitignore = await read('.gitignore');
  const androidGitignore = await read('android/.gitignore');
  const keyExample = await read('android/key.properties.example');
  const workflow = await read('.github/workflows/android-release.yml');
  const packageJson = JSON.parse(await read('package.json'));

  assert.match(gradle, /rootProject\.file\('key\.properties'\)/);
  assert.match(gradle, /ANDROID_KEYSTORE_PATH/);
  assert.match(gradle, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(gradle, /ANDROID_KEY_ALIAS/);
  assert.match(gradle, /ANDROID_KEY_PASSWORD/);
  assert.match(gradle, /requireReleaseSigning/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.match(gradle, /Local release bundles may be generated unsigned/);
  assert.doesNotMatch(gradle, /storePassword\s*=\s*['"][^'"]+['"]/);

  for (const ignoreFile of [rootGitignore, androidGitignore]) {
    assert.match(ignoreFile, /\*\.jks/);
    assert.match(ignoreFile, /\*\.keystore/);
    assert.match(ignoreFile, /key\.properties/);
  }

  assert.match(keyExample, /CHANGE_ME/);
  assert.match(keyExample, /moneymatters-release/);
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /ANDROID_KEYSTORE_PATH/);
  assert.match(workflow, /npm run android:aab:release/);
  assert.match(workflow, /app-release\.aab/);
  assert.equal(packageJson.scripts['android:aab:debug'], 'npm run cap:build:android:debug');
  assert.equal(packageJson.scripts['android:aab:release'], 'npm run cap:build:android:release');
  assert.match(packageJson.scripts['cap:build:android:release'], /requireReleaseSigning=true/);
});
