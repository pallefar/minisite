/**
 * Phase 3 PK disclaimer copy — single source of truth.
 *
 * Per UI-SPEC §Copywriting Contract and CONTEXT D-08, the chart watermark,
 * Y-axis label, band caption, and DoctorReport PDF disclaimer all derive
 * from these six string constants. Any future copy change touches one file.
 *
 * Punctuation rules (UI-SPEC §Punctuation):
 *  - em-dash is U+2014 (—), not hyphen (-) or en-dash (–)
 *  - middle dot is U+00B7 (·), not bullet (•)
 *  - tilde is ASCII U+007E (~)
 *  - lowercase initial `estimate` is intentional (CONTEXT D-08)
 */

export const PK_DISCLAIMER_LINE_1 = 'estimate, not measured serum level';

export const PK_DISCLAIMER_LINE_2 = '— based on population pharmacokinetics';

export const PK_DISCLAIMER_FULL = `${PK_DISCLAIMER_LINE_1} ${PK_DISCLAIMER_LINE_2}`;

export const PK_DISCLAIMER_BAND_CAPTION = 'Estimate · ~30% inter-individual variation';

export const PK_DISCLAIMER_Y_AXIS = 'Estimate · arbitrary units';

export const PK_DISCLAIMER_DOCTOR_REPORT =
  'Drug-level curve: estimate, not measured serum level — based on population pharmacokinetics. Shows modeled mean with shaded inter-individual variability band (~30%).';
