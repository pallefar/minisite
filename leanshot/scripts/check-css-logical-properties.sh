#!/usr/bin/env bash
# Phase 32 Plan 32-07 (I18N-10) — CSS logical-properties gate.
#
# Greps src/ for forbidden physical CSS properties and exits non-zero if any
# remain outside the whitelisted directories. Logical properties (margin-inline-*,
# padding-inline-*, text-align: start|end, etc.) are RTL-ready; physical
# properties (margin-left, padding-right, etc.) will need rewriting when v1.5
# ships RTL support, so v1.3 enforces "no new physical properties" via CI.
#
# Per reference_grep_gate_comment_strip.md — comments stripped before counting
# so a JSDoc comment like `// avoid margin-left` doesn't self-invalidate the gate.
#
# Exit codes:
#   0 — no physical properties found
#   1 — at least one violation; report printed
#
# Usage:
#   bash scripts/check-css-logical-properties.sh        # gate (CI)
#   bash scripts/check-css-logical-properties.sh -v     # verbose (every hit)

set -u

VERBOSE=0
if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
  VERBOSE=1
fi

SRC_DIR="${PWD}/src"
if [ ! -d "$SRC_DIR" ]; then
  echo "[check-css-logical-properties] error: src/ not found in $PWD" >&2
  exit 2
fi

# Each pattern below is grep -E (extended) compatible on both BSD and GNU grep.
# Patterns intentionally NOT permissive — they catch the common Tailwind utility
# shapes and a handful of inline-style / raw-CSS shapes.
PATTERNS=(
  # Tailwind utilities — include responsive prefixes (lg:, md:, etc.) via the
  # lookbehind-equivalent "[:[:space:]>\"']" boundary.
  'class(Name)?[^"]*"[^"]*\b(ml|mr|pl|pr)-(0|[0-9]+|px|auto|0\.5|1\.5|2\.5|3\.5)\b'
  'class(Name)?[^"]*"[^"]*\b(border-l|border-r)\b'
  'class(Name)?[^"]*"[^"]*\b(text-left|text-right)\b'

  # Inline style camelCase
  '(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight):'
  "textAlign:[[:space:]]*['\"](left|right)['\"]"

  # Raw CSS kebab-case
  '(margin|padding|border)-(left|right):'
  'text-align:[[:space:]]*(left|right)'
)

PATTERN_NAMES=(
  "Tailwind ml-/mr-/pl-/pr-"
  "Tailwind border-l/border-r"
  "Tailwind text-left/text-right"
  "inline-style marginLeft/Right/paddingLeft/Right/borderLeft/Right"
  "inline-style textAlign: left|right"
  "raw CSS margin-left/right etc."
  "raw CSS text-align: left|right"
)

# Whitelist exclusions (directories the gate ignores).
EXCLUDES=(
  --exclude-dir=illustrations
  --exclude-dir=__tests__
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=dist-marketing
  --exclude="*.test.ts"
  --exclude="*.test.tsx"
)

INCLUDE_GLOBS=(
  --include="*.ts"
  --include="*.tsx"
  --include="*.css"
)

# strip_comments — read stdin, drop lines that are pure CSS/JS comments.
strip_comments() {
  # Lines that start (after optional whitespace) with //, /*, or *. Conservative
  # — does NOT strip inline `code // comment` because Tailwind class strings
  # don't end in trailing comments in this codebase.
  grep -v -E '^[[:space:]]*(//|/\*|\*)'
}

TOTAL=0
PRINTED_HEADER=0

print_header() {
  if [ "$PRINTED_HEADER" -eq 0 ]; then
    printf "\n%-55s %6s %s\n" "PATTERN" "COUNT" "STATUS"
    printf -- "----------------------------------------------------------------------------\n"
    PRINTED_HEADER=1
  fi
}

i=0
while [ $i -lt ${#PATTERNS[@]} ]; do
  pat="${PATTERNS[$i]}"
  name="${PATTERN_NAMES[$i]}"
  # 2>/dev/null swallows "no matches" stderr.
  hits=$(grep -rnE "$pat" "$SRC_DIR" "${EXCLUDES[@]}" "${INCLUDE_GLOBS[@]}" 2>/dev/null | strip_comments)
  count=0
  if [ -n "$hits" ]; then
    count=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
  fi
  status="PASS"
  if [ "$count" -gt 0 ]; then
    status="FAIL"
    TOTAL=$((TOTAL + count))
  fi
  print_header
  printf "%-55s %6s %s\n" "$name" "$count" "$status"
  if [ "$count" -gt 0 ] && [ "$VERBOSE" -eq 1 ]; then
    printf '%s\n' "$hits" | head -50 | sed 's/^/    /'
    if [ "$count" -gt 50 ]; then
      printf "    ... and %d more\n" "$((count - 50))"
    fi
  fi
  i=$((i + 1))
done

echo ""
if [ "$TOTAL" -eq 0 ]; then
  echo "✓ check-css-logical-properties: 0 violations across $(find "$SRC_DIR" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) | wc -l | tr -d ' ') files"
  exit 0
else
  echo "✗ check-css-logical-properties: $TOTAL violations remain."
  echo "  Migrate per Plan 32-07 mapping table:"
  echo "    ml-N  → ms-N   |  margin-left   → margin-inline-start"
  echo "    mr-N  → me-N   |  margin-right  → margin-inline-end"
  echo "    pl-N  → ps-N   |  padding-left  → padding-inline-start"
  echo "    pr-N  → pe-N   |  padding-right → padding-inline-end"
  echo "    border-l → border-s    |  border-r → border-e"
  echo "    text-left → text-start |  text-right → text-end"
  echo "  Re-run with -v to see the offending lines."
  exit 1
fi
