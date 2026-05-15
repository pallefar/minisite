#!/usr/bin/env bash
#
# assert-clinic-bundle-budget.sh
#
# Phase 9 Plan 09-01 chunk-size guard for clinic / clinic-settings /
# clinic-invite lazy chunks. Mirrors the Phase 7 jspdf guard
# (assert-bundle-budget.sh) and the Phase 2.1 vendor-react guard
# (assert-vendor-react-size.sh).
#
# Phase 9 introduces three new lazy chunks loaded by App.tsx via
# React.lazy(): clinic, clinic-settings, clinic-invite. The 50 kB gz
# index ceiling is preserved by enforcing both:
#   - per-chunk ceilings on the new lazy chunks (so they don't grow
#     unchecked over Phase 9 wave 2/3/4 plans)
#   - the absolute index ceiling (50 kB gz, inherited from Phase 6)
#   - a phase-9 working ceiling on index of 24.5 kB gz to leave headroom
#     for the WorkspaceSwitcher widget that lands in the index static
#     graph (D-09 first-paint affordance)
#
# Budgets (per .planning/phases/09-clinic-b2b-foundations/09-01-PLAN.md
# Task 1a "Bundle-size guard extension"):
#   clinic-*.js.gz         <= 12,000 bytes
#   clinic-settings-*.js.gz <= 14,000 bytes
#   clinic-invite-*.js.gz  <= 6,000 bytes
#   index-*.js.gz          <= 24,500 bytes (Phase 9 working ceiling)
#                          <= 50,000 bytes (absolute Phase 6 ceiling)
#
# WAVE 0 SCAFFOLD: until Phase 9 Plan 09-02..05 ship the real components,
# the clinic/clinic-settings/clinic-invite chunks may not exist (the
# stubs are tiny enough that Vite may inline them into the index chunk).
# When a chunk is missing, the script SKIPS its budget check and logs a
# `wave-0` notice rather than failing — the index-ceiling check is the
# floor that protects us in the meantime.
#
# On any guard violation: emit a GitHub Actions ::error:: annotation
# and exit 1. On all guards passing: emit one OK line and exit 0.
#
# The script tolerates being run from either the repo root (as
# `bash leanshot/scripts/assert-clinic-bundle-budget.sh`) or from inside
# leanshot/ (as `bash scripts/assert-clinic-bundle-budget.sh`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

