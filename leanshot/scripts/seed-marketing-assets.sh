#!/usr/bin/env bash
#
# Phase 19 Plan 19-08 Task 4 — marketing-assets Storage bucket seed checker
# (D-13 / D-14).
#
# Pre-conditions:
#   - Plan 19-08 migration `20270101000009_affiliate_landing_template_seeds.sql`
#     has been applied (creates the bucket with admin-write / public-read RLS).
#   - Supabase CLI installed + linked to project `ytnsipxxmzgaebkqmokp`
#     (`supabase link --project-ref ytnsipxxmzgaebkqmokp`).
#
# What this script does:
#   1. Counts files in `marketing-assets/v1/`.
#   2. If >= 8, prints success.
#   3. If empty / under-seeded, prints the expected manifest + upload commands.
#
# What this script does NOT do:
#   - Upload assets. The upload step is a human-verify checkpoint because
#     the source art (logo SVG, banner PNGs, swipe-copy text) is
#     brand-controlled and lives outside the repo. Once the artwork lands
#     in `leanshot/.planning/design-system/marketing-assets/` (or a
#     similar curated location), the human operator runs the
#     `supabase storage upload ss:///marketing-assets/v1/<file> <local>`
#     commands listed in the FAIL branch below.
#
# Idempotent: re-runnable. Exits 0 on bucket-seeded; exits 1 on
# under-seeded (so CI / verifier scripts can gate on it).

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ytnsipxxmzgaebkqmokp}"
BUCKET="marketing-assets"
PREFIX="v1"
MIN_FILES=8

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not installed (https://supabase.com/docs/guides/cli)." >&2
  exit 2
fi

echo "Checking ${BUCKET}/${PREFIX}/ on project ${PROJECT_REF}..."

# `supabase storage ls` against a linked project. Count non-empty lines.
LIST_OUTPUT="$(supabase storage ls "ss:///${BUCKET}/${PREFIX}/" --linked 2>&1 || true)"

# Filter to file-shaped lines. The CLI prints object names one per line; we
# discard any error / banner lines starting with whitespace or "Error".
COUNT="$(printf '%s\n' "${LIST_OUTPUT}" | grep -Ev '^\s*$|^Error|^Linked' | wc -l | tr -d ' ')"

if [ "${COUNT}" -ge "${MIN_FILES}" ]; then
  echo "OK: ${BUCKET}/${PREFIX}/ contains ${COUNT} files (>= ${MIN_FILES})."
  exit 0
fi

cat <<EOF >&2
FAIL: ${BUCKET}/${PREFIX}/ contains ${COUNT} files; need >= ${MIN_FILES}.

Expected manifest per 19-UI-SPEC §D-14:
  logo.svg                  — LeanShot wordmark, vector
  logo-200.png              — 200x200 raster (transparent bg)
  logo-1200.png             — 1200x1200 raster (transparent bg)
  banner-728x90.png         — leaderboard banner
  banner-300x250.png        — medium-rectangle banner
  banner-1080x1080.png      — square (Instagram / TikTok)
  swipe-copy-email.txt      — short email template referencing LeanShot value props
  swipe-copy-social.txt     — short social-post template

Optional:
  explainer-video-link.txt  — YouTube / Vimeo URL placeholder

Upload via Supabase CLI (one call per file):
  supabase storage upload ss:///${BUCKET}/${PREFIX}/logo.svg ./path/to/logo.svg --linked
  supabase storage upload ss:///${BUCKET}/${PREFIX}/logo-200.png ./path/to/logo-200.png --linked
  ... (repeat for each file)

After uploading, re-run this script. It must print "OK: ... files (>= ${MIN_FILES})".
EOF
exit 1
