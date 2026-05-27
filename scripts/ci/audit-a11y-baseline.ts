/**
 * Phase 69 Plan 69-03 — DS-05 — A11y baseline grep audit (REPORT-ONLY).
 *
 * Walks `leanshot/src/**` and applies cheap regex heuristics for the
 * accessibility baseline conventions documented in `leanshot/CLAUDE.md`:
 *
 *   1. Icon-only <button>   — only a JSX `<Icon ... />` child, no text   → require `aria-label`
 *   2. role="dialog" <div> WITHOUT `aria-modal="true"`                   → flag
 *   3. <input> without explicit <label htmlFor=...> association in file → flag
 *      (a heuristic only — pairs `<input id="x">` to any `<label htmlFor="x">`
 *      OR `<label>...<input ...>...</label>` wrap in the same file)
 *   4. File imports `framer-motion` but NOT `useReducedMotion`           → flag
 *   5. <th> with `cursor-pointer` or `onClick=` parent context, missing
 *      `aria-sort`                                                       → flag
 *
 * Exit code: ALWAYS 0. Heuristic, false positives expected — operator
 *   filters in Phase 69.5. A real a11y audit needs axe-core runtime;
 *   this is grep-bait, not a CI fail-gate.
 *
 * Runtime: Deno (matches sibling scripts/ci/audit-ds-primitives.ts precedent).
 *
 *   deno run -A scripts/ci/audit-a11y-baseline.ts [--root=<path>] [--out=<path>] [--quiet]
 *
 * CLI flags:
 *   --root=PATH    Override scan root (default: cwd, expected to be git root).
 *                  Scanner walks `<root>/leanshot/src/**` for .tsx files.
 *   --out=PATH     Override report output path, relative to root (default:
 *                  `leanshot/.planning/design-system/a11y-baseline-report.md`).
 *   --quiet        Suppress stdout summary (still writes report file).
 *
 * Exit codes:
 *   0 — ALWAYS (report-only audit).
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CheckName =
  | 'icon-button-aria-label'
  | 'dialog-missing-aria-modal'
  | 'input-missing-label'
  | 'framer-missing-reduced-motion'
  | 'th-sortable-missing-aria-sort';

export interface Finding {
  check: CheckName;
  /** Path relative to scan root. */
  file: string;
  /** 1-based line number. */
  line: number;
  excerpt: string;
  suggestion: string;
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
    outPath: 'leanshot/.planning/design-system/a11y-baseline-report.md',
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

// ─── Heuristics ──────────────────────────────────────────────────────────────

// 1. Icon-only buttons: <button ...><Icon ... /></button> with no text content.
//    Match `<button` opener through closing `</button>` on the SAME line; child
//    must be a single self-closing JSX tag whose name starts with a capital
//    (icon component) or is a known lucide-style tag. Skip if `aria-label=` is
//    present on the <button> opener.
const ICON_BUTTON_LINE =
  /<button\b([^>]*?)>\s*<([A-Z][A-Za-z0-9]*)\b[^>]*\/>\s*<\/button>/;

export function probeIconButton(line: string): { excerpt: string; suggestion: string } | null {
  const m = ICON_BUTTON_LINE.exec(line);
  if (!m) return null;
  const opener = m[1] ?? '';
  if (/\baria-label\s*=/.test(opener)) return null;
  return {
    excerpt: line.trim().slice(0, 160),
    suggestion: 'icon-only `<button>` missing `aria-label` — required for screen readers',
  };
}