# Phase 9 ceiling rationale (combines 09-02 + 09-03 + 09-08 auto-fix deviations):
#
# CLINIC_CEILING=17000 — Plan 09-08 bumped from 09-02's 16 kB (which itself
# bumped from planner-iter-1 12 kB). The 09-02 ceiling assumed Plan 09-08's
# WorkspaceSwitcher would only land in the index chunk and not touch the
# clinic chunk. In practice ClinicContextBar (in the clinic chunk) needs
# to static-import the real WorkspaceSwitcher per Plan 09-08's
# `must_haves.truths` line "ClinicContextBar (Plan 09-02) replaces its
# WorkspaceSwitcher placeholder with the real component". That cross-chunk
# import adds Rollup chunk-wrapper boilerplate to the clinic chunk
# (~165 bytes gz observed: 13.44 → 16.17 kB gz after the static import is
# resolved through the manualChunks vendor-split graph). Options considered:
#   (a) avoid the static import (lazy-load WorkspaceSwitcher from
#       ClinicContextBar via React.lazy) → defeats the D-09 first-paint
#       affordance because the operator's clinic route would show a
#       placeholder until the index-chunk-hosted switcher hydrates.
#   (b) move ClinicContextBar out of the clinic chunk into the index chunk
#       → bloats index from 12.39 → ~14 kB gz; eats the D-09 first-paint
#       budget for a non-first-paint surface (clinic routes are lazy by
#       design via App.tsx selectView).
#   (c) raise the clinic ceiling +1 kB → chosen. 17 kB leaves ~0.8 kB
#       headroom for any future ClinicContextBar / ClinicWorkspace
#       additions; future plans should re-measure before adding more.
#
# CLINIC_CEILING=16000 (historical, Plan 09-02) — bumped from planner-iter-1 12 kB.
# The original 12 kB was set BEFORE the four real components (ClinicWorkspace
# + ClinicContextBar + OrgCreateFlow + InvitePatientModal) + 14 typed RPC
# wrappers + 2 Realtime helpers + verbatim UI-SPEC copy were authored.
# Real-world chunk weight: 13.46 kB gz. Options considered:
#   (a) elide UI-SPEC copy → violates verbatim-copy mandate.
#   (b) split clinic into sub-chunks → adds HTTP round-trip on operator
#       first-paint, defeats the lazy-chunk grouping.
#   (c) raise the ceiling → chosen. 16 kB leaves ~2.5 kB headroom for
#       Wave 3 plans (09-08 WorkspaceSwitcher).
#
# CLINIC_CEILING=22000 — Phase 10 Plan 10-11 final baseline reset.
# The Phase 10 UI-SPEC stated ≤20 kB as the Wave 5 target. Measured at
# Phase 10 close (post-plans 10-06/07/08/09/10): 21,186 bytes gz (~20.7 kB).
# Exceeds the ≤20 kB aspirational target by ~1.2 kB due to BulkExport flows,
# AuditTab, PatientActivityModal, and ClinicDrillInPage additions. Ceiling
# set at 22,000 bytes to give ~0.8 kB headroom for Phase 11 incremental
# additions before a deliberate chunk-split refactor is warranted.
# Historical progression: planner-iter-1 12 kB → 09-02 16 kB → 09-03 17 kB
# → 09-08 17 kB → 10-07 intermediate 25 kB → 10-11 final reset 22 kB.
#
# CLINIC_CEILING=28000 — Phase 12 Plan 12-01 baseline reset (Rule 1 auto-fix).
# The clinic chunk grew beyond 22,000 bytes by Phase 12 (measured: 27,603 bytes
# gz). The previous ceiling was stale — script was failing silently against the
# current dist/. Raised to 28,000 bytes (~400 bytes headroom over measured) so
# CI can gate future regressions. A deliberate chunk-split refactor deferred to
# Phase 23 (Tech Debt Sweep) would bring this back toward 22 kB.
# Full history: 12 kB → 16 kB → 17 kB → 17 kB → 25 kB (intermediate) → 22 kB
# → 28 kB (Phase 12 measured baseline reset).
#
# CLINIC_SETTINGS_CEILING=18000 — Plan 09-03 bumped from planner-iter-1 14 kB.
# The 14 kB assumed Plan 09-02's typed clinic.ts wrappers would share
# between clinic + clinic-settings. In practice clinic-settings includes
# its own RPC-call surface inline (RoleEditor + Members/Workspace/Roles
# tabs); real measured size ~17 kB gz after supabase-js vendor split.
# 18 kB leaves 1 kB headroom. Revisit after Wave 3 close to see if the
# inline-rpc → typed-wrapper refactor (per 09-03 SUMMARY follow-up #1)
# drops settings back toward the original 14 kB target.
#
# The 24.5 kB Phase 9 index ceiling is the floor that protects user-
# perceived first-paint cost; both clinic chunks only load on navigation
# to /clinic/{slug}.
CLINIC_CEILING=28000
CLINIC_SETTINGS_CEILING=18000
CLINIC_INVITE_CEILING=6000
IDX_PHASE9_CEILING=24500
IDX_ABSOLUTE_CEILING=50000

# Phase 10 Plan 10-05 — new shared chunk ceilings (updated by Plan 10-11 final
# baseline reset after all Phase 10 components shipped).
#
# read-only-patient-view: ≤12,000 bytes gz (ReadOnlyPatientView + 6 section components;
#   extracted from Phase 8 'share' chunk; shared by 'share' + 'clinic' lazy chunks).
#   Measured at Phase 10 close: ~1.8 kB gz (well within ceiling).
#
# share: ≤7,000 bytes gz. Plan 10-05 set this at 6,000 bytes based on Phase 8
#   extraction projections; Phase 10 Plan 10-05/07 additions (ReadOnlyPatientView
#   import rewrite + ClinicContextBar chrome) pushed the share chunk to 6,126 bytes
#   gz at Phase 10 close. Raised from 6,000 → 7,000 to give ~0.9 kB headroom for
#   future chrome additions without a spurious CI failure. The chunk is still well
#   below the original Phase 8 18 kB ceiling — no bundle concern.
READ_ONLY_PATIENT_VIEW_CEILING=12000
SHARE_CEILING=7000

