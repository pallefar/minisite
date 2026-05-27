/**
 * Phase 69 Plan 69-01 — DS-01 Undefined Tailwind v4 @theme-token CI guard.
 *
 * Walks `leanshot/src/**\/*.{tsx,ts}` (skipping `.test.*` + `.stories.*`)
 * and reports any `text-*` / `bg-*` / `border-*` / `from-*` / `to-*` / `via-*`
 * / `ring-*` / `divide-*` / `placeholder-*` / `fill-*` / `stroke-*` Tailwind
 * utility whose token suffix does not resolve to either:
 *
 *   1. A name defined in `leanshot/src/index.css` `@theme { ... }` block, OR
 *   2. A Tailwind v4 built-in (numeric scale, alignment keywords, etc.), OR
 *   3. An entry on the `ALLOW_LIST` below (grandfathered legacy usages).
 *
 * Rationale: Tailwind v4 silently no-ops undefined `@theme` tokens — pages
 * render INVISIBLE (text-text-primary, bg-surface-card, etc.). Phase 60-13
 * shipped 9 such bugs to main before gsd-ui-auditor caught them. This gate
 * makes that whole class of regression impossible (per
 * `[[feedback_ui_auditor_catches_undefined_theme_tokens]]`).
 *
 * ### Runtime
 *
 * Deno only — run via
 *
 *   deno run --no-check -A scripts/ci/check-tailwind-tokens.ts
 *
 * Exit codes:
 *   0  — no undefined-token usages (or all flagged usages are on ALLOW_LIST)
 *   1  — at least one undefined-token usage outside ALLOW_LIST
 *   2  — script-internal error (e.g. index.css not found)
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenViolation {
  file: string;
  line: number;
  /** The full Tailwind class as it appears in source, e.g. `text-text-primary`. */
  className: string;
  /** Prefix (e.g. `text`, `bg`, `border`). */
  prefix: string;
  /** Token suffix that failed to resolve (e.g. `text-primary`). */
  suffix: string;
}

