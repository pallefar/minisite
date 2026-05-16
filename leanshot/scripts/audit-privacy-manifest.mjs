#!/usr/bin/env node
// audit-privacy-manifest.mjs
//
// Validates that apps/ios/App/App/PrivacyInfo.xcprivacy matches the installed
// Capacitor plugin inventory in package.json AND uses only canonical reason
// codes from Apple's required-reason API list.
//
// Phase 16 Plan 16-07 — implements MOBILE-05 CI-gate half (D-18).
//
// Design constraints (Plan 16-07 §<action> Task 2):
//   - Zero npm dependencies. Node 22+ built-ins only. The script is a
//     security-critical CI gate; pulling a plist npm dep would add supply-chain
//     surface for a parser we only need to extract ~10 known keys from.
//   - Hand-rolled regex-based extractor of `<key>NAME</key>\s*<TYPE>VALUE</TYPE>`
//     patterns is auditable in <300 lines.
//
// CLI flags (parsed from process.argv):
//   --manifest=<path>      (default: apps/ios/App/App/PrivacyInfo.xcprivacy)
//   --package-json=<path>  (default: package.json)
//   --strict               (treat warnings as errors)
//
// Exit codes:
//   0 = PASS (or warnings-only without --strict, or SKIPPED when manifest absent pre-Wave-3)
//   1 = FAIL (missing required category, invalid reason code, D-18 invariant violation,
//             or --strict with warnings)
//
// GitHub Actions annotation format:
//   ::error::<message>       (always non-zero exit)
//   ::warning::<message>     (exit depends on --strict)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAME = 'audit-privacy-manifest';

// ============================================================
// Plugin → required-reason API category map.
// Source: each plugin's PRIVACY/README + RESEARCH §"Standard Stack" + Phase 16 PLAN.
// Comments cite plugin GitHub privacy section URLs.
// ============================================================
const PLUGIN_TO_REQUIRED_CATEGORIES = {
  // @capacitor/core uses SystemBootTime in mach_absolute_time + UserDefaults transitively
  // https://github.com/ionic-team/capacitor (privacy section in README)
  '@capacitor/core': ['NSPrivacyAccessedAPICategorySystemBootTime'],
  // @capacitor/preferences writes to UserDefaults
  // https://github.com/ionic-team/capacitor-plugins/blob/main/preferences/README.md
  '@capacitor/preferences': ['NSPrivacyAccessedAPICategoryUserDefaults'],
  // @capacitor/filesystem reads file timestamps + disk space
  // https://github.com/ionic-team/capacitor-plugins/blob/main/filesystem/README.md
  '@capacitor/filesystem': [
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    'NSPrivacyAccessedAPICategoryDiskSpace',
  ],
  // @revenuecat/purchases-capacitor — UserDefaults for entitlement cache
  // https://github.com/RevenueCat/purchases-ios/blob/main/PrivacyInfo.xcprivacy
  '@revenuecat/purchases-capacitor': ['NSPrivacyAccessedAPICategoryUserDefaults'],
  // @sentry/capacitor — SystemBootTime for crash context + UserDefaults breadcrumbs +
  // DiskSpace for offline-buffer envelope storage
  // https://github.com/getsentry/sentry-cocoa/blob/main/Sources/Sentry/PrivacyInfo.xcprivacy
  '@sentry/capacitor': [
    'NSPrivacyAccessedAPICategorySystemBootTime',
    'NSPrivacyAccessedAPICategoryUserDefaults',
    'NSPrivacyAccessedAPICategoryDiskSpace',
  ],
  // Remaining plugins have NO required-reason API usage; tracked here so the
  // inventory cross-check still validates they're declared (with empty contribution).
  '@capacitor/app': [],
  '@capacitor/share': [],
  '@capacitor/splash-screen': [],
  '@capacitor/status-bar': [],
  '@capacitor/haptics': [],
  '@capacitor/browser': [],
  '@capacitor/keyboard': [],
  '@capacitor/network': [],
  '@capacitor/clipboard': [],
  '@capgo/capacitor-native-biometric': [],
  '@capacitor/local-notifications': [],
};