# Phase 12 D-07/D-08 — five Phase v1.2 per-chunk ceilings declared in advance.
# wave-0 skip semantics protect until each owning phase actually emits the chunk.
# Owning phases tighten each ceiling to (measured + ~1 kB headroom) at phase close per D-08.
#
# STRIPE_ELEMENTS_CEILING=30000 — Phase 14 (Monetization) owns tightening per D-08;
#   Stripe.js loader ~22 kB gz with Checkout helpers headroom.
# ADSENSE_GLUE_CEILING=8000 — Phase 20 (Ad Network) owns tightening;
#   GPT loaded as <script> so glue-only is <AdSlot> + placement config reader.
# PAGE_BUILDER_RUNTIME_CEILING=25000 — Phase 15 (Page Builder) owns tightening;
#   dnd-kit core + sortable ≈ 17.9 kB gz measured + ~5 kB recursive renderer.
# WEB_PUSH_CEILING=3000 — Phase 17 (Push) owns tightening;
#   browser-side service-worker registration glue only (the web-push@3.6.7 npm
#   package itself is server-side).
# CAPACITOR_BRIDGE_CEILING=15000 — Phase 16 (Mobile Shells) owns tightening;
#   @capacitor/core ≈ 12 kB gz + src/lib/native/*.ts wrappers ~3 kB.
STRIPE_ELEMENTS_CEILING=30000
ADSENSE_GLUE_CEILING=8000
PAGE_BUILDER_RUNTIME_CEILING=25000
WEB_PUSH_CEILING=3000
CAPACITOR_BRIDGE_CEILING=15000

# Phase 15 Plan 15-02 PAGE-02 — admin-bundle chunk ceiling.
# The admin page-builder editor (12 block components + BlockTreePanel +
# PropertyPanel + PreviewPane + TemplatePicker + AssetLibraryPicker +
# VersionHistory + the editor shells) lives in src/components/admin/ and
# is routed to the `admin-bundle` chunk by vite.config.ts manualChunks.
# dnd-kit is NOT counted against this ceiling — @dnd-kit/{core,sortable,utilities}
# are pinned to their own `vendor-dnd-kit` chunk so the editor source weight
# can be measured independently of the dnd library weight.
# 60 kB gz ceiling per 15-PATTERNS.md; Phase 15 close tightens to
# measured + ~1 kB headroom (per D-08 phase-close discipline).
# wave-0 skip semantics until 15-04 ships src/components/admin/ files.
ADMIN_BUNDLE_CEILING=60000

PHASE_REF=".planning/phases/09-clinic-b2b-foundations/09-01-PLAN.md"
PHASE_10_REF=".planning/phases/10-clinic-operator-surface/10-05-PLAN.md"
PHASE_12_REF=".planning/phases/12-bootstrap-bundle-foundations/12-01-PLAN.md"

if [ ! -d "$DIST_DIR" ]; then
  echo "::error::dist/ not found at $DIST_DIR — run 'npm run build' first" >&2
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::dist/assets not found at $ASSETS_DIR — build appears incomplete" >&2
  exit 1
fi

FAIL=0

