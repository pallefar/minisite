# LeanShot — Privacy Nutrition Labels

**Last updated:** 2026-05-25
**Phase:** 53 (Capacitor Mobile Shells)
**Source manifests:**
- Apple App Privacy: [`apps/ios/App/App/PrivacyInfo.xcprivacy`](../App/App/PrivacyInfo.xcprivacy)
- Google Data Safety: [`apps/android/data-safety.md`](../../android/data-safety.md)

> This document is a cross-reference mapping only. The authoritative privacy data
> is declared in `PrivacyInfo.xcprivacy` (Apple) and `data-safety.md` (Google).
> **Do not modify this file in isolation** — changes to either source manifest
> must be reflected here and vice versa. The CI audit script
> (`scripts/audit-privacy-manifest.mjs`) enforces the iOS manifest on every PR.

---

## Apple App Privacy (App Store)

The table below maps each `NSPrivacyCollectedDataType` declared in
`PrivacyInfo.xcprivacy` to its Apple App Privacy nutrition-label category.

| NSPrivacyCollectedDataType | Apple Label Category | Linked to Identity | Used for Tracking | Purposes |
|---|---|---|---|---|
| `NSPrivacyCollectedDataTypeEmailAddress` | Contact Info › Email Address | YES | NO | App Functionality, Account Management |
| `NSPrivacyCollectedDataTypeUserID` | Identifiers › User ID | YES | NO | App Functionality, Account Management |
| `NSPrivacyCollectedDataTypeHealth` | Health & Fitness › Health | NO (D-18) | NO | App Functionality, Analytics |
| `NSPrivacyCollectedDataTypePhotosorVideos` | Photos or Videos › Photos | YES | NO | App Functionality |
| `NSPrivacyCollectedDataTypeCrashData` | Diagnostics › Crash Data | NO | NO | App Functionality, Analytics |
| `NSPrivacyCollectedDataTypePurchaseHistory` | Purchases › Purchase History | YES | NO | App Functionality |

**NSPrivacyTracking:** `false` — LeanShot does not track users across apps or websites.

**NSPrivacyAccessedAPITypes** (required API reason codes from `PrivacyInfo.xcprivacy`):

| API Type | Reason Code | Purpose |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Capacitor Preferences plugin reads/writes NSUserDefaults for local storage |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | Capacitor Filesystem plugin reads file modification dates |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Sentry crash reporter reads boot time for crash diagnostics |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | Capacitor checks available disk space before large writes |

---

## Google Data Safety (Play Store)

The table below maps each Play Data Safety category to its iOS counterpart.
The full Play Data Safety form with submission instructions is at
`apps/android/data-safety.md`.

| Play Category / Type | iOS NSPrivacyCollectedDataType | Linked to Identity | Tracking | Third-party Processor |
|---|---|---|---|---|
| Personal info / Email address | `NSPrivacyCollectedDataTypeEmailAddress` | YES | NO | Supabase (backend-of-record) |
| Personal info / User ID | `NSPrivacyCollectedDataTypeUserID` | YES | NO | Supabase |
| Health & fitness / Health info | `NSPrivacyCollectedDataTypeHealth` | NO (D-18) | NO | Supabase |
| Photos and videos / Photos | `NSPrivacyCollectedDataTypePhotosorVideos` | YES | NO | Supabase Storage |
| App info and performance / Crash logs | `NSPrivacyCollectedDataTypeCrashData` | NO | NO | Sentry (data processor) |
| Financial info / Purchase history | `NSPrivacyCollectedDataTypePurchaseHistory` | YES | NO | RevenueCat (data processor) |

**Data not collected (Play categories where answer is NO):**
Name, Address, Phone number, Race/ethnicity, Political/religious beliefs, Sexual
orientation, Other personal info, Credit/debit card info, Other financial info,
Fitness info (Phase 18 expansion deferred), Videos, Audio, Files and docs,
Calendar, Contacts, App interactions, In-app search history, Installed apps,
Other actions, Web browsing, Diagnostics, Other performance data,
Device or other IDs.

---

## Phase 70 Deferral Notes

The following privacy-adjacent items require Phase 70 substitution before store submission:

| Item | Current State | Phase 70 Action |
|---|---|---|
| Apple Team ID in `App.entitlements` associated-domains | Placeholder `TEAMID` in `apple-app-site-association` | Substitute real Apple Team ID once Developer enrollment is complete |
| Play App Signing SHA256 in `assetlinks.json` | Placeholder `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09` | Substitute real SHA256 fingerprint from Play Console App Signing |
| App Store Privacy Questionnaire submission | Not yet submitted | Complete at app submission time using the table in this file |
| Play Data Safety form submission | Not yet submitted | Complete at app submission time using `apps/android/data-safety.md` §8 |

---

## Change Log

| Date | Change | Author | Source |
|---|---|---|---|
| 2026-05-25 | Initial cross-reference mapping for Phase 53 submission package. Maps 6 iOS data types + 4 API reasons to Apple/Google labels. | Phase 53 Plan 53-01 | 53-RESEARCH, PrivacyInfo.xcprivacy, data-safety.md |
