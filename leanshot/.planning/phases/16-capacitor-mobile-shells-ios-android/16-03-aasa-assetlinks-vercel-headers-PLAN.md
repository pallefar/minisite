---
phase: 16-capacitor-mobile-shells-ios-android
plan: 03
type: execute
wave: 1
depends_on: ["16-00"]
files_modified:
  - leanshot/public/.well-known/apple-app-site-association
  - leanshot/public/.well-known/assetlinks.json
  - leanshot/vercel.json
  - .github/workflows/ci.yml
autonomous: true
requirements: ["MOBILE-06"]
tags: ["mobile", "deep-links", "universal-links", "app-links", "vercel", "ci"]

must_haves:
  truths:
    - "An iOS device fetching https://leanshot.app/.well-known/apple-app-site-association receives a JSON body with Content-Type: application/json"
    - "An iOS device fetching https://app.leanshot.app/.well-known/apple-app-site-association receives the same JSON body with Content-Type: application/json"
    - "An Android device fetching https://leanshot.app/.well-known/assetlinks.json receives a JSON body with Content-Type: application/json"
    - "An Android device fetching https://app.leanshot.app/.well-known/assetlinks.json receives the same JSON body with Content-Type: application/json"
    - "AASA paths cover all 4 D-11 deep-link categories: auth (/signin, /signup, /reset-password, /verify-email), share (/share/*, /r/*), clinic (/clinic/*, /clinic-invite/*), marketing (/, /pricing, /faq)"
    - "Apple AASA file is served WITHOUT a .json extension (Apple fetches it bare)"
    - "Content-Type overrides are PER-SOURCE entries in vercel.json (not appended under the existing /(.*)  wildcard block) — Vercel matches most-specific source first"
    - "CI fails when either AASA or assetlinks.json does not return application/json on production"
  artifacts:
    - path: "leanshot/public/.well-known/apple-app-site-association"
      provides: "Apple Universal Links manifest"
      contains: "applinks"
      contains_paths: "/signin /signup /reset-password /verify-email /share/* /r/* /clinic/* /clinic-invite/* / /pricing /faq"
      no_extension: true
    - path: "leanshot/public/.well-known/assetlinks.json"
      provides: "Android App Links statement list"
      contains: "delegate_permission/common.handle_all_urls"
      contains_package: "app.leanshot.android"
    - path: "leanshot/vercel.json"
      provides: "Two new per-source Content-Type headers (AASA + assetlinks)"
      contains: "/.well-known/apple-app-site-association"
    - path: ".github/workflows/ci.yml"
      provides: "aasa-reachability job that curl-checks both files on prod"
      contains: "aasa-reachability"
  key_links:
    - from: "leanshot/public/.well-known/apple-app-site-association"
      to: "leanshot/vercel.json (source: /.well-known/apple-app-site-association)"
      via: "Vercel static serve + per-source Content-Type header override"
      pattern: "Content-Type.*application/json"
    - from: ".github/workflows/ci.yml aasa-reachability job"
      to: "https://leanshot.app + https://app.leanshot.app /.well-known/*"
      via: "curl -fsSL -I asserting Content-Type: application/json"
      pattern: "content-type:.*application/json"
---