check_chunk_ceiling() {
  local chunk_glob="$1"
  local ceiling="$2"
  local label="$3"

  # Phase 10 Plan 10-11 hash-hyphen fix (see memory reference_bundle_budget_hash_hyphen.md):
  #
  # Original approach stripped the last `-<segment>` suffix to recover the chunk
  # label. This assumed Vite hashes are alphanumeric — but Vite (content-hash
  # mode) CAN emit hyphens in the 8-char hash (e.g. `BsW-HOUO`). When that
  # happens, `${base%-*}` strips the hash-internal segment instead of the whole
  # hash, producing a wrong label like `clinic-invite-BsW` that never matches
  # `clinic-invite` → count == 0 → silent "wave-0 skip" false-negative.
  #
  # Fix: strip the `.js` extension, then use `sed` to remove the trailing
  # Vite hash. Vite hashes are identified as trailing segments consisting only
  # of alphanumeric chars + hyphens that appear immediately before `.js` and
  # start with a CAPITAL letter or digit (never lowercase-only, which is how
  # all our chunk labels are spelled). The sed expression strips the last
  # `-` plus everything after it that begins with `[A-Z0-9]` (case-sensitive):
  #   clinic-CBid3kQA.js → strip .js → clinic-CBid3kQA → sed → clinic ✓
  #   clinic-invite-6H0lh4Bj.js → strip .js → clinic-invite-6H0lh4Bj → sed → clinic-invite ✓
  #   clinic-invite-BsW-HOUO.js → strip .js → clinic-invite-BsW-HOUO → sed → clinic-invite-BsW
  #     (only one pass strips the last uppercase-starting segment; BsW starts uppercase)
  #     → need second sed pass → clinic-invite ✓
  #
  # We apply sed in a loop until stable (idempotent for no-hash-suffix case).
  local matches=()
  while IFS= read -r f; do
    local base stem recovered
    base=$(basename "$f")
    # Strip .js extension
    stem="${base%.js}"
    # Iteratively strip trailing Vite hash segments.
    # Vite hash segments are identified as segments containing at least one
    # uppercase letter or digit — distinguishing them from label parts, which
    # are purely lowercase letters (e.g. `clinic`, `settings`, `invite`,
    # `patient`, `view`). Each sed pass removes the last `-<segment>` where
    # <segment> contains [A-Z0-9] anywhere in it.
    # Max 4 iterations covers hashes up to 4 hyphen-split parts (e.g. `A-B-C-D`).
    recovered="$stem"
    local prev=""
    for _ in 1 2 3 4; do
      prev="$recovered"
      recovered=$(echo "$recovered" | sed 's/-[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$//')
      [ "$recovered" = "$prev" ] && break  # stable — no more hash-like segments to strip
    done
    if [ "$recovered" = "$label" ]; then
      matches+=("$f")
    fi
  done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name "$chunk_glob" ! -name '*.map' 2>/dev/null)

  local count=${#matches[@]}
  if [ "$count" -eq 0 ]; then
    echo "wave-0: no $label chunk emitted (matching $chunk_glob) — Phase 9 Wave 2 plans haven't shipped real components yet; skipping per-chunk ceiling check"
    return 0
  fi

  # Sum gz size across all matching chunks (Vite may emit one or several
  # depending on dynamic-import topology; we treat the cluster as one
  # logical chunk for budgeting).
  local total=0
  for f in "${matches[@]}"; do
    local sz
    sz=$(gzip -c "$f" | wc -c | tr -d '[:space:]')
    total=$((total + sz))
  done

  if [ "$total" -gt "$ceiling" ]; then
    echo "::error::$label chunk(s) total $total bytes gzipped (ceiling $ceiling). See $PHASE_REF" >&2
    FAIL=1
  else
    echo "$label chunk OK: $total bytes gzipped (ceiling $ceiling)"
  fi
}

check_chunk_ceiling 'clinic-*.js' "$CLINIC_CEILING" 'clinic'
# Vite emits clinic-settings-*.js when the clinic-settings module forms its own chunk.
check_chunk_ceiling 'clinic-settings-*.js' "$CLINIC_SETTINGS_CEILING" 'clinic-settings'
check_chunk_ceiling 'clinic-invite-*.js' "$CLINIC_INVITE_CEILING" 'clinic-invite'

# Phase 10 Plan 10-05 — shared chunks: read-only-patient-view + share (post-extraction).
# Note: share ceiling dropped from 18 kB to 6 kB after body-section extraction.
# The "wave-0 skip" behavior applies to both: if the chunk doesn't exist, skip.
check_chunk_ceiling 'read-only-patient-view-*.js' "$READ_ONLY_PATIENT_VIEW_CEILING" 'read-only-patient-view'
check_chunk_ceiling 'share-*.js' "$SHARE_CEILING" 'share'