export interface CheckResult {
  filesScanned: number;
  classesScanned: number;
  /** All token names extracted from index.css @theme block (raw — e.g. `--color-text`). */
  definedTokens: string[];
  /** Violations the CI gate should fail on. */
  violations: TokenViolation[];
  /** Allow-listed (grandfathered) violations. */
  allowListed: TokenViolation[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Allow-list — file paths (relative to git root) that ARE allowed to use
 * undefined tokens. Each entry MUST include a reason comment.
 *
 * KEEP THIS LIST SHORT. Every entry is design-system debt — either:
 *  (a) add the missing token to `index.css @theme`, or
 *  (b) replace the offending class with a defined-token equivalent.
 *
 * Entries here are reviewed in Phase 69.5 tech-debt sweep.
 */
const ALLOW_LIST: ReadonlyArray<{ file: string; reason: string }> = [
  // Phase 69-01 initial-run audit (2026-05-27). Files below contain
  // undefined-token usages that would render invisible in Tailwind v4. They
  // are GRANDFATHERED so the CI gate goes green on main today; Phase 69.5
  // tech-debt sweep will replace each undefined token with a defined-token
  // equivalent (text-text-primary → text-text, text-accent → text-primary,
  // bg-warning-subtle → bg-warning-soft, etc.).
  {
    file: 'leanshot/src/components/AccountSuspended.tsx',
    reason: 'Phase 69.5: text-secondary, text-accent, ring-accent → swap to defined tokens',
  },
  {
    file: 'leanshot/src/components/knowledge/KnowledgeNotFound.tsx',
    reason: 'Phase 69.5: text-text-primary, text-accent → swap to text-text, text-primary',
  },
  {
    file: 'leanshot/src/components/knowledge/SourcesPanel.tsx',
    reason: 'Phase 69.5: text-text-primary, bg-warning-subtle, text-warning-foreground, border-border-subtle, text-accent → swap to defined tokens',
  },
];

/** Prefixes the gate inspects. Order matters for the regex below. */
const SCANNED_PREFIXES = [
  'text',
  'bg',
  'border',
  'from',
  'to',
  'via',
  'ring',
  'ring-offset',
  'divide',
  'placeholder',
  'fill',
  'stroke',
  'outline',
  'decoration',
  'caret',
  'accent',
  'shadow',
] as const;

/**
 * Tailwind v4 built-in suffixes that ARE NOT custom @theme tokens.
 * These resolve via Tailwind's standard utility scale and must not flag.
 *
 * Two-layer pattern (per `[[reference_two_layer_real_vs_stub_classifier]]`):
 * matchers here = LAYER 1 (allow), then check @theme = LAYER 2 (custom).
 */
const TAILWIND_BUILTIN_SUFFIXES = new Set<string>([
  // Numeric font-size scale
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  // text-* alignment / decoration / overflow / transform keywords
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'balance',
  'pretty',
  'wrap',
  'nowrap',
  'ellipsis',
  'clip',
  'truncate',
  'inherit',
  'current',
  'transparent',
  'black',
  'white',
  // text-decoration / list / etc
  'underline',
  'overline',
  'line-through',
  'no-underline',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
  // shadow standard sizes
  'inner',
  'none',
  // ring / outline standard
  'auto',
  'dashed',
  'dotted',
  'double',
  'solid',
  // border-* directional sides (border-t, border-r, border-b, border-l,
  // border-x, border-y, border-s, border-e) — Tailwind built-in.
  't',
  'r',
  'b',
  'l',
  'x',
  'y',
  's',
  'e',
  // border-* / border-style built-ins
  'collapse',
  'separate',
  'hidden',
  // divide-* directional (divide-x, divide-y) — already covered by x/y above.
  // Border-width / ring-width / outline-width / divide-width numeric scale.
  // Tailwind built-in: `0 1 2 4 8` (and `border` alone = 1px).
  '0',
  '1',
  '2',
  '4',
  '8',
  // text-/ring-/fill-/stroke-/etc. opacity built-ins (rarely used as primary suffix)
  'opacity',
]);

/**
 * Standard Tailwind palette names (red, blue, gray, slate, etc.) — these are
 * built-in colors that Tailwind v4 ships out-of-the-box. We don't ENCOURAGE
 * their use (project uses semantic tokens), but they ARE defined and won't
 * render invisible. Flagging them would create noise.
 *
 * Numeric color steps after these names (e.g. `red-500`, `blue-50`) also pass.
 */
const TAILWIND_PALETTE_COLORS = new Set<string>([
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]);

/**
 * Regex to find a Tailwind class. Captures `prefix` (e.g. `text`) + `suffix`
 * (the rest after the FIRST hyphen). Anchored on word boundary so it doesn't
 * accidentally match `data-test` etc.
 *
 * NOTE: this scans BOTH inside className/cn/clsx contexts and as a permissive
 * sweep — false-positive risk is low because non-class strings rarely contain
 * `text-foo`-shaped tokens.
 */
const CLASS_CONTEXT_RE = /(?:className\s*=\s*["'`]|className\s*=\s*\{[^}]*?["'`]|\bcn\s*\(|\bclsx\s*\(|\btw\s*`)([^"'`]*?)["'`]/g;

// Helper: detect bracket-arbitrary values e.g. `text-[#fff]`, `bg-[url(...)]`.
// These are escape-hatches — Tailwind passes them through verbatim so they
// can't render invisible. Allow.
function isArbitrary(suffix: string): boolean {
  return suffix.startsWith('[') && suffix.endsWith(']');
}

// Helper: numeric-only suffix (e.g. `text-13`, `bg-50`) — rare in this codebase
// but Tailwind v4 doesn't have a numeric `text-N` scale built-in, so it would
// resolve to undefined. We let the @theme check fail these naturally.

// Helper: opacity modifier like `bg-primary/50` — strip the `/N` suffix.
function stripOpacityModifier(suffix: string): string {
  const slash = suffix.indexOf('/');
  return slash === -1 ? suffix : suffix.slice(0, slash);
}

// ─── @theme parsing ──────────────────────────────────────────────────────────

/**
 * Extract token names from a Tailwind v4 `@theme { ... }` block.
 *
 * Returns the RAW token names (e.g. `--color-text`, `--text-base`). Caller
 * converts to Tailwind utility suffixes (`text` from `--color-text` etc.).
 *
 * Handles multiple `@theme { ... }` blocks (rare but possible).
 */
export function extractThemeTokens(cssSource: string): string[] {
  const tokens = new Set<string>();
  // Match every @theme { ... } block. The `[^{}]*` is naive but works because
  // index.css uses a single flat block per @theme.
  const blockRe = /@theme\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(cssSource)) !== null) {
    const body = m[1];
    const tokenRe = /^\s*(--[a-zA-Z][a-zA-Z0-9-]+)\s*:/gm;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(body)) !== null) {
      tokens.add(tm[1]);
    }
  }
  return [...tokens].sort();
}

