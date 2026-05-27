/**
 * Phase 69 Plan 69-03 — DS-09 — Copywriting audit (REPORT-ONLY).
 *
 * Two heuristics:
 *
 *   1. non-canonical-cta-verb — `<Button>...</Button>` (or
 *      `<button>...</button>`) whose child text is a non-canonical CTA verb.
 *      Canonical list (from CLAUDE.md + DS-09):
 *
 *        Save, Continue, Cancel, Confirm, Delete, Edit, Submit,
 *        Next, Back, Done, Close, Apply, Reset, Add, Remove, Update,
 *        Yes, No, Ok (the standard set; "OK" should be "Confirm" per DS-09
 *        — flagged separately).
 *
 *      Common offenders flagged with the suggested canonical replacement:
 *        OK     → Confirm
 *        Got it → Done
 *        Yeah   → Yes (or Confirm)
 *        Nope   → No
 *        Sure   → Confirm
 *        Cool   → Done
 *
 *   2. error-toast-no-solution — `<Toast severity="error" ...>` strings under
 *      30 chars without a verb (heuristic: no whitespace-followed lowercase
 *      verb-like token after the first word). Catches things like
 *      `<Toast severity="error">Error</Toast>` or `Failed`.
 *
 * Exit code: ALWAYS 0. Report-only.
 *
 * Runtime: Deno.
 *
 *   deno run -A scripts/ci/audit-copywriting.ts [--root=<path>] [--out=<path>] [--quiet]
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CheckName = 'non-canonical-cta-verb' | 'error-toast-no-solution';

export interface Finding {
  check: CheckName;
  file: string;
  line: number;
  excerpt: string;
  suggestion: string;
}

export interface CliArgs {
  root: string;
  outPath: string;
  quiet: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    root: Deno.cwd(),
    outPath: 'leanshot/.planning/design-system/copywriting-report.md',
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

// ─── Canonical CTA verbs ─────────────────────────────────────────────────────

/**
 * Canonical CTA verbs allowed on <Button>/<button> children. We allow common
 * extensions (Add, Remove, Update, Yes, No) — the spec is "canonical verbs
 * NOT a frozen short list"; spec is in CLAUDE.md + DS-09. Operator can
 * tighten the list if the audit produces too few hits.
 */
export const CANONICAL_CTA_VERBS = new Set<string>([
  'save',
  'continue',
  'cancel',
  'confirm',
  'delete',
  'edit',
  'submit',
  'next',
  'back',
  'done',
  'close',
  'apply',
  'reset',
  'add',
  'remove',
  'update',
  'yes',
  'no',
  'sign in',
  'sign up',
  'sign out',
  'log in',
  'log out',
  'send',
  'search',
  'export',
  'import',
  'copy',
  'share',
  'open',
  'retry',
  'try again',
  'learn more',
  'get started',
]);

/**
 * Common offenders → suggested canonical replacement. Lookup is
 * lowercase + trimmed.
 */
export const COMMON_OFFENDERS: Record<string, string> = {
  ok: 'Confirm',
  okay: 'Confirm',
  'got it': 'Done',
  yeah: 'Yes (or Confirm)',
  yep: 'Yes',
  nope: 'No',
  sure: 'Confirm',
  cool: 'Done',
  alright: 'Done',
  'no thanks': 'Cancel',
  'no thank you': 'Cancel',
};

// ─── Heuristics ──────────────────────────────────────────────────────────────

/**
 * Match `<Button ...>TEXT</Button>` (or `<button ...>TEXT</button>`) where TEXT
 * is plain text only (no JSX child). We require the close tag on the same
 * line so we can extract the text reliably.
 */
const BUTTON_TEXT_RE = /<(Button|button)\b[^>]*>([^<>{}\n]+?)<\/\1>/g;

export interface CtaVerbHit {
  matched: string;
  text: string;
  suggestion: string;
}

export function probeCtaVerb(line: string): CtaVerbHit[] {
  BUTTON_TEXT_RE.lastIndex = 0;
  const out: CtaVerbHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = BUTTON_TEXT_RE.exec(line)) !== null) {
    const rawText = m[2].trim();
    if (!rawText) continue;
    const lower = rawText.toLowerCase();
    // Allow canonical verbs.
    if (CANONICAL_CTA_VERBS.has(lower)) continue;
    // Allow exact canonical verbs followed by short noun phrase (e.g.
    // "Save changes", "Delete account"). Cheap heuristic: first word
    // is in the canonical set.
    const firstWord = lower.split(/\s+/)[0];
    if (CANONICAL_CTA_VERBS.has(firstWord)) continue;
    // Skip purely numeric / single-char / very-long content (long content
    // is typically not a CTA verb — likely descriptive copy or template).
    if (rawText.length > 40) continue;
    if (/^[0-9.\s%$]+$/.test(rawText)) continue;
    // Build suggestion.
    const suggested = COMMON_OFFENDERS[lower];
    out.push({
      matched: m[0],
      text: rawText,
      suggestion: suggested
        ? `non-canonical CTA verb "${rawText}" — prefer canonical "${suggested}"`
        : `non-canonical CTA verb "${rawText}" — verify against canonical list (Save / Continue / Cancel / Confirm / Delete / Edit / ...) or document carve-out in DESIGN-DECISIONS.md`,
    });
  }
  return out;
}