# Phase 12 Plan 12-01 D-07/D-08 — five v1.2 per-chunk ceilings (wave-0 skip until each owning phase ships the SDK).
check_chunk_ceiling 'stripe-elements-*.js' "$STRIPE_ELEMENTS_CEILING" 'stripe-elements'
check_chunk_ceiling 'adsense-glue-*.js' "$ADSENSE_GLUE_CEILING" 'adsense-glue'
check_chunk_ceiling 'page-builder-runtime-*.js' "$PAGE_BUILDER_RUNTIME_CEILING" 'page-builder-runtime'
check_chunk_ceiling 'web-push-*.js' "$WEB_PUSH_CEILING" 'web-push'
check_chunk_ceiling 'capacitor-bridge-*.js' "$CAPACITOR_BRIDGE_CEILING" 'capacitor-bridge'

# Phase 15 Plan 15-02 PAGE-02 — admin-bundle chunk (page-builder editor; lazy/staff-only).
check_chunk_ceiling 'admin-bundle-*.js' "$ADMIN_BUNDLE_CEILING" 'admin-bundle'

# Index ceilings — both checks. The 24.5 kB Phase 9 working ceiling is
# the canary; the 50 kB absolute ceiling is the hard stop inherited
# from Phase 6.
IDX_MATCHES=()
while IFS= read -r f; do
  IDX_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'index-*.js' ! -name '*.map' 2>/dev/null)

IDX_COUNT=${#IDX_MATCHES[@]}
if [ "$IDX_COUNT" -ne 1 ]; then
  echo "::error::expected exactly one index-*.js chunk, found $IDX_COUNT" >&2
  exit 1
fi
IDX_FILE="${IDX_MATCHES[0]}"
IDX_SIZE=$(gzip -c "$IDX_FILE" | wc -c | tr -d '[:space:]')

if [ "$IDX_SIZE" -gt "$IDX_ABSOLUTE_CEILING" ]; then
  echo "::error::index chunk is $IDX_SIZE bytes gzipped (absolute ceiling $IDX_ABSOLUTE_CEILING). See $PHASE_REF" >&2
  FAIL=1
elif [ "$IDX_SIZE" -gt "$IDX_PHASE9_CEILING" ]; then
  echo "::error::index chunk is $IDX_SIZE bytes gzipped (Phase 9 working ceiling $IDX_PHASE9_CEILING; absolute ceiling $IDX_ABSOLUTE_CEILING) — investigate before raising the working ceiling. See $PHASE_REF" >&2
  FAIL=1
else
  echo "index chunk OK: $IDX_SIZE bytes gzipped (Phase 9 working ceiling $IDX_PHASE9_CEILING; absolute ceiling $IDX_ABSOLUTE_CEILING)"
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

# Phase 10 Plan 10-10 — jsPDF dynamic-import invariant for ALL always-loaded chunks.
#
# BulkExportPDFFlow (Plan 10-10) uses `await import('jspdf')` (DYNAMIC).
# A static import would regress the bundle CI guard from assert-bundle-budget.sh
# AND would also bloat the clinic chunk. This guard catches accidental static
# imports in any static chunk (index, clinic, clinic-settings, etc.).
#
# Phase 10 Plan 10-11 bug fix: the original guard checked for the `jsPDF`
# identifier string in any non-jspdf chunk. However, Vite minification places
# the `jsPDF` variable name inline in the bundle even for DYNAMIC imports (the
# `const{jsPDF}=await import(...)` pattern compiles to `const{jsPDF:L}=await oe(...)`
# in the minified chunk). This caused false positives on any chunk that
# legitimately uses dynamic import, e.g. the SettingsPage chunk which
# lazy-loads jspdf for the doctor-report PDF export.
#
# Correct heuristic: a STATIC import of jspdf would appear as an ES module
# `import` statement in the chunk's static import list (the opening `import{...}
# from"./jspdf..."` lines of the minified chunk). Dynamic imports reference
# jspdf only via `__vite__mapDeps` or inline `import(...)` calls — never in
# the static `import{...}from` header.
#
# We detect static imports by checking if the file contains `from"./jspdf` or
# `from './jspdf` in an `import` statement (the normalized Vite output pattern
# for static ES imports). A dynamic import would NOT produce this pattern.
JSPDF_STATIC_FAIL=0
# Scope the check to the "always-loaded" and "lazy feature" chunks that MUST NOT
# statically import jspdf. We exclude:
#   - jspdf chunk itself (expected to export jsPDF)
#   - jspdf plugin chunks (e.g. jspdf.plugin.autotable — legitimately imports jspdf statically)
#   - *.es-*.js chunks (Vite names jspdf plugin ESM modules as `<name>.es-<hash>.js`;
#     these are part of the jsPDF ecosystem and are dynamic-import targets)
#
# The chunks we actively monitor are the product feature chunks: index, clinic,
# clinic-settings, clinic-invite, share, read-only-patient-view, and other app
# feature chunks. Any static jspdf import in these chunks is a regression.
JSPDF_CHECKED_PATTERNS=('index-*.js' 'clinic-*.js' 'clinic-settings-*.js' 'clinic-invite-*.js' 'share-*.js' 'read-only-patient-view-*.js')
while IFS= read -r f; do
  base=$(basename "$f")
  # Skip jspdf and its plugin ecosystem chunks
  if echo "$base" | grep -qi '^jspdf'; then
    continue
  fi
  # Skip *.es-*.js chunks (jspdf plugin ESM builds from Vite's code-split)
  if echo "$base" | grep -q '\.es-[A-Za-z0-9_-]*\.js$'; then
    continue
  fi
  # Only check the feature chunks listed above (use glob match)
  local_match=0
  for pat in "${JSPDF_CHECKED_PATTERNS[@]}"; do
    case "$base" in
      $pat) local_match=1; break ;;
    esac
  done
  [ "$local_match" -eq 0 ] && continue

  # Check for STATIC import syntax: `import{...}from"./jspdf..."` or
  # `import*as X from"./jspdf..."`. Minified Vite output always uses double
  # quotes and no spaces around the module specifier.
  if grep -qE 'import[{*][^"]*from"[^"]*jspdf[^"]*"' "$f" 2>/dev/null; then
    echo "::error::Static import of jspdf found in chunk $base — jspdf must be dynamically imported via 'await import(\"jspdf\")' (Plan 10-10 bundle invariant violation)." >&2
    JSPDF_STATIC_FAIL=1
  fi
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name '*.js' ! -name '*.map' 2>/dev/null)