// ============================================================
// Apple's canonical reason-code lists per required-reason API category.
// Sourced from Apple's PrivacyInfo schema docs (RESEARCH §"References"):
//   https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api
// Refresh when Apple updates their canonical list (no SLA; manually check
// on each Apple privacy-manifest schema bump).
// ============================================================
const CANONICAL_REASON_CODES_BY_CATEGORY = {
  NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1', 'C56D.1', '1C8F.1', 'AC6B.1'],
  NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1', '3B52.1', '0A2A.1', '3D61.1'],
  NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1', '8FFB.1', '3D61.1'],
  NSPrivacyAccessedAPICategoryDiskSpace: ['E174.1', '85F4.1', '7D9E.1', 'B728.1'],
  NSPrivacyAccessedAPICategoryActiveKeyboards: ['54BD.1', '8C5D.1', '3EC4.1'],
};

// ============================================================
// CLI parsing
// ============================================================
function parseArgs(argv) {
  const out = { strict: false, manifest: null, packageJson: null, explicitManifest: false };
  for (const a of argv.slice(2)) {
    if (a === '--strict') out.strict = true;
    else if (a.startsWith('--manifest=')) {
      out.manifest = a.slice('--manifest='.length);
      out.explicitManifest = true;
    } else if (a.startsWith('--package-json=')) out.packageJson = a.slice('--package-json='.length);
  }
  if (!out.manifest)
    out.manifest = resolve(__dirname, '..', 'apps', 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy');
  if (!out.packageJson) out.packageJson = resolve(__dirname, '..', 'package.json');
  return out;
}

const args = parseArgs(process.argv);

// ============================================================
// Pre-Wave-3 escape hatch: SKIPPED when manifest absent (only for the default
// path — when called with explicit --manifest=, missing file is a hard fail).
// ============================================================
if (!existsSync(args.manifest)) {
  if (!args.explicitManifest) {
    console.log(`${SCRIPT_NAME}: SKIPPED (xcprivacy not yet created — pre-Wave-3)`);
    console.log(`  Expected path: ${args.manifest}`);
    process.exit(0);
  }
  console.error(`::error::manifest file not found: ${args.manifest}`);
  process.exit(1);
}
if (!existsSync(args.packageJson)) {
  console.error(`::error::package.json not found: ${args.packageJson}`);
  process.exit(1);
}

const manifestText = readFileSync(args.manifest, 'utf-8');
const pkgJson = JSON.parse(readFileSync(args.packageJson, 'utf-8'));
const installedDeps = new Set([
  ...Object.keys(pkgJson.dependencies ?? {}),
  ...Object.keys(pkgJson.devDependencies ?? {}),
]);

// ============================================================
// Plist parsing — hand-rolled regex extractor (zero npm deps).
// ============================================================

// Read a top-level boolean key — returns 'true' | 'false' | null.
function readBooleanKey(text, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<(true|false)\\/>`);
  const m = text.match(re);
  return m ? m[1] : null;
}

// Extract all <dict>...</dict> blocks inside the <array> that follows the given key.
function extractDictBlocksUnderKey(text, key) {
  const startRe = new RegExp(`<key>${key}</key>\\s*<array>`);
  const startMatch = startRe.exec(text);
  if (!startMatch) return [];
  const startIdx = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = startIdx;
  while (i < text.length && depth > 0) {
    const nextOpen = text.indexOf('<array>', i);
    const nextClose = text.indexOf('</array>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + '<array>'.length;
    } else {
      depth--;
      if (depth === 0) {
        const arrBody = text.slice(startIdx, nextClose);
        const blocks = [];
        const dictRe = /<dict>([\s\S]*?)<\/dict>/g;
        let dm;
        while ((dm = dictRe.exec(arrBody)) !== null) blocks.push(dm[1]);
        return blocks;
      }
      i = nextClose + '</array>'.length;
    }
  }
  return [];
}

function getString(dictBody, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
  const m = dictBody.match(re);
  return m ? m[1] : null;
}

function getStringArray(dictBody, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`);
  const m = dictBody.match(re);
  if (!m) return [];
  const out = [];
  const sre = /<string>([^<]+)<\/string>/g;
  let sm;
  while ((sm = sre.exec(m[1])) !== null) out.push(sm[1]);
  return out;
}