<objective>
Publish the Apple Universal Links manifest (`apple-app-site-association`, NO `.json` extension) and the Android App Links statement list (`assetlinks.json`) under `public/.well-known/` so that BOTH `leanshot.app` AND `app.leanshot.app` (D-09 max-coverage) serve them with `Content-Type: application/json`. Append TWO per-source header rules to `leanshot/vercel.json` (NOT under the existing `/(.*)` wildcard — see RESEARCH gotcha #4 / Pattern 7). Add a CI job in `.github/workflows/ci.yml` that curls both files on both hosts in production and fails the build if Content-Type is not `application/json` or HTTP status is not 200.

This plan ships the **server-side half** of MOBILE-06. The **client-side half** (Capacitor `App.addListener('appUrlOpen', ...)` dispatcher) is owned by Plan 16-02.

**Purpose:** Without this plan, iOS Associated Domains validation fails at install time (silent — app just doesn't intercept https links) and Android App Links default to disambiguation chooser instead of opening the app directly. Both fall back to opening the browser, breaking the "tap email link → app opens" UX that 16-02 implements client-side.

**Output:**
- `leanshot/public/.well-known/apple-app-site-association` (new, no extension)
- `leanshot/public/.well-known/assetlinks.json` (new)
- `leanshot/vercel.json` (modified: +2 header entries)
- `.github/workflows/ci.yml` (modified: +1 aasa-reachability job)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@leanshot/vercel.json
@.github/workflows/ci.yml

<interfaces>
<!-- Existing vercel.json shape (lines 1-23). The new headers MUST be APPENDED as
     additional objects in the existing `headers` array — NOT nested inside the
     existing wildcard object. Each new source gets its own array element. -->

leanshot/vercel.json (current):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "rewrites": [...],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "..." },
        { "key": "Strict-Transport-Security", "value": "..." },
        ...
      ]
    }
    // ← APPEND new entries here as sibling objects in the array
  ]
}
```

<!-- AASA shape (Apple's required schema). TEAMID is the Apple Developer Team ID;
     it is NOT yet known at plan-write time — 16-00 captures it from the user's
     Apple Developer account. The executor MUST treat the literal string
     `TEAMID` as a PLACEHOLDER that will be filled by 16-01 (xcode project gen)
     OR by Plan 16-09 fastlane match. See `<unknowns>` block below. -->

leanshot/public/.well-known/apple-app-site-association (NEW, no extension):
```json
{
  "applinks": {
    "details": [
      {
        "appID": "TEAMID.app.leanshot.ios",
        "paths": [
          "/signin", "/signup", "/reset-password", "/verify-email",
          "/share/*", "/r/*",
          "/clinic/*", "/clinic-invite/*",
          "/", "/pricing", "/faq"
        ]
      }
    ]
  },
  "webcredentials": { "apps": ["TEAMID.app.leanshot.ios"] }
}
```

<!-- assetlinks.json shape (Google's required schema). The sha256_cert_fingerprints
     array MUST include BOTH the upload-cert fingerprint AND the Play-Store-issued
     signing-key fingerprint (see Pitfall 6 in RESEARCH). Both are unknown at
     plan-write time — 16-00 + 16-09 will populate. Placeholder strings used. -->

leanshot/public/.well-known/assetlinks.json (NEW):
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.leanshot.android",
      "sha256_cert_fingerprints": [
        "UPLOAD_CERT_FINGERPRINT_PLACEHOLDER",
        "PLAY_STORE_SIGNING_FINGERPRINT_PLACEHOLDER"
      ]
    }
  }
]
```

