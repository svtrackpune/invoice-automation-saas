import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const variables=readFileSync('android/variables.gradle','utf8');
const appBuild=readFileSync('android/app/build.gradle','utf8');
const rootBuild=readFileSync('android/build.gradle','utf8');
const wrapper=readFileSync('android/gradle/wrapper/gradle-wrapper.properties','utf8');
const pkg=readFileSync('package.json','utf8');
const workflow=readFileSync('.github/workflows/android-release.yml','utf8');
test('Capacitor 8 and Gradle are configured for API 36',()=>{
 assert.match(variables,/minSdkVersion = 24/);assert.match(variables,/compileSdkVersion = 36/);assert.match(variables,/targetSdkVersion = 36/);
 assert.match(rootBuild,/com\.android\.tools\.build:gradle:8\.13\.0/);assert.match(wrapper,/gradle-8\.14\.3-all\.zip/);
 assert.match(pkg,/@capacitor\/(?:core|android|cli)@8\.1\.4/);
});
test('release has a production version, shrink settings and env signing',()=>{
 assert.match(appBuild,/applicationId "in\.nilanga\.moneymatters"/);assert.match(appBuild,/versionCode 10401/);assert.match(appBuild,/versionName "1\.4\.1"/);
 assert.match(appBuild,/minifyEnabled true/);assert.match(appBuild,/shrinkResources true/);assert.match(appBuild,/ANDROID_KEYSTORE_PASSWORD/);
 assert.match(appBuild,/ANDROID_KEY_ALIAS/);assert.match(appBuild,/ANDROID_KEY_PASSWORD/);
});
test('AAB workflow uses Java 21 and the signing keystore',()=>{
 assert.match(workflow,/java-version: '21'/);assert.match(workflow,/ANDROID_KEYSTORE_BASE64/);
 assert.match(workflow,/npm run android:aab:release/);assert.match(workflow,/app-release\.aab/);
});