/**
 * Map a defined `@theme` token name to the set of Tailwind utility suffixes
 * it produces. Tailwind v4 derives utility names by stripping the namespace
 * prefix:
 *
 *   --color-text         → text-text, bg-text, border-text, ...
 *   --color-text-secondary → text-text-secondary, bg-text-secondary, ...
 *   --text-base          → text-base (font-size)
 *   --font-display       → font-display
 *   --radius-card        → rounded-card
 *   --spacing            → p-N, m-N, w-N, ... (multiplied — built-in scale)
 *   --shadow-hero        → shadow-hero
 *   --animate-rise       → animate-rise
 *
 * For DS-01 we only care about COLOR namespaces (text-/bg-/border-/from-/etc.)
 * and TEXT namespaces (text-N — font-size). Other namespaces (radius, font,
 * animate, shadow, ease, duration, spacing) are NOT checked here; they're
 * either fully Tailwind-built-in (spacing) or self-contained (rounded-N).
 *
 * @returns Map of `suffix → true` for fast lookup.
 */
export function deriveValidSuffixes(definedTokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const tok of definedTokens) {
    // --color-text → text, --color-text-secondary → text-secondary
    if (tok.startsWith('--color-')) {
      out.add(tok.slice('--color-'.length));
    }
    // --text-base → base (font-size suffix), --text-heading → heading
    if (tok.startsWith('--text-')) {
      // Skip line-height / letter-spacing modifiers
      if (tok.includes('--line-height') || tok.includes('--letter-spacing')) {
        continue;
      }
      out.add(tok.slice('--text-'.length));
    }
    // --shadow-hero → hero (Tailwind exposes as shadow-hero)
    if (tok.startsWith('--shadow-')) {
      out.add(tok.slice('--shadow-'.length));
    }
    // --radius-card → card (Tailwind: rounded-card)
    if (tok.startsWith('--radius-')) {
      out.add(tok.slice('--radius-'.length));
    }
  }
  return out;
}

// ─── Source scanning ─────────────────────────────────────────────────────────

/**
 * Scan a single source file for Tailwind class usages and resolve each
 * against the defined-token set.
 */
