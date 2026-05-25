// Phase 53 Plan 53-02 Task 2 — Deep-link association validity + cap config validity tests.
//
// Covers MOBILE-01 (native dirs exist), MOBILE-04 (Capacitor plugins present in
// package.json), MOBILE-05 (AASA + assetlinks.json valid JSON with correct shapes).
//
// Design intent: these tests read the REAL committed artifacts — no mocking of
// the well-known files or capacitor.config.ts. They are regression guards that
// verify the files remain structurally valid as the project evolves. If any
// assertion fails after a "Phase 70" substitution (TEAMID → real Apple Team ID,
// SHA256 placeholder → real fingerprint), the assertion must remain satisfied
// because the substitution preserves the structural shape.
//
// Runs under vitest-mobile.config.ts (jsdom + globals: true). Test files under
// src/lib/native/ are auto-discovered by the existing include globs.
//
// cwd during vitest run = leanshot/ (the package root). All paths below are
// resolved relative to process.cwd() which equals the leanshot/ directory.

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile<T>(relPath: string): T {
  const abs = path.resolve(process.cwd(), relPath);
  const raw = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(raw) as T;
}

function readTextFile(relPath: string): string {
  const abs = path.resolve(process.cwd(), relPath);
  return fs.readFileSync(abs, 'utf-8');
}

function dirExists(relPath: string): boolean {
  try {
    return fs.statSync(path.resolve(process.cwd(), relPath)).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MOBILE-05 — AASA (Apple App Site Association)
// ---------------------------------------------------------------------------

describe('MOBILE-05 — apple-app-site-association', () => {
  interface AasaApplinksDetail {
    appID: string;
    paths: string[];
  }
  interface Aasa {
    applinks: {
      apps: unknown[];
      details: AasaApplinksDetail[];
    };
    webcredentials: {
      apps: string[];
    };
  }

  let aasa: Aasa;

  beforeAll(() => {
    aasa = readJsonFile<Aasa>('public/.well-known/apple-app-site-association');
  });

  it('parses as valid JSON', () => {
    // The beforeAll would throw on invalid JSON, but assert explicitly for
    // clear failure messaging.
    expect(aasa).toBeTruthy();
  });

  it('applinks.details[0].appID matches /<something>.app.leanshot.ios$/', () => {
    const appID = aasa.applinks.details[0]?.appID ?? '';
    expect(appID).toMatch(/\.app\.leanshot\.ios$/);
  });

  it('applinks.details[0].appID starts with TEAMID prefix (placeholder tolerated)', () => {
    // Structural: the prefix before .app.leanshot.ios must be non-empty.
    const appID = aasa.applinks.details[0]?.appID ?? '';
    const prefix = appID.replace(/\.app\.leanshot\.ios$/, '');
    expect(prefix.length).toBeGreaterThan(0);
  });

  it('applinks.details[0].paths includes /share/* (deep-link route)', () => {
    const paths = aasa.applinks.details[0]?.paths ?? [];
    expect(paths).toContain('/share/*');
  });

  it('applinks.details[0].paths includes /r/* (referral route)', () => {
    const paths = aasa.applinks.details[0]?.paths ?? [];
    expect(paths).toContain('/r/*');
  });

  it('applinks.details[0].paths includes /signin', () => {
    const paths = aasa.applinks.details[0]?.paths ?? [];
    expect(paths).toContain('/signin');
  });

  it('webcredentials.apps[0] matches /<something>.app.leanshot.ios$/', () => {
    const entry = aasa.webcredentials.apps[0] ?? '';
    expect(entry).toMatch(/\.app\.leanshot\.ios$/);
  });
});

// ---------------------------------------------------------------------------
// MOBILE-05 — assetlinks.json (Android App Links)
// ---------------------------------------------------------------------------

describe('MOBILE-05 — assetlinks.json', () => {
  interface AssetlinksEntry {
    relation: string[];
    target: {
      namespace: string;
      package_name: string;
      sha256_cert_fingerprints: string[];
    };
  }

  let assetlinks: AssetlinksEntry[];

  beforeAll(() => {
    assetlinks = readJsonFile<AssetlinksEntry[]>('public/.well-known/assetlinks.json');
  });

  it('parses as valid JSON array', () => {
    expect(Array.isArray(assetlinks)).toBe(true);
    expect(assetlinks.length).toBeGreaterThan(0);
  });

  it('[0].target.package_name === "app.leanshot.android"', () => {
    expect(assetlinks[0]?.target.package_name).toBe('app.leanshot.android');
  });

  it('[0].relation includes "delegate_permission/common.handle_all_urls"', () => {
    expect(assetlinks[0]?.relation).toContain('delegate_permission/common.handle_all_urls');
  });

  it('[0].target.namespace === "android_app"', () => {
    expect(assetlinks[0]?.target.namespace).toBe('android_app');
  });

  it('[0].target.sha256_cert_fingerprints is a non-empty array', () => {
    const fps = assetlinks[0]?.target.sha256_cert_fingerprints ?? [];
    expect(fps.length).toBeGreaterThan(0);
  });

  it('[0].target.sha256_cert_fingerprints[0] matches SHA-256 colon-hex format or is a known placeholder', () => {
    // WR-03: trivially-passing assertion strengthened to format-check real values.
    // A real fingerprint is 32 colon-separated uppercase hex byte pairs (64 chars + 31 colons).
    // During the Phase 70 defer window the committed value is the REPLACE_WITH_* placeholder;
    // once substituted, the same assertion validates the real SHA-256 format.
    // At Phase 70: remove the isPlaceholder branch — value must be a real fingerprint.
    const fp = assetlinks[0]?.target.sha256_cert_fingerprints[0] ?? '';
    const isPlaceholder = fp.startsWith('REPLACE_WITH_');
    const isSHA256ColonHex = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(fp);
    expect(isPlaceholder || isSHA256ColonHex).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MOBILE-01 — native dirs exist on disk
// ---------------------------------------------------------------------------

describe('MOBILE-01 — native project directories', () => {
  it('apps/ios exists as a directory', () => {
    expect(dirExists('apps/ios')).toBe(true);
  });

  it('apps/android exists as a directory', () => {
    expect(dirExists('apps/android')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MOBILE-01 — capacitor.config.ts references the correct native dirs
// ---------------------------------------------------------------------------

describe('MOBILE-01 — capacitor.config.ts', () => {
  let configSrc: string;

  beforeAll(() => {
    configSrc = readTextFile('capacitor.config.ts');
  });

  it("references ios.path 'apps/ios'", () => {
    expect(configSrc).toContain("'apps/ios'");
  });

  it("references android.path 'apps/android'", () => {
    expect(configSrc).toContain("'apps/android'");
  });

  it("webDir: 'dist' is set", () => {
    expect(configSrc).toContain("'dist'");
  });
});

// ---------------------------------------------------------------------------
// MOBILE-04 — Capacitor plugin presence in package.json
// ---------------------------------------------------------------------------

describe('MOBILE-04 — Capacitor plugins in package.json dependencies', () => {
  interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }

  let deps: Record<string, string>;

  beforeAll(() => {
    const pkg = readJsonFile<PackageJson>('package.json');
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  });

  const REQUIRED_PLUGINS = [
    '@capacitor/app',
    '@capacitor/preferences',
    '@capacitor/network',
    '@capacitor/status-bar',
    '@capacitor/splash-screen',
    '@capacitor/keyboard',
  ] as const;

  for (const plugin of REQUIRED_PLUGINS) {
    it(`${plugin} is present in package.json`, () => {
      expect(deps[plugin]).toBeDefined();
    });
  }
});
