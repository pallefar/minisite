# Google Play Data Safety Form — LeanShot Android

> **Last updated:** 2026-05-16
> **Form version:** v1.2 (initial)
> **iOS PrivacyInfo source-of-truth:** [`apps/ios/App/App/PrivacyInfo.xcprivacy`](../ios/App/App/PrivacyInfo.xcprivacy)
> **Plan:** Phase 16 Plan 16-07 (MOBILE-05)
>
> This document is the operator-readable + Play-Console-copy-paste-ready spec
> for LeanShot's Google Play Data Safety form. Every row mirrors the iOS
> Privacy Manifest. **If you change iOS, change this file in the same PR.**
> The CI gate (`scripts/audit-privacy-manifest.mjs` +
> `.github/workflows/mobile-privacy-audit.yml`) enforces the iOS half on
> every PR touching the manifest or 14-plugin set; the Play half is enforced
> by the Source-of-truth cross-reference table in §6 below.

---

## 1. Data collection — yes/no

**Does your app collect or share any of the required user data types?** **YES.**

LeanShot is an account-based health-tracking app. We collect email + a generated user ID for account management, health/body metrics + progress photos for the core feature, purchase history through Google Play Billing (mediated by RevenueCat), and crash logs for app reliability. We do NOT collect: name, phone number, address, advertising identifiers, contacts, location, search history, calendar, messages, files outside our own sandbox.

---

## 2. Data types collected — full Play category table