export function scanSource(
  source: string,
  validSuffixes: Set<string>,
): Array<{ line: number; className: string; prefix: string; suffix: string }> {
  const violations: Array<{ line: number; className: string; prefix: string; suffix: string }> = [];

  // Strip block comments `/* ... */` (multi-line) — they often contain prose
  // like "the countdown is text-only" that would false-positive. Replace with
  // newline-padded blanks to preserve line numbers.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');

  // Pre-compute a fast prefix-match set
  const prefixSet = new Set<string>(SCANNED_PREFIXES);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Strip line comments `// ...` (but only when the `//` starts a comment —
    // i.e. not inside a string). Heuristic: scan for `//` not inside `"`/`'`/``.
    // Simple-and-cheap: drop everything from a leading-whitespace `//` onward.
    line = line.replace(/(^|\s)\/\/.*$/, '$1');

    // Cheap fast-path: skip lines that don't contain any `-` (no Tailwind class)
    if (!line.includes('-')) continue;

    // Naive tokenizer: split on whitespace + class-string delimiters and
    // inspect every word that looks like `prefix-suffix`. We accept an
    // arbitrary-value bracket suffix `[...]` (with anything inside it,
    // including parens and commas) OR a regular dotted/slashed token. False-
    // positive risk is bounded because we then check prefix ∈ SCANNED_PREFIXES.
    //
    // Two-pattern alternation:
    //   - prefix-[anything-but-square-bracket]+]  (arbitrary value)
    //   - prefix-tokenChars                       (regular token)
    const candidates = line.match(
      /[a-zA-Z][a-zA-Z0-9_-]*-(?:\[[^\]]*\]|[a-zA-Z0-9_/#.-]+)/g,
    );
    if (!candidates) continue;

    // Heuristic: skip candidates whose enclosing quoted string contains ONLY
    // that single token (e.g. TypeScript enum `'text-list'`, `case 'text-list':`).
    // A real className string has multiple tokens separated by whitespace.
    // We approximate by looking for the candidate inside a tight quote pair
    // with no whitespace on either side.
    const singletonStringRe = (tok: string): RegExp => {
      const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`["'\`]${esc}["'\`]`);
    };

    for (const candidate of candidates) {
      // Find first `-` split — but `ring-offset-N` uses TWO hyphens for the
      // prefix. Handle that special case.
      let prefix: string;
      let suffix: string;
      if (candidate.startsWith('ring-offset-')) {
        prefix = 'ring-offset';
        suffix = candidate.slice('ring-offset-'.length);
      } else {
        const firstDash = candidate.indexOf('-');
        prefix = candidate.slice(0, firstDash);
        suffix = candidate.slice(firstDash + 1);
      }

      if (!prefixSet.has(prefix)) continue;

      // Skip if the candidate appears as a singleton string literal AND that
      // string is NOT used as a className/cn/clsx argument — i.e., it's an
      // enum value, switch discriminator, dict key, etc.
      //
      // Heuristic: candidate appears as `"text-list"` (tight quotes) and the
      // surrounding context is not `className=`/`cn(`/`clsx(`/`tw\``.
      if (singletonStringRe(candidate).test(line)) {
        // Is the candidate inside a className-flavored context on this line?
        // (Cheap line-level check; multi-line className= is rare for singletons.)
        const isClassContext = /className\s*=|class\s*=|\bcn\s*\(|\bclsx\s*\(|\btw\s*`/.test(
          line,
        );
        if (!isClassContext) continue;
      }

      // Arbitrary value — Tailwind passes through verbatim, can't render invisible
      if (isArbitrary(suffix)) continue;

      // Strip opacity modifier `/N`
      const baseSuffix = stripOpacityModifier(suffix);

      // Built-in Tailwind keyword (text-center, text-balance, etc.) → allow
      if (TAILWIND_BUILTIN_SUFFIXES.has(baseSuffix)) continue;

      // Built-in palette color (red-500, blue, etc.) → allow
      const firstSegment = baseSuffix.split('-')[0];
      if (TAILWIND_PALETTE_COLORS.has(firstSegment)) continue;

      // Directional border / divide width built-ins.
      //
      // border-{t,r,b,l,x,y,s,e}-{0,1,2,4,8}  → border-side-width built-in
      // border-{t,r,b,l,x,y,s,e}-{paletteColor[-N]}  → directional border color
      // border-{t,r,b,l,x,y,s,e}-{builtinKeyword}  → e.g. border-t-transparent
      //
      // Only applies to the `border` prefix (and `divide`, but those use the
      // form `divide-x`/`divide-y` which is already covered by the base
      // TAILWIND_BUILTIN_SUFFIXES set above).
      if (prefix === 'border') {
        const dashIdx = baseSuffix.indexOf('-');
        if (dashIdx > 0) {
          const side = baseSuffix.slice(0, dashIdx);
          const rest = baseSuffix.slice(dashIdx + 1);
          const sides = new Set(['t', 'r', 'b', 'l', 'x', 'y', 's', 'e']);
          if (sides.has(side)) {
            // border-side-[arbitrary] — passes through verbatim
            if (isArbitrary(rest)) continue;
            // border-side-{builtin keyword|builtin palette|width number}
            if (TAILWIND_BUILTIN_SUFFIXES.has(rest)) continue;
            const restFirst = rest.split('-')[0];
            if (TAILWIND_PALETTE_COLORS.has(restFirst)) continue;
            // border-side-{custom token suffix from @theme}
            if (validSuffixes.has(rest)) continue;
          }
        }
      }

      // SVG-attribute-flavored utilities that Tailwind v4 ships built-in
      // (e.g. bg-no-repeat, stroke-width, stroke-linecap, stroke-linejoin,
      // fill-rule, etc.) — these are SVG presentation utilities, not custom
      // tokens, and Tailwind has them built-in.
      const SVG_BUILTIN_SUFFIXES = new Set([
        'no-repeat',
        'repeat',
        'repeat-x',
        'repeat-y',
        'width',
        'linecap',
        'linejoin',
        'rule',
        'dashoffset',
        'dasharray',
      ]);
      if (SVG_BUILTIN_SUFFIXES.has(baseSuffix)) continue;

      // bg-gradient-to-{br,bl,tr,tl,t,b,l,r} — Tailwind built-in gradient direction.
      if (prefix === 'bg' && /^gradient-to-(?:br|bl|tr|tl|t|b|l|r)$/.test(baseSuffix)) {
        continue;
      }

      // ring-inset — Tailwind built-in ring inset modifier.
      if (prefix === 'ring' && baseSuffix === 'inset') continue;
      // outline-offset built-in
      if (prefix === 'outline' && baseSuffix.startsWith('offset')) continue;

      // Trailing-punctuation cleanup: candidates can capture a final `.` or
      // `,` from prose context (e.g. `text-tertiary.`). Strip and re-check.
      if (/[.,;:!?]$/.test(baseSuffix)) {
        const cleaned = baseSuffix.replace(/[.,;:!?]+$/, '');
        if (
          TAILWIND_BUILTIN_SUFFIXES.has(cleaned) ||
          TAILWIND_PALETTE_COLORS.has(cleaned.split('-')[0]) ||
          validSuffixes.has(cleaned)
        ) {
          continue;
        }
        // Not allowed even after cleanup — fall through to violation report
        // with the cleaned suffix so the message is accurate.
        violations.push({
          line: i + 1,
          className: candidate.replace(/[.,;:!?]+$/, ''),
          prefix,
          suffix: cleaned,
        });
        continue;
      }

      // text-N where N is a built-in scale (xs, sm, base, lg, xl, ...) — already
      // covered by TAILWIND_BUILTIN_SUFFIXES above.

      // Defined in @theme? → allow
      if (validSuffixes.has(baseSuffix)) continue;

      // Otherwise — UNDEFINED. Will render invisible in Tailwind v4.
      violations.push({
        line: i + 1,
        className: candidate,
        prefix,
        suffix: baseSuffix,
      });
    }
  }

  return violations;
}

// ─── Main scan ───────────────────────────────────────────────────────────────

export async function scanProject(
  srcRoot: string,
  indexCssPath: string,
): Promise<CheckResult> {
  const cssSource = await Deno.readTextFile(indexCssPath);
  const definedTokens = extractThemeTokens(cssSource);
  const validSuffixes = deriveValidSuffixes(definedTokens);

  const result: CheckResult = {
    filesScanned: 0,
    classesScanned: 0,
    definedTokens,
    violations: [],
    allowListed: [],
  };

  for await (
    const entry of walk(srcRoot, {
      exts: ['.tsx', '.ts'],
      skip: [/\.test\.tsx?$/, /\.stories\.tsx?$/, /__tests__/],
    })
  ) {
    if (!entry.isFile) continue;
    result.filesScanned++;

    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }

    const fileViolations = scanSource(source, validSuffixes);
    const relPath = relative(Deno.cwd(), entry.path);

    const allowEntry = ALLOW_LIST.find((a) => relPath === a.file || relPath.endsWith(a.file));

    for (const v of fileViolations) {
      const violation: TokenViolation = {
        file: relPath,
        line: v.line,
        className: v.className,
        prefix: v.prefix,
        suffix: v.suffix,
      };
      if (allowEntry) {
        result.allowListed.push(violation);
      } else {
        result.violations.push(violation);
      }
    }
  }

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Files scanned: ${r.filesScanned}`);
  lines.push(`Defined @theme tokens: ${r.definedTokens.length}`);
  lines.push('');

  if (r.allowListed.length > 0) {
    lines.push(`Allow-listed (grandfathered) — ${r.allowListed.length}:`);
    const byFile = new Map<string, number>();
    for (const v of r.allowListed) {
      byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    }
    for (const [file, count] of [...byFile.entries()].sort()) {
      lines.push(`  • ${file} — ${count} usage(s)`);
    }
    lines.push('');
  }

  if (r.violations.length > 0) {
    lines.push(`UNDEFINED-TOKEN VIOLATIONS — ${r.violations.length}:`);
    // Group by file for readability
    const byFile = new Map<string, TokenViolation[]>();
    for (const v of r.violations) {
      if (!byFile.has(v.file)) byFile.set(v.file, []);
      byFile.get(v.file)!.push(v);
    }
    for (const [file, vs] of [...byFile.entries()].sort()) {
      lines.push(`  ${file}:`);
      for (const v of vs) {
        lines.push(`    line ${v.line}: ${v.className} → suffix "${v.suffix}" not in @theme`);
      }
    }
    lines.push('');
  } else {
    lines.push('No undefined-token usages found.');
  }

  return lines.join('\n');
}

if (import.meta.main) {
  const cwd = Deno.cwd();
  const srcRoot = Deno.env.get('SRC_ROOT') ?? join(cwd, 'leanshot', 'src');
  const indexCssPath = Deno.env.get('INDEX_CSS') ?? join(cwd, 'leanshot', 'src', 'index.css');

  try {
    const stat = await Deno.stat(srcRoot);
    if (!stat.isDirectory) {
      console.error(`FATAL: ${srcRoot} is not a directory`);
      Deno.exit(2);
    }
  } catch {
    console.error(`FATAL: ${srcRoot} not found (cwd=${cwd}).`);
    console.error('       Run from git root, or set SRC_ROOT.');
    Deno.exit(2);
  }

  try {
    await Deno.stat(indexCssPath);
  } catch {
    console.error(`FATAL: ${indexCssPath} not found. Set INDEX_CSS.`);
    Deno.exit(2);
  }

  const result = await scanProject(srcRoot, indexCssPath);
  console.log(formatResult(result));

  if (result.violations.length > 0) {
    console.error('');
    console.error(`FAIL: ${result.violations.length} undefined-token usage(s) found.`);
    console.error('      Tailwind v4 silently no-ops these → invisible UI.');
    console.error('      Fix: either add the token to @theme in src/index.css,');
    console.error('      or replace the class with a defined-token equivalent.');
    Deno.exit(1);
  }

  console.log('');
  console.log('PASS: every Tailwind utility resolves to a defined @theme token or built-in.');
  Deno.exit(0);
}
