#!/usr/bin/env node
// audit-privacy-manifest.test.mjs
// Self-contained tests for scripts/audit-privacy-manifest.mjs.
// Uses node:test + node:assert — zero npm dependencies, mirrors the script's
// supply-chain posture (security-critical CI gate).
//
// Run: npm run audit:privacy:test  (or: node --test scripts/audit-privacy-manifest.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'audit-privacy-manifest.mjs');

// ---------- Fixture builders ----------

function makeManifest(opts = {}) {
  const {
    categories = ['UserDefaults', 'FileTimestamp', 'SystemBootTime', 'DiskSpace'],
    reasonCodeOverrides = {}, // category -> reason code (overrides defaults)
    tracking = false,
    healthLinked = false,
    includeHealth = true,
    extraCategoryReasons = null, // [category, code] to add as extras
  } = opts;
  const defaultReasons = {
    UserDefaults: 'CA92.1',
    FileTimestamp: 'C617.1',
    SystemBootTime: '35F9.1',
    DiskSpace: 'E174.1',
    ActiveKeyboards: '54BD.1',
  };
  const apiBlocks = categories.map((cat) => {
    const reason = reasonCodeOverrides[cat] ?? defaultReasons[cat] ?? 'CA92.1';
    return `        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategory${cat}</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>${reason}</string>
            </array>
        </dict>`;
  });
  if (extraCategoryReasons) {
    apiBlocks.push(`        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategory${extraCategoryReasons[0]}</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>${extraCategoryReasons[1]}</string>
            </array>
        </dict>`);
  }
  const healthBlock = includeHealth
    ? `        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeHealth</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <${healthLinked ? 'true' : 'false'}/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyTracking</key>
    <${tracking ? 'true' : 'false'}/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
${apiBlocks.join('\n')}
    </array>
    <key>NSPrivacyCollectedDataTypes</key>
    <array>
${healthBlock}
    </array>
</dict>
</plist>
`;
}

function makePackageJson(deps = {}) {
  return JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: deps }, null, 2);
}

// Full 14-plugin inventory matches PLUGIN_TO_REQUIRED_CATEGORIES coverage.
const FULL_INVENTORY = {
  '@capacitor/core': '8.3.4',
  '@capacitor/app': '8.1.0',
  '@capacitor/preferences': '8.0.1',
  '@capacitor/share': '8.0.1',
  '@capacitor/splash-screen': '8.0.1',
  '@capacitor/status-bar': '8.0.2',
  '@capacitor/haptics': '8.0.2',
  '@capacitor/browser': '8.0.3',
  '@capacitor/keyboard': '8.0.3',
  '@capacitor/network': '8.0.1',
  '@capacitor/filesystem': '8.1.2',
  '@capacitor/clipboard': '8.0.1',
  '@revenuecat/purchases-capacitor': '13.1.1',
  '@capgo/capacitor-native-biometric': '8.4.5',
  '@sentry/capacitor': '4.0.0',
};

function writeFixtures(opts) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-privacy-'));
  const manifestPath = join(dir, 'PrivacyInfo.xcprivacy');
  const packageJsonPath = join(dir, 'package.json');
  writeFileSync(manifestPath, makeManifest(opts.manifest ?? {}));
  writeFileSync(packageJsonPath, makePackageJson(opts.deps ?? FULL_INVENTORY));
  return { dir, manifestPath, packageJsonPath };
}

function runScript(manifestPath, packageJsonPath, { strict = false } = {}) {
  const args = [SCRIPT, `--manifest=${manifestPath}`, `--package-json=${packageJsonPath}`];
  if (strict) args.push('--strict');
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

// ---------- Tests (5 behavior cases) ----------

test('Test 1: valid manifest with full inventory exits 0 and prints PASS', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({});
  try {
    const { code, stdout } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 0, `expected exit 0; stdout=${stdout}`);
    assert.match(stdout, /audit-privacy-manifest: PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 2: missing UserDefaults category while @capacitor/preferences installed exits 1 with ::error::', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: { categories: ['FileTimestamp', 'SystemBootTime', 'DiskSpace'] },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 1, `expected exit 1; stdout=${stdout} stderr=${stderr}`);
    const combined = stdout + stderr;
    assert.match(combined, /::error::/);
    assert.match(combined, /NSPrivacyAccessedAPICategoryUserDefaults/);
    assert.match(combined, /@capacitor\/preferences/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 3: over-declared ActiveKeyboards (no installed plugin uses it) emits ::warning::, exits 0 by default', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: {
      categories: ['UserDefaults', 'FileTimestamp', 'SystemBootTime', 'DiskSpace'],
      extraCategoryReasons: ['ActiveKeyboards', '54BD.1'],
    },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath);
    const combined = stdout + stderr;
    assert.match(combined, /::warning::/);
    assert.match(combined, /NSPrivacyAccessedAPICategoryActiveKeyboards/);
    assert.equal(code, 0, `non-strict warning should still exit 0; stdout=${stdout} stderr=${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 3b: --strict promotes warnings to errors (exit 1)', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: {
      categories: ['UserDefaults', 'FileTimestamp', 'SystemBootTime', 'DiskSpace'],
      extraCategoryReasons: ['ActiveKeyboards', '54BD.1'],
    },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath, { strict: true });
    assert.equal(code, 1, `strict mode should exit 1 on warnings; stdout=${stdout} stderr=${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 4: invalid reason code (XX99.1) under a declared category exits 1 with ::error::', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: {
      categories: ['UserDefaults', 'FileTimestamp', 'SystemBootTime', 'DiskSpace'],
      reasonCodeOverrides: { UserDefaults: 'XX99.1' },
    },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 1, `bogus reason code should exit 1; stdout=${stdout} stderr=${stderr}`);
    const combined = stdout + stderr;
    assert.match(combined, /::error::/);
    assert.match(combined, /XX99\.1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 5: full 14-plugin inventory + 4 categories + HealthKit Linked=false + Tracking=false exits 0 (D-18 honored)', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: { healthLinked: false, tracking: false, includeHealth: true },
  });
  try {
    const { code, stdout } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 0, `D-18-compliant manifest should exit 0; stdout=${stdout}`);
    assert.match(stdout, /audit-privacy-manifest: PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 6: HealthKit Linked=true triggers ::error:: (D-18 regression check)', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: { healthLinked: true },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 1, `Health Linked=true should fail; stdout=${stdout} stderr=${stderr}`);
    const combined = stdout + stderr;
    assert.match(combined, /::error::/);
    assert.match(combined, /Health/);
    assert.match(combined, /Linked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 7: NSPrivacyTracking=true triggers ::error:: (D-18 regression check)', () => {
  const { dir, manifestPath, packageJsonPath } = writeFixtures({
    manifest: { tracking: true },
  });
  try {
    const { code, stdout, stderr } = runScript(manifestPath, packageJsonPath);
    assert.equal(code, 1, `Tracking=true should fail; stdout=${stdout} stderr=${stderr}`);
    const combined = stdout + stderr;
    assert.match(combined, /::error::/);
    assert.match(combined, /NSPrivacyTracking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