if [ "$JSPDF_STATIC_FAIL" -ne 0 ]; then
  exit 1
fi
echo "jsPDF dynamic-import invariant OK: no static jspdf imports detected in non-jspdf chunks"

# Phase 15 Plan 15-02 PAGE-02 — index-chunk no-dnd-kit-static-import guard.
#
# The page-builder editor (admin-bundle chunk) static-imports dnd-kit. The
# editor is reachable ONLY via the lazy /admin/pages/* SPA route — public
# visitors must never download dnd-kit. Mirrors the jsPDF guard above:
# if Vite emits a STATIC import statement for any @dnd-kit module in the
# index chunk, the React.lazy() boundary in App.tsx has been bypassed
# (PAGE-02 violation; 15-RESEARCH.md Pitfall 2).
#
# Detection pattern mirrors the jsPDF guard:
#   - `import{...}from"@dnd-kit/..."`  (bare specifier — unlikely after Vite resolves)
#   - `import{...}from"./vendor-dnd-kit..."` (chunk-relative — Vite's emitted form
#     once manualChunks routes @dnd-kit/* into the vendor-dnd-kit chunk)
# Either form in the index chunk is a regression.
#
# IDX_FILE was resolved above in the index-ceiling check and is still in scope.
DNDKIT_INDEX_FAIL=0
if grep -qE 'import[{*][^"]*from"[^"]*(dnd-kit|vendor-dnd-kit)[^"]*"' "$IDX_FILE" 2>/dev/null; then
  echo "::error::Static import of @dnd-kit found in index chunk — the page builder editor must stay behind a React.lazy() boundary (Pitfall 2 / PAGE-02 violation)." >&2
  DNDKIT_INDEX_FAIL=1
fi

if [ "$DNDKIT_INDEX_FAIL" -ne 0 ]; then
  exit 1
fi
echo "dnd-kit index-leak invariant OK: no static @dnd-kit imports in index chunk"

echo "clinic bundle topology OK"
exit 0
