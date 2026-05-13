# Phase 13 — Focus-Ring Audit Checklist (D-15 / SC #3)

D-15 requires the refreshed **Card / Button / Pill / Sidebar** primitives ship
without focus-ring regressions. Playwright `toHaveScreenshot` snapshots are
mouse-driven and cannot reliably capture `focus-visible` rings — focus rings
only appear during keyboard navigation. This checklist is the **manual** audit
the operator runs during `/gsd-verify-phase 13` to close out SC #3.

## Canonical focus-ring class (13-PATTERNS.md §E)

All refreshed primitives MUST use this exact Tailwind cascade so the ring
colour, offset, and contrast token resolve identically:

```
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-[var(--color-primary)]
focus-visible:ring-offset-2
focus-visible:ring-offset-[var(--color-bg)]
```

Any deviation (e.g. `ring-1`, missing `ring-offset-2`, hard-coded `ring-teal-500`)
counts as a regression.

## Primitive checklists

### Card (refreshed in 13-02)

Variants: `default`, `elevated`, `hero`, `selected`, `clickable`, `tonal`, `footer`.

#### Light theme

- [ ] Tab to a `clickable` Card; verify focus ring is visible against the
      `--color-bg` cream surround
- [ ] Verify ring offset (2 px) clears the Card's border so the ring + border
      don't visually fuse
- [ ] Verify ring colour is `--color-primary` teal (NOT `--color-text` black
      and NOT a hard-coded hex)
- [ ] Tab through a row of `tonal` Cards (Side-effects tab); verify each gets
      its own ring on focus without trailing residue from the previous focus

#### Dark theme

- [ ] Tab to a `clickable` Card; verify focus ring is visible against the
      `--color-bg` dark surround (sufficient contrast — should not blend)
- [ ] Verify ring colour shifts to the dark-mode `--color-primary` token (not
      the same hex as light mode)

### Button (refreshed in 13-02)

Variants: `primary`, `secondary`, `ghost`, `destructive`, `success`, `inverse`,
`tonal`. States: default, hover, focus, active, `disabled`, `loading`.

#### Light theme

- [ ] Tab through the Settings drawer Button row; verify focus ring on EACH
      variant
- [ ] `disabled` Buttons (`disabled:pointer-events-none`) MUST suppress the
      focus ring — verify by attempting to tab to a disabled button
- [ ] `loading` Buttons (`aria-busy="true"`) MUST preserve the focus ring —
      the spinner doesn't remove focus, only blocks interaction
- [ ] Buttons with a counter chip (notification-bubble pattern) keep the ring
      offset (2 px) — the chip does NOT crowd the ring

#### Dark theme

- [ ] Tab through the same Settings Button row in dark; verify ring contrast
      against dark `--color-bg`
- [ ] `destructive` variant ring uses the destructive token, not the global
      primary — verify the ring colour shifts on the Delete-account button

### Pill (refreshed in 13-02)

Variants: `default`, `segmented`, `count-badge`, `icon-only`.

#### Light theme

- [ ] Tab through the dashboard tab-list pills; verify `aria-pressed` state +
      focus ring coexist (ring sits OUTSIDE the pressed-state fill)
- [ ] Tab through the AuthView (Sign in / Sign up) segmented control; verify
      the ring spans the focused **segment**, not the whole group
- [ ] `icon-only` Pill: verify the `aria-label` is announced by VoiceOver /
      Narrator AND the focus ring is square-clipped to the icon hit-area

#### Dark theme

- [ ] Tab through the same pills in dark; verify ring contrast (`--color-bg`
      dark vs `--color-primary` teal)

### Sidebar (refreshed in 13-02)

States: collapsed (72 px), expanded (232 px), active-indicator (`motion.span
layoutId="sb-active"`).

#### Light theme

- [ ] Expanded sidebar: tab through nav items (Today, Medication, Side
      effects, Body, Nutrition, Activity, Stack, Mood, Wins); verify ring on
      EACH nav button
- [ ] Collapsed sidebar: tab through the same items; verify the ring is still
      visible despite reduced width (no clipping by the 72 px column)
- [ ] Active-indicator (`layoutId="sb-active"` framer-motion bar) does NOT
      obscure the focus ring of the focused nav item — ring sits ABOVE the
      indicator z-axis
- [ ] Keyboard tab order matches visual order top-to-bottom (collapse button
      → nav items → AI button → theme toggle → settings → profile)

#### Dark theme

- [ ] Expanded + collapsed in dark; verify ring contrast against
      `--color-bg` dark
- [ ] Theme-toggle button (sun/moon icon) keeps focus ring through the
      toggle action (focus should NOT jump after the click)

## Procedure

1. **Start the app** at `http://localhost:5173` (`npm run dev`) — light theme
   default.
2. **Press `Tab` repeatedly** from page load; observe each focus ring against
   its background. Use a high-resolution display so a 2-px ring with 2-px
   offset is clearly distinguishable from the element border.
3. **Toggle dark theme** via the sidebar moon/sun button; repeat from step 2.
4. **Enable "Increase contrast"** in macOS System Settings → Accessibility →
   Display (or Windows equivalent); verify focus rings remain visible — they
   should not get washed out under high-contrast mode.
5. **Test with reduced-motion** enabled (System Settings → Accessibility →
   Display → Reduce motion): verify focus rings still render correctly even
   when the framer-motion sidebar `layoutId` animation is suppressed.
6. **Record drift** below the relevant checklist item as a comment, including
   a screenshot if applicable. Any FAIL blocks Phase 13 close until the
   regression is fixed.

## Browsers

Default audit browser: **Chromium (latest)** matching the Playwright VR runner.
Spot-check at least one other:

- [ ] Firefox latest — `focus-visible` polyfill not needed (native support)
- [ ] Safari latest — `focus-visible` native; verify ring colour matches

## Sign-off

```
Audited by: ____________________________
Date:       ____________________________
Result:     PASS  /  FAIL
Notes:      ________________________________________________________
            ________________________________________________________
            ________________________________________________________
```

Attach the completed sign-off block to
`leanshot/.planning/phases/13-design-system-v2-rollout/13-VERIFICATION.md`
under the "Manual audits" section during phase close.
