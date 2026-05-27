/**
 * Phase 69 Plan 69-02 — DS-04 — DS primitive adoption audit (REPORT-ONLY).
 *
 * Walks `leanshot/src/**` looking for likely one-off duplicates of design-system
 * primitives that live at `leanshot/src/components/ui/`. For each primitive,
 * applies a heuristic regex that flags ad-hoc styled DOM elements which should
 * probably use the unified primitive. Writes a markdown report at
 * `leanshot/.planning/design-system/primitive-adoption-report.md`.
 *
 * Exit code: ALWAYS 0. This is a report-only audit — Phase 69.5 / operators
 *   execute the actual refactors per-surface. Heuristic regexes WILL produce
 *   false positives; the markdown report is meant to be eyeballed and filtered.
 *
 * Primitives in scope:
 *   - Button   — styled `<button>` not importing `<Button>`
 *   - Card     — styled `<div>` with surface/border/padding/shadow shape, not
 *                importing `<Card>`
 *   - Modal    — `<div role="dialog">` not importing `<Modal>` or `<Sheet>`
 *   - Input    — styled `<input>` not importing `<Input>`
 *
 * Note: Sheet, Pill, EmptyState, Badge, ProgressRing, Skeleton, Sparkline,
 *   SwipeToDelete duplicates have weaker heuristic signals (high false-positive
 *   rate). They are intentionally NOT scanned in this first pass — Phase 69.5
 *   can expand coverage based on report quality.
 *
 * Runtime: Deno (matches sibling scripts/ci/check-sentry-imports.ts precedent).
 *   Run via:
 *
 *     deno run -A scripts/ci/audit-ds-primitives.ts [--root=<path>] [--out=<path>] [--quiet]
 *
 * CLI flags (parsed from Deno.args):
 *   --root=PATH    Override scan root (default: cwd, expected to be git root).
 *                  Scanner walks `<root>/leanshot/src/**` for .tsx files.
 *   --out=PATH     Override report output path, relative to root (default:
 *                  `leanshot/.planning/design-system/primitive-adoption-report.md`).
 *   --quiet        Suppress stdout summary (still writes report file).
 *
 * Exit codes:
 *   0 — ALWAYS (report-only audit).
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PrimitiveName = 'Button' | 'Card' | 'Modal' | 'Input';

export interface Finding {
  primitive: PrimitiveName;
  /** Path relative to scan root. */
  file: string;
  /** 1-based line number. */
  line: number;
  excerpt: string;
  suggestion: string;
}

export interface PrimitiveScan {
  name: PrimitiveName;
  /**
   * True when this file should be entirely skipped — typically because it IS
   * the primitive's own definition (don't flag Button.tsx for `<button>`).
   */
  skipFile(absPath: string): boolean;
  /** True when the file imports the primitive — annotates findings. */
  importsPrimitive(source: string): boolean;
  /** Per-line probe; returns finding details when the heuristic fires. */
  probe(line: string): { excerpt: string; suggestion: string } | null;
}

export interface CliArgs {
  root: string;
  outPath: string;
  quiet: boolean;
}

// ─── CLI args ────────────────────────────────────────────────────────────────

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    root: Deno.cwd(),
    outPath: 'leanshot/.planning/design-system/primitive-adoption-report.md',
    quiet: false,
  };
  for (const raw of argv) {
    if (raw.startsWith('--root=')) {
      args.root = resolve(raw.slice('--root='.length));
    } else if (raw.startsWith('--out=')) {
      args.outPath = raw.slice('--out='.length);
    } else if (raw === '--quiet') {
      args.quiet = true;
    }
  }
  args.root = resolve(args.root);
  return args;
}

// ─── Primitive heuristics ────────────────────────────────────────────────────