function getBoolean(dictBody, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<(true|false)\\/>`);
  const m = dictBody.match(re);
  return m ? m[1] : null;
}

// ============================================================
// Audit
// ============================================================
const errors = [];
const warnings = [];

// 1. NSPrivacyTracking MUST be <false/> per D-18.
const trackingVal = readBooleanKey(manifestText, 'NSPrivacyTracking');
if (trackingVal !== 'false') {
  errors.push(
    `NSPrivacyTracking must be <false/> per D-18 (LeanShot is not a tracking app); found: ${
      trackingVal ?? '<missing>'
    }`,
  );
}

// 2. Required-reason API categories.
const apiDicts = extractDictBlocksUnderKey(manifestText, 'NSPrivacyAccessedAPITypes');
const declaredCategoryToReasons = new Map();
for (const block of apiDicts) {
  const cat = getString(block, 'NSPrivacyAccessedAPIType');
  const reasons = getStringArray(block, 'NSPrivacyAccessedAPITypeReasons');
  if (cat) declaredCategoryToReasons.set(cat, reasons);
}

// Compute REQUIRED categories from installed plugins.
const requiredCategoryToPlugins = new Map();
for (const [pkg, cats] of Object.entries(PLUGIN_TO_REQUIRED_CATEGORIES)) {
  if (!installedDeps.has(pkg)) continue;
  for (const cat of cats) {
    if (!requiredCategoryToPlugins.has(cat)) requiredCategoryToPlugins.set(cat, []);
    requiredCategoryToPlugins.get(cat).push(pkg);
  }
}

// 2a. Missing required → ::error::
for (const [cat, plugins] of requiredCategoryToPlugins.entries()) {
  if (!declaredCategoryToReasons.has(cat)) {
    errors.push(
      `Privacy manifest missing required-reason: ${cat} (required by: ${plugins.join(', ')})`,
    );
  }
}

// 2b. Over-declared → ::warning::
for (const cat of declaredCategoryToReasons.keys()) {
  if (!requiredCategoryToPlugins.has(cat)) {
    warnings.push(
      `Privacy manifest declares ${cat} but no installed plugin requires it; consider removing (Apple "declare only what you use")`,
    );
  }
}

// 2c. Invalid reason codes → ::error::
for (const [cat, reasons] of declaredCategoryToReasons.entries()) {
  const canonical = CANONICAL_REASON_CODES_BY_CATEGORY[cat];
  if (!canonical) {
    warnings.push(
      `Category ${cat} not in canonical reason-code map (script may need refresh against Apple's latest schema)`,
    );
    continue;
  }
  for (const code of reasons) {
    if (!canonical.includes(code)) {
      errors.push(
        `Invalid reason code ${code} declared under ${cat} (canonical: ${canonical.join(', ')})`,
      );
    }
  }
}

// 3. NSPrivacyCollectedDataTypeHealth (if present) MUST have Linked=false per D-18.
const collectedDicts = extractDictBlocksUnderKey(manifestText, 'NSPrivacyCollectedDataTypes');
for (const block of collectedDicts) {
  const type = getString(block, 'NSPrivacyCollectedDataType');
  if (type === 'NSPrivacyCollectedDataTypeHealth') {
    const linked = getBoolean(block, 'NSPrivacyCollectedDataTypeLinked');
    if (linked !== 'false') {
      errors.push(
        `NSPrivacyCollectedDataTypeHealth must have NSPrivacyCollectedDataTypeLinked=<false/> per D-18; found: ${
          linked ?? '<missing>'
        }`,
      );
    }
  }
}

// ============================================================
// Report
// ============================================================
for (const e of errors) console.error(`::error::${e}`);
for (const w of warnings) console.error(`::warning::${w}`);

if (errors.length > 0) {
  console.error(
    `${SCRIPT_NAME}: FAIL — ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, ${
      warnings.length
    } ${warnings.length === 1 ? 'warning' : 'warnings'}`,
  );
  process.exit(1);
}
if (args.strict && warnings.length > 0) {
  console.error(
    `${SCRIPT_NAME}: FAIL (strict) — 0 errors, ${warnings.length} ${
      warnings.length === 1 ? 'warning' : 'warnings'
    } (--strict promotes warnings to errors)`,
  );
  process.exit(1);
}

const declaredCount = declaredCategoryToReasons.size;
const requiredCount = requiredCategoryToPlugins.size;
console.log(
  `${SCRIPT_NAME}: PASS — ${declaredCount} required-reason ${
    declaredCount === 1 ? 'category' : 'categories'
  } declared, ${requiredCount} required by installed plugins, ${warnings.length} ${
    warnings.length === 1 ? 'warning' : 'warnings'
  }`,
);
process.exit(0);
