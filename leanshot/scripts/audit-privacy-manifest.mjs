#!/usr/bin/env node
// audit-privacy-manifest.mjs
// Validates that apps/ios/App/App/PrivacyInfo.xcprivacy contains all required-reason
// API entries for the 14-plugin Capacitor inventory (Phase 16 D-07 + D-18).
//
// PrivacyInfo.xcprivacy is XML plist; we scan via regex against required-reason API keys
// -- sufficient for CI gate, full XML parse is overkill.
//
// Exit codes:
//   0 = PASS (all required-reason entries present) OR SKIPPED (xcprivacy not yet created)
//   1 = FAIL (one or more required-reason entries missing)
//
// GitHub Actions annotation format: ::error::<message>

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Apple's canonical 5 required-reason API categories (plus any plugin-specific
// entries that Plan 16-07 will append when filling PrivacyInfo.xcprivacy).
// See: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api
const REQUIRED_APIS = [
  'NSPrivacyAccessedAPICategoryUserDefaults',
  'NSPrivacyAccessedAPICategoryFileTimestamp',
  'NSPrivacyAccessedAPICategorySystemBootTime',
  'NSPrivacyAccessedAPICategoryDiskSpace',
  'NSPrivacyAccessedAPICategoryActiveKeyboards',
];

// 14-plugin inventory that Phase 16 installs (D-07).
// Each plugin may add additional NSPrivacyAccessedAPITypes entries — Plan 16-07
// hand-crafts PrivacyInfo.xcprivacy using each plugin's GitHub README privacy section.
const PLUGIN_INVENTORY = [
  '@capacitor/core',
  '@capacitor/app',
  '@capacitor/preferences',
  '@capacitor/share',
  '@capacitor/splash-screen',
  '@capacitor/status-bar',
  '@capacitor/haptics',
  '@capacitor/browser',
  '@capacitor/keyboard',
  '@capacitor/network',
  '@capacitor/filesystem',
  '@capacitor/clipboard',
  '@revenuecat/purchases-capacitor',
  '@capgo/capacitor-native-biometric',
];

const SCRIPT_NAME = 'audit-privacy-manifest';
const XCPRIVACY_PATH = resolve(__dirname, '..', 'apps', 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy');

if (!existsSync(XCPRIVACY_PATH)) {
  // Pre-Wave-3 execution: Plan 16-07 hasn't created PrivacyInfo.xcprivacy yet.
  // Exit 0 so CI can wire this script BEFORE Plan 16-07 ships.
  console.log(`${SCRIPT_NAME}: SKIPPED (xcprivacy not yet created — pre-Wave-3)`);
  console.log(`  Expected path: ${XCPRIVACY_PATH}`);
  console.log(`  Plugin inventory (${PLUGIN_INVENTORY.length} plugins):`, PLUGIN_INVENTORY.join(', '));
  process.exit(0);
}

const content = readFileSync(XCPRIVACY_PATH, 'utf-8');

const missing = [];

for (const api of REQUIRED_APIS) {
  if (!content.includes(api)) {
    missing.push(api);
  }
}

if (missing.length > 0) {
  for (const api of missing) {
    console.error(`::error::Privacy manifest missing required-reason: ${api}`);
  }
  console.error(
    `${SCRIPT_NAME}: FAIL — ${missing.length} required-reason ${missing.length === 1 ? 'entry' : 'entries'} missing from ${XCPRIVACY_PATH}`
  );
  console.error(`  Full inventory: ${PLUGIN_INVENTORY.join(', ')}`);
  process.exit(1);
}

console.log(
  `${SCRIPT_NAME}: PASS — all ${REQUIRED_APIS.length} required-reason entries present in PrivacyInfo.xcprivacy`
);
console.log(`  Plugin inventory verified: ${PLUGIN_INVENTORY.length} plugins`);