// 2. role="dialog" without aria-modal. Match `<div ... role="dialog" ...>` and
//    check whether `aria-modal=` appears in the same opening tag.
const DIALOG_OPENER = /<(?:div|section|aside)\b[^>]*\brole\s*=\s*["']dialog["'][^>]*>/;

export function probeDialogAriaModal(
  line: string,
): { excerpt: string; suggestion: string } | null {
  const m = DIALOG_OPENER.exec(line);
  if (!m) return null;
  if (/\baria-modal\s*=\s*["']true["']/.test(m[0])) return null;
  return {
    excerpt: line.trim().slice(0, 160),
    suggestion: '`role="dialog"` missing `aria-modal="true"` — required for modal semantics',
  };
}

// 3. <input> without explicit label association. We do a per-file pass:
//    collect `id` values from `<input id="...">`, then collect htmlFor targets
//    from `<label htmlFor="...">`. Any input id NOT in the label set → flag.
//    Also exempt inputs that are wrapped inline by a <label> on the same line.
//    We exempt type="hidden", type="checkbox" (often wrapped inline), type="radio".
const INPUT_TAG_ANY = /<input\b([^>]*)\/?>/g;
const INPUT_ID = /\bid\s*=\s*["']([^"']+)["']/;
const INPUT_TYPE = /\btype\s*=\s*["']([^"']+)["']/;
const LABEL_FOR = /<label\b[^>]*\bhtmlFor\s*=\s*["']([^"']+)["']/g;
// Exempt types where the input is usually wrapped or doesn't need a visible label.
const EXEMPT_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset']);

export interface UnlabeledInput {
  line: number;
  id: string;
  excerpt: string;
}

/**
 * Return inputs whose `id` is not referenced by any `<label htmlFor=...>` in
 * the same file. Inputs without an `id` are SKIPPED — they may be wrapped by
 * a <label> inline or use aria-labelledby; the heuristic can't tell.
 */
export function findUnlabeledInputs(source: string): UnlabeledInput[] {
  const lines = source.split(/\r?\n/);

  // Pass 1: collect htmlFor targets across whole source.
  const labelTargets = new Set<string>();
  for (const match of source.matchAll(LABEL_FOR)) {
    labelTargets.add(match[1]);
  }

  // Pass 2: scan each line for <input> with id; flag if id not in targets.
  const out: UnlabeledInput[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    INPUT_TAG_ANY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INPUT_TAG_ANY.exec(line)) !== null) {
      const attrs = m[1] ?? '';
      const idMatch = INPUT_ID.exec(attrs);
      if (!idMatch) continue;
      const id = idMatch[1];
      const typeMatch = INPUT_TYPE.exec(attrs);
      const t = typeMatch ? typeMatch[1] : 'text';
      if (EXEMPT_INPUT_TYPES.has(t)) continue;
      if (labelTargets.has(id)) continue;
      // Also exempt inputs with aria-label or aria-labelledby inline.
      if (/\baria-label(led)?(by)?\s*=/.test(attrs)) continue;
      out.push({
        line: i + 1,
        id,
        excerpt: line.trim().slice(0, 160),
      });
    }
  }
  return out;
}

// 4. framer-motion import without useReducedMotion. Cheap file-level check —
//    if a file imports anything from 'framer-motion' but doesn't import
//    `useReducedMotion` (from any path), flag the framer-motion import line.
const FRAMER_IMPORT = /from\s+['"]framer-motion['"]/;
const REDUCED_MOTION_IMPORT = /\buseReducedMotion\b/;

export interface FramerWithoutReducedMotion {
  line: number;
  excerpt: string;
}

export function findFramerWithoutReducedMotion(
  source: string,
): FramerWithoutReducedMotion | null {
  if (!FRAMER_IMPORT.test(source)) return null;
  if (REDUCED_MOTION_IMPORT.test(source)) return null;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (FRAMER_IMPORT.test(lines[i])) {
      return { line: i + 1, excerpt: lines[i].trim().slice(0, 160) };
    }
  }
  return null;
}

// 5. Sortable <th> heuristic: <th ...> opener with onClick= or cursor-pointer
//    in the same line, missing aria-sort=.
const TH_OPENER = /<th\b([^>]*)>/;

export function probeSortableTh(
  line: string,
): { excerpt: string; suggestion: string } | null {
  const m = TH_OPENER.exec(line);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const hasClick = /\bonClick\s*=/.test(attrs);
  const hasCursorPointer = /\bcursor-pointer\b/.test(attrs);
  if (!hasClick && !hasCursorPointer) return null;
  if (/\baria-sort\s*=/.test(attrs)) return null;
  return {
    excerpt: line.trim().slice(0, 160),
    suggestion: 'sortable `<th>` missing `aria-sort` — required for table-sort semantics',
  };
}

// ─── File-skip ───────────────────────────────────────────────────────────────

export function shouldSkipFile(absPath: string): boolean {
  return (
    /\.(test|spec)\.tsx$/.test(absPath) ||
    /\/__tests__\//.test(absPath) ||
    // The reduced-motion hook itself imports framer-motion-style API but is the
    // canonical source of the helper — don't flag it.
    /\/hooks\/useReducedMotion\.ts$/.test(absPath)
  );
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

/**
 * Scan a single source-file string. Exported for unit tests.
 */
export function scanFile(absPath: string, source: string, rootForRelative: string): Finding[] {
  const out: Finding[] = [];
  if (shouldSkipFile(absPath)) return out;
  const relPath = relative(rootForRelative, absPath) || absPath;
  const lines = source.split(/\r?\n/);

  // Per-line checks (1, 2, 5).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const iconBtn = probeIconButton(line);
    if (iconBtn) {
      out.push({
        check: 'icon-button-aria-label',
        file: relPath,
        line: i + 1,
        excerpt: iconBtn.excerpt,
        suggestion: iconBtn.suggestion,
      });
    }
    const dialog = probeDialogAriaModal(line);
    if (dialog) {
      out.push({
        check: 'dialog-missing-aria-modal',
        file: relPath,
        line: i + 1,
        excerpt: dialog.excerpt,
        suggestion: dialog.suggestion,
      });
    }
    const sortableTh = probeSortableTh(line);
    if (sortableTh) {
      out.push({
        check: 'th-sortable-missing-aria-sort',
        file: relPath,
        line: i + 1,
        excerpt: sortableTh.excerpt,
        suggestion: sortableTh.suggestion,
      });
    }
  }

  // Whole-file checks (3, 4).
  for (const unl of findUnlabeledInputs(source)) {
    out.push({
      check: 'input-missing-label',
      file: relPath,
      line: unl.line,
      excerpt: unl.excerpt,
      suggestion: `<input id="${unl.id}"> has no matching <label htmlFor="${unl.id}"> in this file`,
    });
  }
  const framer = findFramerWithoutReducedMotion(source);
  if (framer) {
    out.push({
      check: 'framer-missing-reduced-motion',
      file: relPath,
      line: framer.line,
      excerpt: framer.excerpt,
      suggestion:
        'imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users',
    });
  }
  return out;
}

/**
 * Walk `<root>/leanshot/src/**` and scan every .tsx + .ts file.
 */
export async function scanRoot(root: string): Promise<Finding[]> {
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
    exts: ['tsx', 'ts'],
    skip: [/\/__tests__\//, /\.test\.tsx?$/, /\.spec\.tsx?$/],
  })) {
    if (!entry.isFile) continue;
    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }
    findings.push(...scanFile(entry.path, source, root));
  }
  return findings;
}