| Category | Type | Collected? | Shared with third parties? | Required or optional? | Purpose(s) | Encrypted in transit? | User can request deletion? |
|---|---|---|---|---|---|---|---|
| Personal info | Email address | YES | No | Required | Account management, App functionality | YES (HTTPS to Supabase Auth) | YES (Settings → Delete account) |
| Personal info | User ID | YES | No | Required | Account management, App functionality | YES | YES |
| Personal info | Name | NO | — | — | — | — | — |
| Personal info | Address | NO | — | — | — | — | — |
| Personal info | Phone number | NO | — | — | — | — | — |
| Personal info | Race and ethnicity | NO | — | — | — | — | — |
| Personal info | Political or religious beliefs | NO | — | — | — | — | — |
| Personal info | Sexual orientation | NO | — | — | — | — | — |
| Personal info | Other personal info | NO | — | — | — | — | — |
| Financial info | Purchase history | YES (Google Play Billing via RevenueCat) | YES (RevenueCat — data processor) | Required for purchase | App functionality | YES | YES |
| Financial info | Credit/debit card info | NO (handled entirely by Google Play; we never see card data) | — | — | — | — | — |
| Financial info | Other financial info | NO | — | — | — | — | — |
| Health & fitness | Health info | YES (subset of HealthKit / Health-Connect — Phase 18 expands) | No | Optional | App functionality, Analytics | YES | YES |
| Health & fitness | Fitness info | YES (workouts, step counts when synced) | No | Optional | App functionality | YES | YES |
| Photos and videos | Photos | YES (progress photos) | No | Optional | App functionality | YES (HTTPS to Supabase Storage) | YES |
| Photos and videos | Videos | NO | — | — | — | — | — |
| Audio files | (any) | NO | — | — | — | — | — |
| Files and docs | (any) | NO (we don't read user-supplied files outside app sandbox) | — | — | — | — | — |
| Calendar | (any) | NO | — | — | — | — | — |
| Contacts | (any) | NO | — | — | — | — | — |
| App activity | App interactions | NO (no analytics SDK; Sentry breadcrumbs are crash-context only, scrubbed of PII per `beforeSend` hook) | — | — | — | — | — |
| App activity | In-app search history | NO | — | — | — | — | — |
| App activity | Installed apps | NO | — | — | — | — | — |
| App activity | Other user-generated content | YES (injection logs, mood logs, symptom notes) | No | Optional | App functionality | YES | YES |
| App activity | Other actions | NO | — | — | — | — | — |
| Web browsing | (any) | NO | — | — | — | — | — |
| App info and performance | Crash logs | YES | YES (Sentry — data processor) | Required | App functionality, Analytics | YES | YES (per-user crash records deleted on account deletion) |
| App info and performance | Diagnostics | NO | — | — | — | — | — |
| App info and performance | Other app performance data | NO | — | — | — | — | — |
| Device or other IDs | Device or other IDs | NO (Capacitor's installationId is generated locally; not sent to any server) | — | — | — | — | — |

> **Health info — "Data is not linked to your identity":** **YES.**
> Matches iOS `NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypeHealth` with
> `NSPrivacyCollectedDataTypeLinked=<false/>` per Phase 16 CONTEXT D-18. Health
> info is stored under an opaque per-device key derived from the user's account
> but not directly joinable to email/profile on the analytics side.

---

## 3. Data sharing — per third-party processor

| Processor | Data shared | Reason | Disclosed to user |
|---|---|---|---|
| **RevenueCat** | Purchase history, entitlement state, `appUserID` (pseudonymous) | Required by IAP architecture (subscription state must outlive a single device) | Privacy Policy §"Subscription management" |
| **Sentry** | Crash logs (PII scrubbed via `beforeSend` hook from Phase 7) | Required for crash diagnosis | Privacy Policy §"Crash reporting" |
| **Supabase** | Email, user ID, health info, photos, app-generated content | Backend-of-record for all other categories | Privacy Policy §"Where your data lives". Supabase DPA is in place. HIPAA BAA carry-over from Phase 7 is tracked separately and does NOT alter Play Data Safety disclosures. |

> **No data is shared with ad networks, brokers, or for cross-app tracking.**

---

## 4. Security practices

| Question (Play Console) | Answer | Notes |
|---|---|---|
| Data is encrypted in transit | YES | HTTPS everywhere; iOS App Transport Security ON per `Info.plist` (no exceptions, Phase 16 D-09). Android: `cleartextTrafficPermitted=false` in network security config. |
| You can request that data be deleted | YES | Settings → Delete account triggers full cascade per Phase 7 deletion flow (`reference_phase7_research_findings.md` + Phase 19 10-step cascade). |
| Committed to following Play Families Policy | NO | Not a kids app; gated 18+ in v1. |
| Independent security review | NO | Deferred to post-launch milestone. |

---

## 5. Data-collection purposes — Play taxonomy

For each "Optional/Required" purpose declared above, the Play form requires
mapping to Play's purpose taxonomy. The mapping used:

- **App functionality** → core product features (med-level curve, injection log, body data, AI coach, photos). All data we collect supports app functionality.
- **Account management** → email + user ID only.
- **Analytics** → Health info (aggregate trends in coach insights), Crash logs (frequency/source diagnosis). Both are pseudonymous on the analytics path.
- **Advertising or marketing** → **NEVER**. We do not run ads or use any data for advertising/marketing purposes.
- **Fraud prevention, security, and compliance** → **NOT DECLARED** in v1. We do not currently use any of the collected data categories for this purpose on the Play form (Phase 19's affiliate-fraud detector operates on session-side server data not tied to a Play data category).
- **Personalization** → **NOT DECLARED** in v1. The AI coach personalizes responses but uses only the user's own logged data, not cross-user inferences.

---

## 6. Source-of-truth cross-reference (REGRESSION CONTRACT)

**Every row here MUST mirror an entry in `apps/ios/App/App/PrivacyInfo.xcprivacy`.**
If iOS changes, this table changes. CI does not auto-enforce this table (the
audit script enforces the iOS half); the table itself is the operator's
checklist on every relevant PR.

| Play category / type | iOS NSPrivacyCollectedDataType | Linked? | Tracking? | Purposes |
|---|---|---|---|---|
| Personal info / Email address | `NSPrivacyCollectedDataTypeEmailAddress` | YES (Linked=true) | NO (Tracking=false) | AppFunctionality, AccountManagement |
| Personal info / User ID | `NSPrivacyCollectedDataTypeUserID` | YES (Linked=true) | NO (Tracking=false) | AppFunctionality, AccountManagement |
| Health & fitness / Health info | `NSPrivacyCollectedDataTypeHealth` | **NO (Linked=false — D-18)** | NO (Tracking=false) | AppFunctionality, Analytics |
| Photos and videos / Photos | `NSPrivacyCollectedDataTypePhotosorVideos` | YES (Linked=true) | NO (Tracking=false) | AppFunctionality |
| App info and performance / Crash logs | `NSPrivacyCollectedDataTypeCrashData` | NO (Linked=false) | NO (Tracking=false) | AppFunctionality, Analytics |
| Financial info / Purchase history | `NSPrivacyCollectedDataTypePurchaseHistory` | YES (Linked=true) | NO (Tracking=false) | AppFunctionality |

---

## 7. Change log

| Date | Change | Author | Source |
|---|---|---|---|
| 2026-05-16 | Initial completion for v1.2 first submission (Phase 16). Mirrors iOS PrivacyInfo.xcprivacy 6 collected-data types. | Phase 16 Plan 16-07 | 16-07-PLAN, 16-CONTEXT D-18, 16-RESEARCH |

---

## 8. Submission instructions (operator copy-paste guide)

1. Open Play Console → **LeanShot app** → **Policy** → **App content** → **Data safety**.
2. Click **Manage** → walk through the wizard, answering each section with the rows in §2 above. Set "Data not collected" for every row marked "NO".
3. For each "YES" row, fill: collection mode (always **Collected**), sharing mode (per §3), processing purposes (per §5), and the "Required vs Optional" + "Data linked to user identity" toggles per the table.
4. For **Health info**, set **"Data is not linked to your identity" → YES** (matches iOS D-18 Linked=false).
5. Submit for Play review. Re-export this document as `data-safety-vX.Y.pdf` and attach to the change-log row in §7 with the submission ID.

---

## 9. Related artifacts

- iOS Privacy Manifest: `apps/ios/App/App/PrivacyInfo.xcprivacy`
- Audit script (CI gate, iOS half): `scripts/audit-privacy-manifest.mjs`
- Audit workflow: `.github/workflows/mobile-privacy-audit.yml`
- Privacy Policy: published at `https://leanshot.app/privacy` (cross-references this file for the data-collection matrix).
- Phase 16 CONTEXT: `.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md` (D-07 plugin inventory + D-09 domains + D-18 health-not-linked).
