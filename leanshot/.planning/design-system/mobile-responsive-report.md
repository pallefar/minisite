# Mobile-Responsive Audit (DS-07)

Generated: 2026-05-27T07:14:24.266Z

Report-only heuristic audit. False positives expected — operator filters
during fix pass (Phase 69.5). Script exits 0 regardless of findings.

Mobile breakpoint: 375px (iPhone SE). Min tap target: 44px.

Total findings: **114**

## Summary

| Check | Findings |
| --- | --- |
| Hardcoded width > 375px without responsive override | 41 |
| Tap target < 44px (Apple HIG / Material) | 0 |
| `overflow-x-auto` (verify reflow vs scroll) | 46 |
| `<table>` without `overflow-x-auto` wrapper | 27 |

## Hardcoded width > 375px without responsive override — 41 findings

- `leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx:127` — w-[900px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  const innerWrapperClassName = widthMode ? '' : 'max-w-[900px] mx-auto';
  ```
- `leanshot/src/components/admin/pages/blocks/ImageTextBlock.tsx:39` — w-[600px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  className="w-full max-w-[600px] aspect-[3/2] object-cover rounded-xl"
  ```
- `leanshot/src/components/admin/pages/BlockVariantDrawer.tsx:16` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  * <action> note explicitly forbids inline `w-[480px]` arbitrary values
  ```
- `leanshot/src/components/admin/palette/AdminCommandPalette.tsx:115` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[640px] mx-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card,var(--color-bg))] text-[var(--color-text)] shad
  ```
- `leanshot/src/components/admin/protocols/ProtocolSummaryCard.tsx:83` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="flat" padding="md" className="max-w-[480px] w-full">
  ```
- `leanshot/src/components/admin/protocols/ProtocolSummaryCard.tsx:92` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="flat" padding="md" className="max-w-[480px] w-full">
  ```
- `leanshot/src/components/admin/protocols/ProtocolSummaryCard.tsx:99` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="flat" padding="md" className="max-w-[480px] w-full">
  ```
- `leanshot/src/components/auth/AuthFormShell.tsx:52` — w-[380px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[380px] mx-auto my-auto">
  ```
- `leanshot/src/components/auth/AuthHero.tsx:27` — w-[720px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <LoginHero className="absolute right-[-120px] top-1/2 -translate-y-1/2 w-[720px] h-[720px] opacity-85 pointer-events-none" />
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:185` — w-[720px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="mx-auto max-w-[720px]">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:223` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:256` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="default" padding="lg" className="max-w-[640px] mx-auto">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:279` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:316` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:338` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:356` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
  ```
- `leanshot/src/components/clinic-invite/ClinicInvitePage.tsx:379` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
  ```
- `leanshot/src/components/clinic-invite/ConsentDialog.tsx:148` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
  ```
- `leanshot/src/components/clinic-invite/ConsentDialog.tsx:171` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
  ```
- `leanshot/src/components/clinic-invite/ConsentDialog.tsx:191` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
  ```
- `leanshot/src/components/clinic/RouteOrgGuard.tsx:135` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] w-full text-center">
  ```
- `leanshot/src/components/clinic/RouteOrgGuard.tsx:152` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] w-full">
  ```
- `leanshot/src/components/clinic/RouteOrgGuard.tsx:203` — w-[480px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <Card variant="elevated" padding="lg" className="max-w-[480px] w-full text-center">
  ```
- `leanshot/src/components/legal/LegalLayout.tsx:28` — w-[800px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="max-w-[800px] mx-auto flex items-center justify-between">
  ```
- `leanshot/src/components/legal/LegalLayout.tsx:40` — w-[800px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <main className="max-w-[800px] mx-auto px-5 py-10">
  ```
- `leanshot/src/components/legal/MedicalDisclaimer.tsx:24` — w-[760px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
  ```
- `leanshot/src/components/legal/PrivacyPolicy.tsx:36` — w-[760px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
  ```
- `leanshot/src/components/legal/TermsOfService.tsx:27` — w-[760px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
  ```
- `leanshot/src/components/marketing/Landing.tsx:55` — w-[1200px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <nav className="max-w-[1200px] mx-auto px-5 py-4 flex items-center justify-between">
  ```
- `leanshot/src/components/marketing/Landing.tsx:182` — w-[440px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="relative aspect-square max-w-[440px] mx-auto rounded-[32px] bg-gradient-to-br from-[var(--color-hero-bg)] to-[var(--color-hero-bg-2)] shadow-her
  ```
- `leanshot/src/components/marketing/Landing.tsx:275` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="text-center max-w-[640px] mx-auto mb-16">
  ```
- `leanshot/src/components/marketing/Landing.tsx:337` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="text-center max-w-[640px] mx-auto mb-12">
  ```
- `leanshot/src/components/marketing/Landing.tsx:415` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="text-center max-w-[640px] mx-auto mb-12">
  ```
- `leanshot/src/components/onboarding/AnonymousPreviewView.tsx:25` — w-[560px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-4 py-12 text-center">
  ```
- `leanshot/src/components/onboarding/AnonymousPreviewView.tsx:33` — w-[420px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <p className="mx-auto max-w-[420px] text-balance text-[15px] leading-relaxed text-[var(--color-text-muted)]">
  ```
- `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx:249` — w-[560px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[560px]">
  ```
- `leanshot/src/components/onboarding/OnboardingFlow.tsx:172` — w-[560px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[560px]">
  ```
- `leanshot/src/components/onboarding/OnboardingFlow.tsx:326` — w-[560px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[560px]">
  ```
- `leanshot/src/components/onboarding/OnboardingFlow.tsx:930` — w-[560px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[560px]">
  ```
- `leanshot/src/components/protocols/PublicProtocolPage.tsx:120` — w-[680px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <main className="max-w-[680px] mx-auto px-6 py-12">
  ```
- `leanshot/src/components/search/SearchModal.tsx:74` — w-[640px] exceeds 375px mobile breakpoint without md:/lg: override
  ```
  <div className="w-full max-w-[640px] mx-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card,var(--color-bg))] text-[var(--color-text)] shad
  ```

## Tap target < 44px (Apple HIG / Material) — 0 findings

_None detected._

## `overflow-x-auto` (verify reflow vs scroll) — 46 findings

- `leanshot/src/admin/modules/events/EventListPage.tsx:165` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/admin/modules/reviews/CtaCatalogPage.tsx:65` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx:419` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/AdminAffiliatesScaffold.tsx:224` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx:219` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
  ```
- `leanshot/src/components/admin/anomaly/AdminAnomalyAcknowledgeQueue.tsx:217` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/anomaly/AdminAnomalyTrackedFunnelsConfig.tsx:231` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto mb-6">
  ```
- `leanshot/src/components/admin/cancellation/CancellationCohortTable.tsx:111` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-2 px-2">
  ```
- `leanshot/src/components/admin/compliance/BaaChainTable.tsx:194` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
  ```
- `leanshot/src/components/admin/embeds/AllowlistTable.tsx:131` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--color-border)]">
  ```
- `leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx:283` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/growth/TrafficChannelsTab.tsx:288` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/i18n/LocaleOverridesModule.tsx:192` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="mt-3 overflow-x-auto">
  ```
- `leanshot/src/components/admin/members/MemberActivityTab.tsx:79` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto" data-testid="member-activity-tab">
  ```
- `leanshot/src/components/admin/members/MemberAuditTab.tsx:85` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto" data-testid="member-audit-tab">
  ```
- `leanshot/src/components/admin/members/MembersTable.tsx:214` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto hidden md:block">
  ```
- `leanshot/src/components/admin/members/MemberStripeTab.tsx:42` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto" data-testid="member-stripe-tab">
  ```
- `leanshot/src/components/admin/onboarding-builder/OnboardingFunnelTab.tsx:147` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/protocols/ProtocolEditorPage.tsx:435` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/protocols/ProtocolsListPage.tsx:242` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/rag/RagLayout.tsx:87` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/rag/RagSourcesPage.tsx:190` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/rag/RagTopicsPage.tsx:172` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <Card variant="default" padding="none" className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/research/CrossTabMatrix.tsx:42` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/research/PublicationsListPage.tsx:262` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/admin/users/RoleMfaRequirementTable.tsx:172` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/clinic/roster/RosterTable.tsx:383` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="hidden md:block overflow-x-auto" data-testid="roster-table-desktop">
  ```
- `leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx:249` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <ul className="flex md:flex-col gap-1 overflow-x-auto scrollbar-none -mx-2 md:mx-0 px-2">
  ```
- `leanshot/src/components/clinic/settings/RoleEditorModal.tsx:420` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
  ```
- `leanshot/src/components/community/CommunityPostMediaStrip.tsx:56` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  className="flex flex-wrap gap-2 overflow-x-auto"
  ```
- `leanshot/src/components/dashboard/cards/HeroCard.tsx:162` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="flex items-center gap-1 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1">
  ```
- `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx:441` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx:392` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <ul className="flex md:flex-col gap-1 overflow-x-auto scrollbar-none -mx-2 md:mx-0 px-2">
  ```
- `leanshot/src/components/dashboard/share/LevelUpShareModal.tsx:132` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <pre className="text-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-2 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
  ```
- `leanshot/src/components/dashboard/tabs/ActivityTab.tsx:259` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1">
  ```
- `leanshot/src/components/dashboard/tabs/BodyTab.tsx:466` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1">
  ```
- `leanshot/src/components/dashboard/tabs/MedicationTab.tsx:322` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1" data-testid="injection-list">
  ```
- `leanshot/src/components/dashboard/tabs/MedicationTab.tsx:428` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1">
  ```
- `leanshot/src/components/dashboard/tabs/NutritionTab.tsx:265` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1">
  ```
- `leanshot/src/components/dashboard/tabs/SymptomsTab.tsx:123` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto -mx-1">
  ```
- `leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx:250` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  className="prose prose-sm max-w-none text-text [&_a]:text-primary [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl
  ```
- `leanshot/src/components/layout/MobileNav.tsx:35` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  // (className includes `overflow-x-auto scrollbar-none`) so iOS-style
  ```
- `leanshot/src/components/layout/MobileNav.tsx:64` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  className="glass border border-[var(--color-border)] rounded-[28px] shadow-lg overflow-x-auto scrollbar-none"
  ```
- `leanshot/src/components/legal/SubprocessorList.tsx:114` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
  ```
- `leanshot/src/components/partner/PartnerPayoutsPage.tsx:143` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  <div className="overflow-x-auto">
  ```
- `leanshot/src/components/research/ResearchArticlePage.tsx:198` — `overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll
  ```
  className="prose prose-sm max-w-none text-[var(--color-text)] [&_a]:text-[var(--color-primary)] [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:b
  ```

## `<table>` without `overflow-x-auto` wrapper — 27 findings

- `leanshot/src/admin/modules/billing/GrandfatheredPricesPage.tsx:280` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm">
  ```
- `leanshot/src/admin/modules/community/AdminCliniciansPage.tsx:146` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx:96` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/courses/CoursesListAdmin.tsx:81` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/events/EventAttendeesPane.tsx:155` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/helpdesk/TrendsDashboardPage.tsx:12` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  *   - hidden sr-only <table> mirrors the raw (date, tag, count) rows
  ```
- `leanshot/src/admin/modules/helpdesk/TrendsDashboardPage.tsx:228` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="sr-only">
  ```
- `leanshot/src/admin/modules/moderation/AuditLogViewer.tsx:241` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/moderation/BannedWordsEditor.tsx:224` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/moderation/ReportsQueue.tsx:172` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/admin/modules/moderation/UserBansRoster.tsx:107` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-sm border-collapse">
  ```
- `leanshot/src/components/admin/embeds/AllowlistTable.tsx:4` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  * Real <table>/<thead>/<tbody> semantics per UI-SPEC §Accessibility (NOT
  ```
- `leanshot/src/components/admin/growth/CACDashboardPage.tsx:627` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/admin/growth/CACDashboardPage.tsx:709` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx:497` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx:293` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx:222` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/admin/members/MembersTable.tsx:213` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  {/* Desktop: <table>. Mobile (<md): hidden, replaced by card list below. */}
  ```
- `leanshot/src/components/clinic/roster/RosterTable.tsx:15` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  * Desktop (<768px hidden) renders <table> with RosterRow.
  ```
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx:161` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx:209` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx:257` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx:291` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px]">
  ```
- `leanshot/src/components/protocols/PublicProtocolPage.tsx:167` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  <table className="w-full text-[13px] mb-8" aria-label="Protocol steps">
  ```
- `leanshot/src/lib/moderation/rls-predicates.ts:22` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  * for each content table (Plan 49+ owners replace `<table>` / `<author_col>`
  ```
- `leanshot/src/lib/moderation/rls-predicates.ts:31` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  WHERE ums.user_id = <table>.<author_col> AND ums.status = 'muted'
  ```
- `leanshot/src/lib/store.ts:364` — `<table>` not wrapped in `overflow-x-auto` — small-screen UX may break
  ```
  * `table === <table> AND key in keys`. The per-table flushTableOps helper
  ```

