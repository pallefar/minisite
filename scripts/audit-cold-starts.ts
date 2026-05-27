/**
 * Phase 67 Plan 67-03 — OPS-09 Edge Function cold-start audit (operator-run).
 *
 * Discovers every Supabase Edge Function under `supabase/functions/<fn>/` and
 * hits its `/healthz` endpoint N times with a 60-second pause between samples
 * to force a fresh-container cold-start each time. Measures p50/p95/p99
 * latency, writes a Markdown table to
 *   `leanshot/.planning/runbooks/edge-fn-cold-starts.md`
 * and flags any Fn whose p95 exceeds the configurable threshold.
 *
 * ### NOT for CI
 *
 * This script is operator-run during deploy (off-hours). The default settings
 * (10 samples × 60s wait) take roughly **10 minutes per Fn** — across ~25
 * production Fns that's >4 hours. Use `--samples 3 --wait 5` for a quick
 * smoke-only run that doesn't actually exercise the cold path.
 *
 * ### Usage
 *
 *   deno run --allow-net --allow-read --allow-write --allow-env \
 *     scripts/audit-cold-starts.ts [--help]
 *     [--project-ref ytnsipxxmzgaebkqmokp]
 *     [--samples 10]
 *     [--wait 60]
 *     [--threshold-ms 1500]
 *     [--fns stripe-checkout,stripe-webhook,...]
 *     [--out leanshot/.planning/runbooks/edge-fn-cold-starts.md]
 *
 * ### Why this isn't in CI
 *
 * Cold-start latency is a property of the Supabase Edge runtime, not of any
 * single PR. Running this in CI would (a) burn ~4 hours of runner time per
 * PR, (b) hit production-billed Function invocations, and (c) give noisy
 * results unrelated to the merged change. Operator runs it after deploy and
 * commits the regenerated runbook.
 */

import { join, dirname, fromFileUrl } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PROJECT_REF = 'ytnsipxxmzgaebkqmokp'; // LeanShot Supabase project ref
const DEFAULT_SAMPLES = 10;
const DEFAULT_WAIT_SECONDS = 60;
const DEFAULT_THRESHOLD_MS = 1500;
const DEFAULT_OUT_PATH = 'leanshot/.planning/runbooks/edge-fn-cold-starts.md';

// ─── CLI parsing ─────────────────────────────────────────────────────────────

interface Args {
  help: boolean;
  projectRef: string;
  samples: number;
  waitSeconds: number;
  thresholdMs: number;
  fnsOverride: string[] | null;
  outPath: string;
  functionsDir: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    help: false,
    projectRef: DEFAULT_PROJECT_REF,
    samples: DEFAULT_SAMPLES,
    waitSeconds: DEFAULT_WAIT_SECONDS,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    fnsOverride: null,
    outPath: DEFAULT_OUT_PATH,
    functionsDir: 'supabase/functions',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--project-ref') out.projectRef = next();
    else if (a === '--samples') out.samples = Number(next());
    else if (a === '--wait') out.waitSeconds = Number(next());
    else if (a === '--threshold-ms') out.thresholdMs = Number(next());
    else if (a === '--fns') out.fnsOverride = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') out.outPath = next();
    else if (a === '--functions-dir') out.functionsDir = next();
  }
  return out;
}

function printHelp(): void {
  console.log(`
audit-cold-starts.ts — Phase 67 OPS-09 Edge Fn cold-start audit (operator-run)

USAGE
  deno run --allow-net --allow-read --allow-write --allow-env \\
    scripts/audit-cold-starts.ts [options]

OPTIONS
  --help, -h               Show this help
  --project-ref <ref>      Supabase project ref (default: ${DEFAULT_PROJECT_REF})
  --samples <N>            Samples per Fn (default: ${DEFAULT_SAMPLES})
  --wait <SECONDS>         Pause between samples in seconds (default: ${DEFAULT_WAIT_SECONDS})
                           Long pauses force cold-cache; short pauses smoke-test only.
  --threshold-ms <MS>      Flag p95 above this threshold (default: ${DEFAULT_THRESHOLD_MS})
  --fns <a,b,c>            Comma-separated explicit Fn list; default = auto-discover
                           every dir under supabase/functions/ (excluding _shared, tests)
  --out <PATH>             Markdown output path (default: ${DEFAULT_OUT_PATH})
  --functions-dir <PATH>   Override functions dir (default: supabase/functions)

WHEN TO RUN
  After each production deploy that touched Edge Fns. Off-hours preferred —
  the 10×60s default schedule takes ~10 minutes per Fn (~4 hours full sweep).

QUICK SMOKE
  deno run --allow-net --allow-read --allow-write --allow-env \\
    scripts/audit-cold-starts.ts --samples 3 --wait 5

NOTE
  This script is NOT wired into CI. Cold-start latency is a runtime property
  and shouldn't gate PR merges. See header comment for full rationale.
`);
}

// ─── Fn discovery ────────────────────────────────────────────────────────────

async function discoverFns(functionsDir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(functionsDir)) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('__') || entry.name === 'tests') continue;
    // Require an index.ts to count as a deployable Fn.
    try {
      const stat = await Deno.stat(join(functionsDir, entry.name, 'index.ts'));
      if (stat.isFile) out.push(entry.name);
    } catch {
      // No index.ts → skip
    }
  }
  out.sort();
  return out;
}