<!-- Existing ci.yml pattern (lines 254-281 — compliance-copy job is a good shape
     analog: ubuntu-latest, single curl-or-grep step, hard exit on failure). The
     new job should be a sibling under `jobs:` and follow the existing
     `defaults.run.working-directory: leanshot` (or override per-step to repo
     root if curling external URLs — curl doesn't need a working directory). -->
</interfaces>

<unknowns>
Two values are NOT known at plan-write time but MUST be filled before iOS/Android verification works in production:

1. **`TEAMID` in apple-app-site-association** — Apple Developer Team ID (10-character alphanumeric). Captured by Plan 16-00 vendor checkpoint (Apple Dev account) and filled at Plan 16-01 (xcode scaffold) or 16-09 (fastlane match). For Plan 16-03 the literal placeholder `TEAMID` is acceptable; the AASA file structure ships now, the value is substituted later when the Apple Dev account is live. **Do NOT block Plan 16-03 on this** — the CI curl-check only validates Content-Type + status, not the AASA content itself.

2. **`UPLOAD_CERT_FINGERPRINT_PLACEHOLDER` and `PLAY_STORE_SIGNING_FINGERPRINT_PLACEHOLDER` in assetlinks.json** — Same rationale: upload-cert is generated by 16-09 fastlane match (Android keystore); Play-Store signing fingerprint is captured AFTER first Play Console upload (Play Console → Setup → App integrity → App signing key). Plan 16-03 ships the file shape; Plan 16-09 substitutes the real values.

The executor MUST add a `<!-- TODO(16-09): replace TEAMID -->` comment-equivalent (JSON doesn't support comments — use a sibling key like `"_replace_at_phase_16_09_step": "TEAMID is a placeholder"` in a comment block ABOVE the file in the executor's commit message, NOT inside the JSON). Apple/Google parsers reject extraneous keys, so the JSON must be schema-valid.
</unknowns>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Publish AASA + assetlinks.json under public/.well-known/ and append two Vercel header rules</name>
  <files>
    leanshot/public/.well-known/apple-app-site-association
    leanshot/public/.well-known/assetlinks.json
    leanshot/vercel.json
  </files>
  <read_first>
    - leanshot/vercel.json (lines 1-23, full file) — to understand the existing `headers` array shape and confirm there is NO existing `.well-known` rule to clobber.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md lines 503-540 (Pattern 7) — for the AASA + vercel.json exact shape.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md lines 542-560 (Pattern 8) — for the assetlinks.json schema + dual-fingerprint requirement.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md D-09 (line 38) + D-11 (line 40) — confirms BOTH hosts must serve, and the 4 deep-link categories.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 449-485 — for the exact JSON to append to vercel.json (the Pattern Map already gives the verbatim block).
  </read_first>
  <action>
    Create three files / modifications per D-09 (BOTH hosts — see <verify> for the dual-host curl).

    **1. Create `leanshot/public/.well-known/apple-app-site-association`** (NO `.json` extension — Apple gotcha #3 in PATTERNS.md and Pattern 7 in RESEARCH).

    Content (exact shape from RESEARCH Pattern 7, with D-11 4-category path coverage):
    - JSON object with two top-level keys: `applinks` and `webcredentials`.
    - `applinks.details` array with ONE object: `appID = "TEAMID.app.leanshot.ios"` (placeholder per <unknowns>); `paths` array containing EXACTLY these 11 strings in this order (auth, share, clinic, marketing — D-11 categories):
      - `/signin`, `/signup`, `/reset-password`, `/verify-email` (auth, D-11 category 1)
      - `/share/*`, `/r/*` (share, D-11 category 2 — `/r/*` is the short-link variant from Phase 8)
      - `/clinic/*`, `/clinic-invite/*` (clinic, D-11 category 3)
      - `/`, `/pricing`, `/faq` (marketing, D-11 category 4 — intentional per D-11 line 40)
    - `webcredentials.apps` = `["TEAMID.app.leanshot.ios"]` (enables ASWebAuthenticationSession-style password autofill across Safari ↔ app).

    Use `Write` (not Edit) since file is new. **DO NOT add a `.json` extension — confirm the saved path is exactly `leanshot/public/.well-known/apple-app-site-association` with no extension.** Vite + Vercel both serve `public/` files as-is by exact path.

    **2. Create `leanshot/public/.well-known/assetlinks.json`** (WITH `.json` extension — Google's spec).

    Content (exact shape from RESEARCH Pattern 8):
    - Top-level JSON ARRAY (not object) — Google's spec requires array even for single statement.
    - One statement object with:
      - `relation: ["delegate_permission/common.handle_all_urls"]`
      - `target.namespace: "android_app"`
      - `target.package_name: "app.leanshot.android"` (D-10 bundle ID)
      - `target.sha256_cert_fingerprints`: an array with TWO placeholder strings: `"UPLOAD_CERT_FINGERPRINT_PLACEHOLDER"` and `"PLAY_STORE_SIGNING_FINGERPRINT_PLACEHOLDER"` (per <unknowns>; substituted in 16-09 / first Play upload).

    **3. Modify `leanshot/vercel.json`** — APPEND two NEW header entries to the `headers` array.

    **CRITICAL VERCEL GOTCHA (RESEARCH Pattern 7 + PATTERNS gotcha #4):** Vercel matches the most specific `source` first. The existing `/(.*)` wildcard block sets CSP/HSTS/etc. for everything. The new AASA + assetlinks `source` entries are MORE SPECIFIC, so they win for those two URLs. BUT — the existing `/(.*)` block only SETS the keys it lists (it does NOT set `Content-Type`); Vercel's default Content-Type for `public/.well-known/apple-app-site-association` would be `application/octet-stream` (no extension) or `text/plain`. The two new entries explicitly override to `application/json`. **Do NOT add a `Content-Type` key to the existing `/(.*)` block** — that would force application/json on every URL, breaking HTML/JS responses.

    Append (as sibling objects in the existing `headers` array, AFTER the existing `/(.*)` block):
    ```json
    {
      "source": "/.well-known/apple-app-site-association",
      "headers": [
        { "key": "Content-Type", "value": "application/json" }
      ]
    },
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [
        { "key": "Content-Type", "value": "application/json" }
      ]
    }
    ```

    Use Edit on vercel.json — locate the closing `]` of the `headers` array (around line 22), insert the two new objects BEFORE that closing bracket, separated by commas. Verify the resulting file is valid JSON (no trailing comma after the second new entry, comma after the existing wildcard block).

    **D-09 dual-host coverage:** Both `leanshot.app` and `app.leanshot.app` are deployed from the same Vercel project (Phase 12 D-09 confirmed; PROJECT.md says single-repo). Therefore a SINGLE set of files in `public/.well-known/` + a SINGLE pair of vercel.json header rules covers BOTH hosts automatically — Vercel applies project headers to all configured domains. Do NOT create per-host duplicate files. The CI step (Task 2) curls BOTH hosts explicitly to prove this.

    No rewrite rule is needed — Vercel serves static `public/` paths verbatim before falling through to the existing SPA rewrite rules. Confirm by inspecting the existing `rewrites` array (lines 4-9): the SPA fallback `/((?!clinic|...|assets/|sitemap\\.xml|robots\\.txt).+)` does NOT include `.well-known`, but Vercel's static-file precedence happens before rewrites anyway. Leave rewrites untouched.
  </action>
  <verify>
    <automated>
      # 1. AASA file exists with no extension and is valid JSON.
      test -f leanshot/public/.well-known/apple-app-site-association
      test ! -e leanshot/public/.well-known/apple-app-site-association.json
      node -e "JSON.parse(require('fs').readFileSync('leanshot/public/.well-known/apple-app-site-association','utf8'))"

      # 2. assetlinks.json exists and is valid JSON.
      test -f leanshot/public/.well-known/assetlinks.json
      node -e "JSON.parse(require('fs').readFileSync('leanshot/public/.well-known/assetlinks.json','utf8'))"

      # 3. AASA has all 4 D-11 deep-link categories in paths array.
      node -e "const a=JSON.parse(require('fs').readFileSync('leanshot/public/.well-known/apple-app-site-association','utf8'));const p=a.applinks.details[0].paths;const required=['/signin','/signup','/reset-password','/verify-email','/share/*','/r/*','/clinic/*','/clinic-invite/*','/','/pricing','/faq'];const missing=required.filter(x=>!p.includes(x));if(missing.length){console.error('MISSING AASA paths:',missing);process.exit(1)}console.log('AASA paths OK')"

      # 4. assetlinks.json has the correct package_name and dual-fingerprint placeholders.
      node -e "const a=JSON.parse(require('fs').readFileSync('leanshot/public/.well-known/assetlinks.json','utf8'));if(!Array.isArray(a))process.exit(1);if(a[0].target.package_name!=='app.leanshot.android')process.exit(1);if(a[0].target.sha256_cert_fingerprints.length!==2)process.exit(1);console.log('assetlinks OK')"

      # 5. vercel.json is valid JSON and contains two NEW per-source rules (not folded into wildcard).
      node -e "const v=JSON.parse(require('fs').readFileSync('leanshot/vercel.json','utf8'));const sources=v.headers.map(h=>h.source);const aasa=sources.includes('/.well-known/apple-app-site-association');const al=sources.includes('/.well-known/assetlinks.json');if(!aasa||!al){console.error('Missing per-source header rules');process.exit(1)}const wildcard=v.headers.find(h=>h.source==='/(.*)' );if(wildcard.headers.some(k=>k.key==='Content-Type')){console.error('FORBIDDEN: Content-Type added to wildcard');process.exit(1)}console.log('vercel.json OK')"
    </automated>
  </verify>
  <done>
    - `leanshot/public/.well-known/apple-app-site-association` exists, has no extension, parses as JSON, contains all 11 D-11 paths.
    - `leanshot/public/.well-known/assetlinks.json` exists, parses as JSON array, package_name is `app.leanshot.android`, has 2 placeholder fingerprints.
    - `leanshot/vercel.json` contains two new per-source header rules (AASA + assetlinks) appended to the `headers` array, NOT merged into the existing `/(.*)` wildcard. File parses as valid JSON.
    - All five `node -e` checks in `<verify>` exit 0.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add aasa-reachability CI job to .github/workflows/ci.yml asserting application/json from prod on BOTH hosts</name>
  <files>
    .github/workflows/ci.yml
  </files>
  <read_first>
    - .github/workflows/ci.yml lines 254-281 (compliance-copy job) — shape analog for a simple grep/curl-based ubuntu-latest job that hard-exits on failure.
    - .github/workflows/ci.yml lines 1-30 (top-level: name, on, concurrency, defaults.run.working-directory, jobs:) — to understand where to insert the new job.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 487-535 (mobile.yml analog) — but note that this plan ADDS to ci.yml, not mobile.yml (which is owned by Plan 16-09).
  </read_first>
  <action>
    Append a new top-level job `aasa-reachability` to `.github/workflows/ci.yml`. **Do NOT create `.github/workflows/mobile.yml` — that file is owned by Plan 16-09.** The job lives in ci.yml because (a) the artifacts ship from any branch's Vercel preview / production deploy, (b) keeping it in ci.yml means PRs that break header config fail before merge.

    **Insertion point:** Add as a sibling job under `jobs:`. Locate the LAST existing job in ci.yml (use `grep -n "^  [a-z_-]*:$" .github/workflows/ci.yml | tail -1` to find it; the file has ~509 lines — the new job goes at the END of `jobs:`, before EOF if there is no trailing content). Order doesn't matter (GitHub Actions runs jobs in parallel by default unless `needs:` is set).

    **Job spec:**
    ```yaml
      aasa-reachability:
        name: AASA + assetlinks Content-Type smoke (Phase 16 MOBILE-06)
        runs-on: ubuntu-latest
        # Only run on push to main (post-deploy) OR on PRs that touch the well-known dir
        # or vercel.json. PRs that don't touch these files skip — saves CI minutes and
        # avoids false-reds when Vercel preview URLs are stale.
        if: |
          github.event_name == 'push' ||
          (github.event_name == 'pull_request' && (
            contains(github.event.pull_request.changed_files, 'public/.well-known/') ||
            contains(github.event.pull_request.changed_files, 'vercel.json')
          ))
        steps:
          - uses: actions/checkout@v4

          - name: Curl AASA on leanshot.app
            run: |
              set -euo pipefail
              echo "Fetching https://leanshot.app/.well-known/apple-app-site-association"
              # -f: fail on HTTP 4xx/5xx; -sS: silent but show errors; -L: follow redirects (Apple's spec says NO redirects, but the curl-level redirect-follow lets us catch unintended 301s and report them as errors below)
              RESP_HEADERS=$(curl -fsSL -D - -o /tmp/aasa-leanshot.json https://leanshot.app/.well-known/apple-app-site-association)
              echo "$RESP_HEADERS"
              # Apple spec: NO redirects. If the response chain had any 3xx, fail.
              REDIRECTS=$(curl -fsSL -o /dev/null -w '%{num_redirects}' https://leanshot.app/.well-known/apple-app-site-association)
              if [ "$REDIRECTS" != "0" ]; then
                echo "::error::AASA on leanshot.app had $REDIRECTS redirect(s); Apple requires no redirects"
                exit 1
              fi
              # Assert Content-Type: application/json (case-insensitive header name).
              CT=$(echo "$RESP_HEADERS" | grep -i '^content-type:' | tail -1 | tr -d '\r')
              echo "Detected: $CT"
              if ! echo "$CT" | grep -qi 'application/json'; then
                echo "::error::AASA on leanshot.app has wrong Content-Type: $CT (expected application/json)"
                exit 1
              fi
              # Sanity-parse the body as JSON.
              node -e "JSON.parse(require('fs').readFileSync('/tmp/aasa-leanshot.json','utf8'))"

          - name: Curl AASA on app.leanshot.app
            run: |
              set -euo pipefail
              echo "Fetching https://app.leanshot.app/.well-known/apple-app-site-association"
              RESP_HEADERS=$(curl -fsSL -D - -o /tmp/aasa-app.json https://app.leanshot.app/.well-known/apple-app-site-association)
              echo "$RESP_HEADERS"
              REDIRECTS=$(curl -fsSL -o /dev/null -w '%{num_redirects}' https://app.leanshot.app/.well-known/apple-app-site-association)
              if [ "$REDIRECTS" != "0" ]; then
                echo "::error::AASA on app.leanshot.app had $REDIRECTS redirect(s); Apple requires no redirects"
                exit 1
              fi
              CT=$(echo "$RESP_HEADERS" | grep -i '^content-type:' | tail -1 | tr -d '\r')
              echo "Detected: $CT"
              if ! echo "$CT" | grep -qi 'application/json'; then
                echo "::error::AASA on app.leanshot.app has wrong Content-Type: $CT (expected application/json)"
                exit 1
              fi
              node -e "JSON.parse(require('fs').readFileSync('/tmp/aasa-app.json','utf8'))"

          - name: Curl assetlinks.json on leanshot.app
            run: |
              set -euo pipefail
              echo "Fetching https://leanshot.app/.well-known/assetlinks.json"
              RESP_HEADERS=$(curl -fsSL -D - -o /tmp/assetlinks-leanshot.json https://leanshot.app/.well-known/assetlinks.json)
              echo "$RESP_HEADERS"
              CT=$(echo "$RESP_HEADERS" | grep -i '^content-type:' | tail -1 | tr -d '\r')
              if ! echo "$CT" | grep -qi 'application/json'; then
                echo "::error::assetlinks.json on leanshot.app wrong Content-Type: $CT"
                exit 1
              fi
              node -e "const a=JSON.parse(require('fs').readFileSync('/tmp/assetlinks-leanshot.json','utf8'));if(!Array.isArray(a))process.exit(1)"

          - name: Curl assetlinks.json on app.leanshot.app
            run: |
              set -euo pipefail
              echo "Fetching https://app.leanshot.app/.well-known/assetlinks.json"
              RESP_HEADERS=$(curl -fsSL -D - -o /tmp/assetlinks-app.json https://app.leanshot.app/.well-known/assetlinks.json)
              echo "$RESP_HEADERS"
              CT=$(echo "$RESP_HEADERS" | grep -i '^content-type:' | tail -1 | tr -d '\r')
              if ! echo "$CT" | grep -qi 'application/json'; then
                echo "::error::assetlinks.json on app.leanshot.app wrong Content-Type: $CT"
                exit 1
              fi
              node -e "const a=JSON.parse(require('fs').readFileSync('/tmp/assetlinks-app.json','utf8'));if(!Array.isArray(a))process.exit(1)"
    ```

    **Indentation:** The root `defaults.run.working-directory: leanshot` in ci.yml (around line 14-16) applies to all jobs. Curl commands operate on absolute URLs and `/tmp/` paths, so `cwd` is irrelevant. Do NOT add a per-job `defaults` override.

    **DNS dependency (D-09 + RESEARCH line 637):** Both `leanshot.app` and `app.leanshot.app` must be live before this job can pass. Per CONTEXT D-09 + vendor-checkpoint #3, Plan 16-00 confirms DNS is live. If DNS is NOT live when Plan 16-03 lands on main, the curl will fail with `Could not resolve host: leanshot.app` and CI goes red — this is the CORRECT failure mode (the carry-over Phase 12 vendor item must be resolved before iOS submission anyway). **Do NOT silently skip on DNS failure** — the whole point of this CI gate is to surface DNS regressions.

    **Why `application/json` casing matters:** Apple's AASA validator on real devices is strict. `application/octet-stream`, `text/plain`, or `text/json` all cause silent install-time validation failure (no error surfaced to the user). The `grep -qi` is case-insensitive on the value, which is correct (HTTP header values are case-sensitive per RFC but most servers use lowercase; -i hedges).
  </action>
  <verify>
    <automated>
      # 1. ci.yml is still valid YAML.
      python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"

      # 2. The new job is present and named correctly.
      grep -q '^  aasa-reachability:$' .github/workflows/ci.yml

      # 3. Job has the expected name field.
      grep -q 'name: AASA + assetlinks Content-Type smoke' .github/workflows/ci.yml

      # 4. Both hosts are curl-targeted (4 curl invocations: AASA leanshot.app, AASA app.leanshot.app, assetlinks leanshot.app, assetlinks app.leanshot.app).
      test "$(grep -c 'https://leanshot.app/.well-known/' .github/workflows/ci.yml)" -ge 2
      test "$(grep -c 'https://app.leanshot.app/.well-known/' .github/workflows/ci.yml)" -ge 2

      # 5. The job is gated on push/PR (not always — saves CI minutes on unrelated PRs).
      grep -A 5 '^  aasa-reachability:$' .github/workflows/ci.yml | grep -q "if:"

      # 6. The Content-Type assertion is present (and is application/json — the whole point).
      grep -A 200 '^  aasa-reachability:$' .github/workflows/ci.yml | grep -q 'application/json'

      # 7. Verify NO new mobile.yml file was created (that belongs to 16-09).
      test ! -f .github/workflows/mobile.yml
    </automated>
  </verify>
  <done>
    - `.github/workflows/ci.yml` contains a new `aasa-reachability` job that curls both `leanshot.app` and `app.leanshot.app` for both `apple-app-site-association` (no extension) and `assetlinks.json`, asserting HTTP 200 + `Content-Type: application/json` + zero redirects (AASA only — Apple spec) + JSON-parseable body on each.
    - The job uses the `if:` gate so unrelated PRs don't pay the curl cost.
    - YAML still parses; no `.github/workflows/mobile.yml` was created.
    - All seven verification checks pass.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel CDN → iOS device | Apple's AASA validator fetches the file at install + periodically. Untrusted client (Apple's validator) is the consumer; we are the trusted publisher. |
| Vercel CDN → Android device | Google's App Links validator does the same. |
| Vercel CDN → CI runner | Public HTTPS GET; CI runner has no auth context. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-03-01 | Tampering | AASA file on Vercel CDN | mitigate | HTTPS-only (HSTS already in `/(.*)` block), Vercel deploy logs auditable, AASA changes require PR review |
| T-16-03-02 | Information Disclosure | AASA file contents (TEAMID, bundle ID, paths) | accept | All values are public by design — Apple/Google validators are anonymous clients. No PII; the file is intended for any client to fetch. |
| T-16-03-03 | Spoofing | Universal Link target spoofing | accept | iOS handles AASA signature validation automatically when Associated Domains entitlement is set; we cannot reinvent this (RESEARCH line 605) |
| T-16-03-04 | Denial of Service | CI curl hitting prod 4× per push | accept | 4 GET requests/push is trivial vs. Vercel's quota; rate-limit not needed |
| T-16-03-05 | Repudiation | AASA tampering between deploys | mitigate | CI curl-gate fails the build if Content-Type drifts → forces re-deploy or rollback |
| T-16-03-06 | Elevation of Privilege | Misconfigured Vercel header forces application/json on HTML routes | mitigate | Task 1 verify-step explicitly asserts no Content-Type key was added to the `/(.*)` wildcard block |
</threat_model>

<verification>
**Phase-level acceptance for Plan 16-03:**

1. **Local file invariants (Task 1 done-criteria):**
   - `leanshot/public/.well-known/apple-app-site-association` exists, no extension, parses as JSON, has all 11 D-11 paths.
   - `leanshot/public/.well-known/assetlinks.json` exists, parses as JSON array, has D-10 bundle ID + 2 fingerprint placeholders.
   - `leanshot/vercel.json` has 2 NEW per-source header rules, NOT merged into the existing wildcard.

2. **CI gate (Task 2 done-criteria):**
   - `.github/workflows/ci.yml` has the new `aasa-reachability` job.
   - On post-merge push to main, the job hits all 4 endpoints and gets `Content-Type: application/json` + HTTP 200 + 0 redirects (AASA).
   - YAML parses.

3. **Cross-plan handoff:**
   - Plan 16-02 (deeplink.ts) will dispatch to the routes listed in AASA `paths`. The AASA paths file IS the canonical source of truth for what URLs the app intercepts. If 16-02 adds/removes a deep-link route, 16-03's AASA file is the contract that must be updated in sync.
   - Plan 16-01 (xcode scaffold) will substitute `TEAMID` with the real Apple Developer Team ID.
   - Plan 16-09 (fastlane) will substitute the two `*_FINGERPRINT_PLACEHOLDER` strings with real Android cert fingerprints.

4. **Future-phase note:** When Phase 17 (push) or Phase 18 (health) add new deep-link routes (e.g., `/health-prompt`), they MUST update `apple-app-site-association` paths — this file is the system of record.
</verification>

<success_criteria>
Plan 16-03 ships when:

- [ ] `leanshot/public/.well-known/apple-app-site-association` (no extension) exists with valid JSON containing all 4 D-11 deep-link categories (auth, share, clinic, marketing → 11 path entries total).
- [ ] `leanshot/public/.well-known/assetlinks.json` exists with valid JSON array, package `app.leanshot.android`, 2 fingerprint placeholders.
- [ ] `leanshot/vercel.json` has 2 new per-source `Content-Type: application/json` header rules appended to the `headers` array — NOT merged into the existing `/(.*)` wildcard (PATTERNS gotcha #4).
- [ ] `.github/workflows/ci.yml` has a new `aasa-reachability` job that curl-checks both files on both `leanshot.app` AND `app.leanshot.app` (D-09 max-coverage) and fails on wrong Content-Type, non-200, or any redirects (AASA).
- [ ] No `.github/workflows/mobile.yml` file is created (Plan 16-09 owns that).
- [ ] All verify-step automated checks pass.
- [ ] Files committed via `git commit -- <pathspec>` per `feedback_parallel_executor_git_isolation.md` (Wave 1 has 3 parallel plans; commit pathspec prevents cross-contamination).
</success_criteria>

<output>
After completion, create `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-03-SUMMARY.md` using `@$HOME/.claude/get-shit-done/templates/summary.md`. Include:

- Files created (4: AASA, assetlinks.json, vercel.json mod, ci.yml mod).
- Placeholders flagged for downstream substitution (`TEAMID` → 16-01; `*_FINGERPRINT_PLACEHOLDER` → 16-09).
- Cross-plan dependency on Plan 16-02's `PATHNAME_PREFIXES` list — the 4 deep-link categories in AASA `paths` MUST stay in sync with 16-02's dispatcher list. Recommend grep-gate in 16-02 SUMMARY (out of scope here; just note it).
- Pending real-world verification: requires Vercel deploy AND DNS for both `leanshot.app` + `app.leanshot.app` to be live. If DNS is still pending from Phase 12, the new CI job will be RED on first run after merge — that is the correct, intended signal.
</output>