/**
 * Match `<Toast severity="error" ...>TEXT</Toast>` where TEXT is short and
 * has no verb-like guidance (no whitespace-followed lowercase word past the
 * first token).
 */
const ERROR_TOAST_RE =
  /<Toast\b[^>]*\bseverity\s*=\s*["']error["'][^>]*>([^<>{}\n]+?)<\/Toast>/g;

export interface ErrorToastHit {
  text: string;
  suggestion: string;
}

export function probeErrorToast(line: string): ErrorToastHit[] {
  ERROR_TOAST_RE.lastIndex = 0;
  const out: ErrorToastHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = ERROR_TOAST_RE.exec(line)) !== null) {
    const text = m[1].trim();
    if (!text) continue;
    if (text.length >= 30) continue;
    // If the text contains a whitespace + verb-like lowercase token past
    // the first word, treat as "has guidance" and skip.
    const words = text.split(/\s+/);
    if (words.length >= 4) continue;
    // If text ends with punctuation indicating actionable guidance (?, .)
    // and is multi-word, allow.
    if (words.length >= 3 && /[.?!]$/.test(text)) continue;
    out.push({
      text,
      suggestion: `error toast "${text}" lacks solution-path — include WHAT happened + WHAT TO DO (e.g. "Save failed. Check your connection and try again.")`,
    });
  }
  return out;
}

// ─── File-skip ───────────────────────────────────────────────────────────────

export function shouldSkipFile(absPath: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(absPath) ||
    /\/__tests__\//.test(absPath)
  );
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export function scanFile(absPath: string, source: string, rootForRelative: string): Finding[] {
  if (shouldSkipFile(absPath)) return [];
  const relPath = relative(rootForRelative, absPath) || absPath;
  const lines = source.split(/\r?\n/);
  const out: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const hit of probeCtaVerb(line)) {
      out.push({
        check: 'non-canonical-cta-verb',
        file: relPath,
        line: i + 1,
        excerpt: line.trim().slice(0, 160),
        suggestion: hit.suggestion,
      });
    }
    for (const hit of probeErrorToast(line)) {
      out.push({
        check: 'error-toast-no-solution',
        file: relPath,
        line: i + 1,
        excerpt: line.trim().slice(0, 160),
        suggestion: hit.suggestion,
      });
    }
  }
  return out;
}

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
  'non-canonical-cta-verb': 'Non-canonical CTA verb on `<Button>` / `<button>`',
  'error-toast-no-solution': 'Error `<Toast>` without solution-path',
};

const CHECK_ORDER: readonly CheckName[] = [
  'non-canonical-cta-verb',
  'error-toast-no-solution',
];

export function buildReport(findings: readonly Finding[], generatedAt: string): string {
  const byCheck = new Map<CheckName, Finding[]>();
  for (const c of CHECK_ORDER) byCheck.set(c, []);
  for (const f of findings) byCheck.get(f.check)?.push(f);

  const lines: string[] = [];
  lines.push('# Copywriting Audit (DS-09)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Report-only heuristic audit. False positives expected — operator filters');
  lines.push('during fix pass (Phase 69.5). Script exits 0 regardless of findings.');
  lines.push('');
  lines.push('Canonical CTA verbs (excerpt):');
  lines.push('');
  lines.push(
    '> Save, Continue, Cancel, Confirm, Delete, Edit, Submit, Next, Back, Done, Close, Apply, Reset, Add, Remove, Update, Yes, No.',
  );
  lines.push('');
  lines.push('Common offenders → canonical:');
  lines.push('');
  for (const [bad, good] of Object.entries(COMMON_OFFENDERS)) {
    lines.push(`- \`${bad}\` → **${good}**`);
  }
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
      `[audit-copywriting] wrote ${relative(args.root, outAbs)} — ${findings.length} findings (${summary})`,
    );
  }
  return 0;
}

if (import.meta.main) {
  const code = await runMain(Deno.args);
  Deno.exit(code);
}