// ─── Sampler ─────────────────────────────────────────────────────────────────

export interface FnTimings {
  fn: string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  errors: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  // Nearest-rank (favours conservative p95 over interpolation).
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(p * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

async function timeColdStart(
  projectRef: string,
  fn: string,
  samples: number,
  waitSeconds: number,
): Promise<FnTimings> {
  const url = `https://${projectRef}.supabase.co/functions/v1/${fn}/healthz`;
  const ts: number[] = [];
  let errors = 0;

  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    try {
      const res = await fetch(url, {
        headers: { 'cache-control': 'no-cache' },
      });
      // Drain body so the connection isn't left half-open.
      await res.arrayBuffer();
      if (!res.ok && res.status !== 401) {
        // 401 is expected for Fns requiring auth on healthz; still measures
        // cold-start. Anything else (5xx, 404) is an error.
        errors++;
      }
    } catch {
      errors++;
    }
    ts.push(performance.now() - start);

    if (i < samples - 1) {
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    }
  }

  const sorted = [...ts].sort((a, b) => a - b);
  return {
    fn,
    samples: ts,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    errors,
  };
}

// ─── Report ──────────────────────────────────────────────────────────────────

function formatMarkdown(
  results: FnTimings[],
  args: Args,
  startedAt: string,
  finishedAt: string,
): string {
  const header = `# Edge Function Cold-Start Audit

**Generated:** ${finishedAt}
**Started:** ${startedAt}
**Project ref:** \`${args.projectRef}\`
**Samples per Fn:** ${args.samples}
**Wait between samples:** ${args.waitSeconds}s
**p95 threshold:** ${args.thresholdMs}ms

This file is regenerated by \`scripts/audit-cold-starts.ts\`. **Do not edit by
hand** — re-run the script to refresh.

See script header for context on why this is operator-run, not CI-gated.

## Results

| Fn | p50 (ms) | p95 (ms) | p99 (ms) | Errors | Flag |
|---|---:|---:|---:|---:|:---:|
`;
  const rows = results
    .slice()
    .sort((a, b) => b.p95 - a.p95)
    .map((r) => {
      const flag = r.p95 > args.thresholdMs ? ` SLOW p95>${args.thresholdMs}ms` : '';
      return `| \`${r.fn}\` | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.errors} | ${flag.trim() || 'ok'} |`;
    })
    .join('\n');

  const slow = results.filter((r) => r.p95 > args.thresholdMs);
  const summary = `

## Summary

- **Fns sampled:** ${results.length}
- **Above p95 threshold:** ${slow.length}${slow.length > 0 ? ' — ' + slow.map((r) => `\`${r.fn}\``).join(', ') : ''}
- **Total errors:** ${results.reduce((s, r) => s + r.errors, 0)}
`;

  return header + rows + summary;
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  // Validate functions dir.
  try {
    const stat = await Deno.stat(args.functionsDir);
    if (!stat.isDirectory) throw new Error('not a dir');
  } catch {
    console.error(`FATAL: --functions-dir '${args.functionsDir}' not found.`);
    console.error('Run from the git root, or pass --functions-dir.');
    Deno.exit(2);
  }

  const fns = args.fnsOverride ?? await discoverFns(args.functionsDir);
  if (fns.length === 0) {
    console.error('FATAL: no Edge Fns discovered.');
    Deno.exit(2);
  }

  const startedAt = new Date().toISOString();
  console.log(`Sampling ${fns.length} Fn(s) — ${args.samples} samples × ${args.waitSeconds}s wait...`);
  const estMinutes = (fns.length * args.samples * args.waitSeconds) / 60;
  console.log(`Estimated wall time: ~${estMinutes.toFixed(0)} minutes.`);

  const results: FnTimings[] = [];
  for (const fn of fns) {
    console.log(`  → ${fn}`);
    const r = await timeColdStart(args.projectRef, fn, args.samples, args.waitSeconds);
    results.push(r);
    const flag = r.p95 > args.thresholdMs ? ` SLOW (p95=${r.p95.toFixed(0)}ms)` : '';
    console.log(`     p50=${r.p50.toFixed(0)}ms p95=${r.p95.toFixed(0)}ms p99=${r.p99.toFixed(0)}ms errors=${r.errors}${flag}`);
  }

  const finishedAt = new Date().toISOString();
  const md = formatMarkdown(results, args, startedAt, finishedAt);

  // Ensure parent dir exists.
  await Deno.mkdir(dirname(args.outPath), { recursive: true });
  await Deno.writeTextFile(args.outPath, md);

  console.log('');
  console.log(`Report written to: ${args.outPath}`);

  const slow = results.filter((r) => r.p95 > args.thresholdMs);
  if (slow.length > 0) {
    console.log(`${slow.length} Fn(s) above p95 threshold:`);
    for (const r of slow) {
      console.log(`  • ${r.fn} — p95=${r.p95.toFixed(0)}ms`);
    }
  }
}

// Silence unused-import in module-mode.
export { fromFileUrl };
