/**
 * Phase 19 Plan 19-08 — affiliate-templates catalog vitest suite.
 *
 * 6 assertions covering the 3 new affiliate templates + the
 * scaffold-with-overrides helper:
 *   T1: getAffiliateTemplates() returns exactly 3 templates with ids
 *       ['coach','story','method']
 *   T2: each template's blocks include Hero, CTA, Footer (minimum spine)
 *   T3: coach hero references {{display_name}} + {{photo_path}} +
 *       {{calendly_url}} slots
 *   T4: story hero contains {{testimonial_quote}} slot
 *   T5: method hero does NOT reference {{photo_path}} (no above-fold photo
 *       per UI-SPEC line 250-252)
 *   T6: scaffoldAffiliateTemplate({template:'coach', overrides:
 *       {display_name:'Jane'}}) substitutes the slot in the hero
 */
import { describe, expect, it } from 'vitest';
import {
  getAffiliateTemplates,
  scaffoldAffiliateTemplate,
} from '@/lib/page-builder/templates';

function blockTreeJson(blocks: unknown): string {
  return JSON.stringify(blocks);
}

describe('Phase 19 affiliate templates', () => {
  it('T1: returns exactly 3 templates with ids coach/story/method', () => {
    const templates = getAffiliateTemplates();
    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.id)).toEqual(['coach', 'story', 'method']);
    expect(templates.every((t) => t.category === 'affiliate')).toBe(true);
  });

  it('T2: every template contains hero + cta + footer blocks (minimum spine)', () => {
    for (const tmpl of getAffiliateTemplates()) {
      const types = tmpl.blocks.map((b) => b.type);
      expect(types).toContain('hero');
      expect(types).toContain('cta');
      expect(types).toContain('footer');
    }
  });

  it('T3: coach hero references {{display_name}}, {{photo_path}}, {{calendly_url}} slots', () => {
    const coach = getAffiliateTemplates().find((t) => t.id === 'coach');
    expect(coach).toBeDefined();
    const hero = coach!.blocks.find((b) => b.type === 'hero');
    expect(hero).toBeDefined();
    const heroJson = blockTreeJson(hero!.content);
    expect(heroJson).toContain('{{display_name}}');
    expect(heroJson).toContain('{{photo_path}}');
    expect(heroJson).toContain('{{calendly_url}}');
  });

  it('T4: story hero contains {{testimonial_quote}} slot', () => {
    const story = getAffiliateTemplates().find((t) => t.id === 'story');
    expect(story).toBeDefined();
    const hero = story!.blocks.find((b) => b.type === 'hero');
    expect(hero).toBeDefined();
    expect(blockTreeJson(hero!.content)).toContain('{{testimonial_quote}}');
  });

  it('T5: method hero does NOT reference {{photo_path}} (no above-fold photo)', () => {
    const method = getAffiliateTemplates().find((t) => t.id === 'method');
    expect(method).toBeDefined();
    const hero = method!.blocks.find((b) => b.type === 'hero');
    expect(hero).toBeDefined();
    // Method hero is bullets-only; photo lives in a separate attribution block
    // BELOW the hero. The hero itself MUST NOT carry a photo slot.
    expect(blockTreeJson(hero!.content)).not.toContain('{{photo_path}}');
  });

  it('T6: scaffoldAffiliateTemplate substitutes overrides into hero content', () => {
    const scaffolded = scaffoldAffiliateTemplate({
      template: 'coach',
      overrides: { display_name: 'Jane' },
    });
    const hero = scaffolded.find((b) => b.type === 'hero');
    expect(hero).toBeDefined();
    const heroJson = blockTreeJson(hero!.content);
    expect(heroJson).toContain('"Jane"');
    expect(heroJson).not.toContain('{{display_name}}');
    // Un-overridden slots remain intact.
    expect(heroJson).toContain('{{referral_code}}');
  });

  it('scaffoldAffiliateTemplate regenerates block ids (immutable catalog)', () => {
    const a = scaffoldAffiliateTemplate({ template: 'story' });
    const b = scaffoldAffiliateTemplate({ template: 'story' });
    const aIds = new Set(a.map((bn) => bn.id));
    const bIds = new Set(b.map((bn) => bn.id));
    // Two scaffolds from the same template produce disjoint id sets.
    for (const id of aIds) {
      expect(bIds.has(id)).toBe(false);
    }
  });
});
