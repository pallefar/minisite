/**
 * Phase 15 Plan 15-07 — `lead-form` block content shape.
 *
 * The `content` field of a `BlockNode` whose `type === 'lead-form'` is
 * narrowed to `LeadFormContent` at the consumer. `BlockNode.content` stays
 * `Record<string, unknown>` at the schema level so the JSONB store can
 * round-trip every block type through one shape.
 *
 * D-12: forms are NATIVE (not delegated to Tally/etc.). The shape is
 * intentionally small — heading / description / button label / success
 * message / optional name field. No hex pickers, no font controls — the
 * editor renders this through the token-bounded property-configs registry.
 */

export interface LeadFormContent {
  /** Headline above the form (Geist 22px semibold per UI-SPEC). */
  heading: string;
  /** Optional supporting copy below the heading. Empty string allowed. */
  description: string;
  /** Submit button label (UI-SPEC Copywriting Contract). */
  buttonLabel: string;
  /** Inline message shown in place of the form after a 200 response. */
  successMessage: string;
  /** When true, render an optional `name` field above the email field. */
  collectName: boolean;
}

export const DEFAULT_LEAD_FORM_CONTENT: LeadFormContent = {
  heading: 'Get the free guide',
  description: '',
  buttonLabel: 'Send me access',
  successMessage: "You're on the list. Check your inbox for next steps.",
  collectName: false,
};
