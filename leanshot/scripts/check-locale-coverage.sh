#!/usr/bin/env bash
#
# check-locale-coverage.sh — Phase 32 Plan 32-01 (CONTEXT D-05 / D-06).
#
# 100% per-namespace coverage gate. For every public/locales/en/<ns>.json
# canonical namespace, asserts that public/locales/es/<ns>.json contains
# the SAME set of leaf key paths. Prints a per-namespace table and exits 0
# iff every namespace passes.
#
# Two-layer coverage discipline:
#   1. i18next-parser failOnUpdate: true  — catches new EN keys added in
#      source code that have not been written to the catalog.
#   2. this script                        — catches drift between EN and ES
#      catalogs (key in EN but missing in ES, or extra-in-ES leftovers).
#
# bash 3.2 compatible (macOS default). No associative arrays. Uses jq for
# leaf-path enumeration:
#   jq -r 'paths(scalars) | join(".")' file.json | sort -u
# enumerates dotted leaf paths (e.g. action.save, error.network) — pluralized
# variants like injection_one / injection_other appear as separate leaf paths
# and are diffed independently, which is the right behavior for the D-05 gate.
#
# Per [[reference_grep_gate_comment_strip]]: jq will reject malformed JSON
# (e.g. // comments) with a clear parse error; no grep-based comment strip
# is needed because we never grep the catalog contents.
#
# Usage:
#   bash scripts/check-locale-coverage.sh
#   (Run from leanshot/ directory.)
#
# CI wiring is owned by Plan 32-07.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EN_DIR="$ROOT/public/locales/en"
ES_DIR="$ROOT/public/locales/es"

if [ ! -d "$EN_DIR" ]; then
  echo "::error::EN locale directory not found at $EN_DIR" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required (brew install jq)" >&2
  exit 1
fi

# ── Table header ─────────────────────────────────────────────────────────────
printf "%-20s %8s %8s %14s %14s %8s\n" "NAMESPACE" "EN_KEYS" "ES_KEYS" "MISSING_IN_ES" "EXTRA_IN_ES" "STATUS"
printf "%-20s %8s %8s %14s %14s %8s\n" "---------" "-------" "-------" "-------------" "-----------" "------"

failed=0

# Iterate over EN namespaces (canonical source of truth)
for en_file in "$EN_DIR"/*.json; do
  [ -e "$en_file" ] || continue
  ns="$(basename "$en_file" .json)"
  es_file="$ES_DIR/$ns.json"

  # Enumerate EN leaf paths
  en_keys=$(jq -r 'paths(scalars) | join(".")' "$en_file" | sort -u)
  en_count=$(echo "$en_keys" | grep -c . || true)

  if [ ! -f "$es_file" ]; then
    # Whole namespace missing in ES — count every EN key as missing.
    printf "%-20s %8s %8s %14s %14s %8s\n" "$ns" "$en_count" "0" "$en_count" "0" "FAIL"
    echo "  ES namespace file missing: $es_file" >&2
    failed=$((failed + 1))
    continue
  fi

  es_keys=$(jq -r 'paths(scalars) | join(".")' "$es_file" | sort -u)
  es_count=$(echo "$es_keys" | grep -c . || true)

  missing_in_es=$(comm -23 <(echo "$en_keys") <(echo "$es_keys") | grep -c . || true)
  extra_in_es=$(comm -13 <(echo "$en_keys") <(echo "$es_keys") | grep -c . || true)

  if [ "$missing_in_es" -eq 0 ] && [ "$extra_in_es" -eq 0 ]; then
    status="PASS"
  else
    status="FAIL"
    failed=$((failed + 1))
    if [ "$missing_in_es" -gt 0 ]; then
      echo "  $ns: keys present in EN but missing in ES:" >&2
      comm -23 <(echo "$en_keys") <(echo "$es_keys") | sed 's/^/    - /' >&2
    fi
    if [ "$extra_in_es" -gt 0 ]; then
      echo "  $ns: keys present in ES but not in EN (stale):" >&2
      comm -13 <(echo "$en_keys") <(echo "$es_keys") | sed 's/^/    - /' >&2
    fi
  fi
  printf "%-20s %8s %8s %14s %14s %8s\n" "$ns" "$en_count" "$es_count" "$missing_in_es" "$extra_in_es" "$status"
done

echo ""
if [ "$failed" -gt 0 ]; then
  echo "::error::FAIL: $failed namespace(s) have EN/ES key-set drift (D-05 100% coverage gate)." >&2
  exit 1
fi
echo "OK: every namespace has identical EN/ES leaf-path coverage."