// --- Button -----------------------------------------------------------------
// Signal: <button> with className containing background + rounded + horizontal
// padding markers. Matches both `className="..."` and `className={...}` forms
// by looking at the raw line text.
const BUTTON_TAG = /<button\b[^>]*\bclassName\s*=/;
const BUTTON_BG = /(bg-primary|bg-\[var\(--color-primary)/;
const BUTTON_ROUNDED = /\brounded(-|\b)/;
const BUTTON_PADX = /\bpx-\d/;

export const buttonScan: PrimitiveScan = {
  name: 'Button',
  skipFile(p) {
    return /\/components\/ui\/Button\.tsx$/.test(p);
  },
  importsPrimitive(source) {
    return /from\s+['"]@\/components\/ui\/Button['"]/.test(source);
  },
  probe(line) {
    if (!BUTTON_TAG.test(line)) return null;
    if (!BUTTON_BG.test(line)) return null;
    if (!BUTTON_ROUNDED.test(line)) return null;
    if (!BUTTON_PADX.test(line)) return null;
    return {
      excerpt: line.trim().slice(0, 160),
      suggestion: 'styled `<button>` — consider `<Button variant="primary">`',
    };
  },
};

// --- Card -------------------------------------------------------------------
// Signal: <div> with className containing surface bg + rounded + border +
// padding + shadow. Requires shadow to reduce false positives.
const CARD_TAG = /<div\b[^>]*\bclassName\s*=/;
const CARD_BG = /(bg-surface|bg-\[var\(--color-surface)/;
const CARD_BORDER = /\bborder(\b|-)/;
const CARD_ROUNDED = /\brounded(-|\b)/;
const CARD_PAD = /\bp[xy]?-\d/;
const CARD_SHADOW = /(shadow-|shadow\[)/;

export const cardScan: PrimitiveScan = {
  name: 'Card',
  skipFile(p) {
    return /\/components\/ui\/Card\.tsx$/.test(p);
  },
  importsPrimitive(source) {
    return /from\s+['"]@\/components\/ui\/Card['"]/.test(source);
  },
  probe(line) {
    if (!CARD_TAG.test(line)) return null;
    if (!CARD_BG.test(line)) return null;
    if (!CARD_BORDER.test(line)) return null;
    if (!CARD_ROUNDED.test(line)) return null;
    if (!CARD_PAD.test(line)) return null;
    if (!CARD_SHADOW.test(line)) return null;
    return {
      excerpt: line.trim().slice(0, 160),
      suggestion: 'Card-shaped `<div>` — consider `<Card>`',
    };
  },
};

// --- Modal ------------------------------------------------------------------
// Signal: ad-hoc `<div role="dialog">`.
const MODAL_DIALOG = /<div\b[^>]*\brole\s*=\s*["']dialog["']/;

export const modalScan: PrimitiveScan = {
  name: 'Modal',
  skipFile(p) {
    return (
      /\/components\/ui\/Modal\.tsx$/.test(p) ||
      /\/components\/ui\/Sheet\.tsx$/.test(p) ||
      /\/components\/ui\/Confirm\.tsx$/.test(p)
    );
  },
  importsPrimitive(source) {
    return (
      /from\s+['"]@\/components\/ui\/Modal['"]/.test(source) ||
      /from\s+['"]@\/components\/ui\/Sheet['"]/.test(source) ||
      /from\s+['"]@\/components\/ui\/Confirm['"]/.test(source)
    );
  },
  probe(line) {
    if (!MODAL_DIALOG.test(line)) return null;
    return {
      excerpt: line.trim().slice(0, 160),
      suggestion: 'ad-hoc `<div role="dialog">` — consider `<Modal>` or `<Sheet>`',
    };
  },
};

// --- Input ------------------------------------------------------------------
// Signal: <input> with className containing border + rounded + padding +
// height/vertical-padding markers indicative of custom field styling.
const INPUT_TAG = /<input\b[^>]*\bclassName\s*=/;
const INPUT_BORDER = /\bborder(\b|-)/;
const INPUT_ROUNDED = /\brounded(-|\b)/;
const INPUT_PAD = /\bp[xy]?-\d/;
const INPUT_HEIGHT = /\b(h-\d|py-\d)/;

export const inputScan: PrimitiveScan = {
  name: 'Input',
  skipFile(p) {
    return /\/components\/ui\/Input\.tsx$/.test(p);
  },
  importsPrimitive(source) {
    return /from\s+['"]@\/components\/ui\/Input['"]/.test(source);
  },
  probe(line) {
    if (!INPUT_TAG.test(line)) return null;
    if (!INPUT_BORDER.test(line)) return null;
    if (!INPUT_ROUNDED.test(line)) return null;
    if (!INPUT_PAD.test(line)) return null;
    if (!INPUT_HEIGHT.test(line)) return null;
    return {
      excerpt: line.trim().slice(0, 160),
      suggestion: 'styled `<input>` — consider `<Input>`',
    };
  },
};

export const ALL_SCANS: readonly PrimitiveScan[] = [buttonScan, cardScan, modalScan, inputScan];

// ─── Scanner ─────────────────────────────────────────────────────────────────

/**
 * Scan a single source-file string against the given primitive scans.
 * Exported for unit tests; takes a synthetic absPath + already-loaded source.
 */
export function scanFile(
  absPath: string,
  source: string,
  rootForRelative: string,
  scans: readonly PrimitiveScan[] = ALL_SCANS,
): Finding[] {
  const out: Finding[] = [];
  const relPath = relative(rootForRelative, absPath) || absPath;
  const lines = source.split(/\r?\n/);
  for (const scan of scans) {
    if (scan.skipFile(absPath)) continue;
    // The "imports primitive" relaxation: if the file already imports the
    // primitive, we still scan (because a single file CAN both use Button AND
    // have a styled <button> bypass), but we annotate the finding so the
    // operator can deprioritize. We don't drop the finding — false negatives
    // are worse than false positives for an audit script.
    const importsIt = scan.importsPrimitive(source);
    for (let i = 0; i < lines.length; i++) {
      const result = scan.probe(lines[i]);
      if (result === null) continue;
      out.push({
        primitive: scan.name,
        file: relPath,
        line: i + 1,
        excerpt: result.excerpt,
        suggestion:
          result.suggestion + (importsIt ? ' (file already imports the primitive)' : ''),
      });
    }
  }
  return out;
}

/**
 * Walk `<root>/leanshot/src/**` and scan every .tsx file.
 * Skips .test.tsx / .spec.tsx and `__tests__/` subtrees.
 */
export async function scanRoot(
  root: string,
  scans: readonly PrimitiveScan[] = ALL_SCANS,
): Promise<Finding[]> {
  const srcDir = join(root, 'leanshot', 'src');
  let exists = false;
  try {
    const st = await Deno.stat(srcDir);
    exists = st.isDirectory;
  } catch {
    exists = false;
  }
  if (!exists) return [];

  const findings: Finding[] = [];
  for await (const entry of walk(srcDir, {
    includeDirs: false,
    includeFiles: true,
    exts: ['tsx'],
    skip: [/\/__tests__\//, /\.test\.tsx$/, /\.spec\.tsx$/],
  })) {
    if (!entry.isFile) continue;
    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }
    findings.push(...scanFile(entry.path, source, root, scans));
  }
  return findings;
}

// ─── Report builder ──────────────────────────────────────────────────────────

export function buildReport(findings: readonly Finding[], generatedAt: string): string {
  const byPrimitive = new Map<PrimitiveName, Finding[]>();
  for (const scan of ALL_SCANS) byPrimitive.set(scan.name, []);
  for (const f of findings) {
    const bucket = byPrimitive.get(f.primitive);
    if (bucket) bucket.push(f);
  }

  const lines: string[] = [];
  lines.push('# DS Primitive Adoption Audit (DS-04)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Report-only heuristic audit. False positives expected — operator filters');
  lines.push('during fix pass (Phase 69.5). Script exits 0 regardless of findings.');
  lines.push('');
  lines.push(`Total findings: **${findings.length}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Primitive | Findings |');
  lines.push('| --- | --- |');
  for (const scan of ALL_SCANS) {
    lines.push(`| ${scan.name} | ${byPrimitive.get(scan.name)!.length} |`);
  }
  lines.push('');

  for (const scan of ALL_SCANS) {
    const items = byPrimitive.get(scan.name)!;
    lines.push(`## ${scan.name} — ${items.length} findings`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_None detected._');
      lines.push('');
      continue;
    }
    // Sort by file then line for stable diff-friendly output.
    items.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
    for (const f of items) {
      lines.push(`- \`${f.file}:${f.line}\` — ${f.suggestion}`);
      lines.push('  ```');
      lines.push(`  ${f.excerpt}`);
      lines.push('  ```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runMain(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const findings = await scanRoot(args.root);
  const report = buildReport(findings, new Date().toISOString());
  const outAbs = resolve(args.root, args.outPath);
  await Deno.mkdir(dirname(outAbs), { recursive: true });
  await Deno.writeTextFile(outAbs, report + '\n');
  if (!args.quiet) {
    const summary = ALL_SCANS.map(
      (s) => `${s.name}=${findings.filter((f) => f.primitive === s.name).length}`,
    ).join(' ');
    console.log(
      `[audit-ds-primitives] wrote ${relative(args.root, outAbs)} — ${findings.length} findings (${summary})`,
    );
  }
  // Report-only: always exit 0.
  return 0;
}

// Skip CLI invocation when imported as a module (Deno test).
if (import.meta.main) {
  const code = await runMain(Deno.args);
  Deno.exit(code);
}
