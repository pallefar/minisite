# Phase 66: Consumer Account Security — UI Spec

## Surfaces

| Surface | Route | Audience | Components | Plan |
|---------|-------|----------|------------|------|
| MFA Enrollment | `/settings/security` | Consumer | `<SecuritySettingsPage>` wrapping `<TotpEnrollFlow mode="consumer">` | 66-03 |
| AAL2 step-up modal | (in-app) | Consumer | `<Aal2ChallengeModal>` | 66-04 |
| Sign-in lockout banner | `/login` form error state | Consumer | `<SignInLockoutBanner>` (text + countdown) | 66-05 |
| Admin role-MFA config | `/admin/users/security` | Admin | `<RoleMfaRequirementTable>` | 66-06 |
| MFA badge in user-detail | `/admin/users/<id>` | Admin | `<MfaStatusBadge>` | 66-06 |

## Tokens (Tailwind v4 @theme)

All surfaces use existing tokens from `src/index.css` — no new tokens needed. Verify against:

| Token | Used by |
|-------|---------|
| `bg-surface` | Card backgrounds |
| `bg-surface-soft` | Modal inner panels |
| `text-text` | Body copy |
| `text-text-muted` | Helper text |
| `bg-danger` / `text-danger` | Lockout banner |
| `bg-warning` / `text-warning` | "MFA required, not enrolled" badge |
| `bg-success-soft` / `text-success` | "MFA on" badge |
| `border-border` | Cards / table |
| `bg-primary` / `text-primary-foreground` | Enroll CTA |

**Typography ceiling:** 11 / 13 / 18 / text-heading sizes; weights 400 / 600 only.

## Component contracts

### `<TotpEnrollFlow mode>`
- **Props:** `mode: 'admin' | 'consumer'`, `onSuccess: () => void`
- **Behavior:** QR-code → 6-digit verify input → backup codes (10× 8-char alphanumeric, shown once, downloadable TXT) → success callback
- **Reuses:** `src/lib/admin/totp.ts` (`enrollTotp`, `verifyTotpChallenge`)
- **Copy divergence:** `mode==='admin'` opens with "Set up MFA for admin access"; `mode==='consumer'` opens with "Add 2-factor authentication to your account"

### `<Aal2ChallengeModal>`
- **Props:** `open: bool`, `onSuccess: () => void`, `onCancel: () => void`, `purpose: 'delete-account' | 'export-all-data' | 'change-email'`
- **Behavior:** "Enter your 6-digit code to confirm" → verify via `requireAal2Fresh()` → on success call onSuccess; on cancel close + caller no-ops
- **Reuses:** `src/lib/admin/palette/aal2-step-up.ts`

### `<SignInLockoutBanner>`
- **Props:** `lockedUntil: Date`, `reason: 'ip' | 'email'`
- **Renders:** "Too many failed attempts. Try again in HH:MM, or [use a magic link]." Magic-link inline `<a>` links to existing Phase 64 magic-link endpoint.

### `<RoleMfaRequirementTable>`
- 1 row per role; checkbox column "MFA required"; column "Since" showing when last changed; service-role mutation via existing admin SECDEF RPC pattern

### `<MfaStatusBadge>`
- Reads from `users.mfa_factors` count > 0 + checks if user's role requires MFA
- 3 states: `on` (green) / `required-not-enrolled` (amber) / `off` (grey)