// ─── Report builder ──────────────────────────────────────────────────────────

const CHECK_TITLES: Record<CheckName, string> = {
  'icon-button-aria-label': 'Icon-only `<button>` missing `aria-label`',
  'dialog-missing-aria-modal': '`role="dialog"` missing `aria-modal="true"`',
  'input-missing-label': '`<input>` without matching `<label htmlFor=...>`',
  'framer-missing-reduced-motion': 'framer-motion import without `useReducedMotion`',
  'th-sortable-missing-aria-sort': 'Sortable `<th>` missing `aria-sort`',
};

const CHECK_ORDER: readonly CheckName[] = [
  'icon-button-aria-label',
  'dialog-missing-aria-modal',
  'input-missing-label',
  'framer-missing-reduced-motion',
  'th-sortable-missing-aria-sort',
];

export function buildReport(findings: readonly Finding[], generatedAt: string): string {
  const byCheck = new Map<CheckName, Finding[]>();
  for (const c of CHECK_ORDER) byCheck.set(c, []);
  for (const f of findings) {
    const bucket = byCheck.get(f.check);
    if (bucket) bucket.push(f);
  }

  const lines: string[] = [];
  lines.push('# A11y Baseline Audit (DS-05)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Report-only heuristic audit. False positives expected — operator filters');
  lines.push('during fix pass (Phase 69.5). Script exits 0 regardless of findings.');
  lines.push('');
  lines.push(
    'A real a11y audit requires axe-core runtime against rendered components — this script catches the cheap-grep cases only.',
  );
  lines.push('');
  lines.push(`Total findings: **${findings.length}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Check | Findings |');
  lines.push('| --- | --- |');
  for (const c of CHECK_ORDER) {
    lines.push(`| ${CHECK_TITLES[c]} | ${byCheck.get(c)!.length} |`);
  }
  lines.push('');

  for (const c of CHECK_ORDER) {
    const items = byCheck.get(c)!;
    lines.push(`## ${CHECK_TITLES[c]} — ${items.length} findings`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_None detected._');
      lines.push('');
      continue;
    }
    items.sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
    );
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
    const summary = CHECK_ORDER.map(
      (c) => `${c}=${findings.filter((f) => f.check === c).length}`,
    ).join(' ');
    console.log(
      `[audit-a11y-baseline] wrote ${relative(args.root, outAbs)} — ${findings.length} findings (${summary})`,
    );
  }
  // Report-only: always exit 0.
  return 0;
}

if (import.meta.main) {
  const code = await runMain(Deno.args);
  Deno.exit(code);
}
