// PHI EVENTS — Edge-Function-only emission. Import-blocked from client zones via eslint.config.js.
//
// These events contain Protected Health Information (PHI) and MUST NEVER be
// captured from the browser. They are emitted exclusively from Edge Functions
// via supabase/functions/_shared/posthog-server.ts (D-12, Phase 24).
//
// ESLint rule `import-x/no-restricted-paths` blocks any client-zone import of
// this file. See eslint.config.js Zone: PHI events.
import { z } from 'zod';

export type PhiEventDef = {
  readonly name: string;
  readonly version: 1;
  readonly payload: z.ZodObject<z.ZodRawShape>;
  readonly phi: true;
  readonly description: string;
  readonly owner: 'growth' | 'product' | 'platform' | 'billing' | 'admin';
};

export const PHI_EVENTS = {
  phi_dose_logged: {
    name: 'phi_dose_logged',
    version: 1,
    phi: true,
    owner: 'product',
    description:
      'User logged a medication dose. PHI: user_id + drug_id + dose amount. Edge-Fn only.',
    payload: z.object({
      user_id: z.string().uuid(),
      drug_id: z.string(),
      dose_mg: z.number().positive(),
    }),
  },
  phi_weight_logged: {
    name: 'phi_weight_logged',
    version: 1,
    phi: true,
    owner: 'product',
    description: 'User logged a body weight measurement. PHI: user_id + weight. Edge-Fn only.',
    payload: z.object({
      user_id: z.string().uuid(),
      weight_kg: z.number().positive(),
    }),
  },
  phi_meal_logged: {
    name: 'phi_meal_logged',
    version: 1,
    phi: true,
    owner: 'product',
    description: 'User logged a meal entry. PHI: user_id + caloric/macro data. Edge-Fn only.',
    payload: z.object({
      user_id: z.string().uuid(),
      calories: z.number().nonnegative(),
      macros: z.object({
        p: z.number().nonnegative(),
        f: z.number().nonnegative(),
        c: z.number().nonnegative(),
      }),
    }),
  },
} as const satisfies Record<string, PhiEventDef>;

export type PhiEventName = keyof typeof PHI_EVENTS;
export type PhiPayloadOf<K extends PhiEventName> = z.infer<(typeof PHI_EVENTS)[K]['payload']>;
