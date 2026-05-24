/**
 * Static lists used across the app — supplements, symptoms, tab metadata.
 * Ported from v1 (leanshot.html:1325-1376) and de-emoji'd.
 */
import type { TabId } from '@/types';

export interface Supplement {
  id: string;
  name: string;
  brand: string;
  /** Lucide icon name */
  icon: string;
  why: string;
  search: string;
}

export const SUPPS_DEFAULT: Supplement[] = [
  {
    id: 'electrolytes',
    name: 'Electrolytes',
    brand: 'LMNT / Nuun / Liquid IV',
    icon: 'Zap',
    why: 'Prevents headaches and fatigue. GLP-1s mute thirst cues.',
    search: 'electrolyte+powder',
  },
  {
    id: 'protein',
    name: 'Whey/Plant Protein',
    brand: 'Optimum Nutrition / Legion',
    icon: 'GlassWater',
    why: 'Critical when appetite is suppressed. 25g per scoop.',
    search: 'whey+protein+powder',
  },
  {
    id: 'creatine',
    name: 'Creatine Monohydrate',
    brand: 'Bulk Supplements / Creapure',
    icon: 'Dumbbell',
    why: 'Best-studied muscle preserver. 5g daily.',
    search: 'creatine+monohydrate',
  },
  {
    id: 'fiber',
    name: 'Psyllium Husk',
    brand: "Metamucil / NOW / Anthony's",
    icon: 'Wheat',
    why: 'Fixes the #1 GI complaint: constipation.',
    search: 'psyllium+husk',
  },
  {
    id: 'magnesium',
    name: 'Magnesium Glycinate',
    brand: "Doctor's Best / Nature Made",
    icon: 'Moon',
    why: 'Better sleep, smoother digestion.',
    search: 'magnesium+glycinate',
  },
  {
    id: 'multi',
    name: 'Multivitamin',
    brand: 'Thorne / Ritual / AG1',
    icon: 'Sparkles',
    why: 'Insurance against gaps from eating less.',
    search: 'multivitamin',
  },
  {
    id: 'd3k2',
    name: 'Vitamin D3 + K2',
    brand: 'Sports Research / Thorne',
    icon: 'Sun',
    why: 'Bone health, immunity, muscle function.',
    search: 'vitamin+d3+k2',
  },
  {
    id: 'omega3',
    name: 'Omega-3 Fish Oil',
    brand: 'Nordic Naturals / Carlson',
    icon: 'Fish',
    why: 'Inflammation, mood, heart support.',
    search: 'omega+3+fish+oil',
  },
  {
    id: 'b12',
    name: 'Vitamin B12',
    brand: 'Jarrow / NOW (methyl form)',
    icon: 'Battery',
    why: 'Energy, mood, nerve health.',
    search: 'b12+methylcobalamin',
  },
  {
    id: 'enzymes',
    name: 'Digestive Enzymes',
    brand: 'NOW / Garden of Life',
    icon: 'FlaskConical',
    why: 'Eases bloating from slow gastric emptying.',
    search: 'digestive+enzymes',
  },
];

export interface SymptomMeta {
  id: string;
  name: string;
  /** Lucide icon name */
  icon: string;
}

export const SYMPTOMS_LIST: SymptomMeta[] = [
  { id: 'nausea', name: 'Nausea', icon: 'CloudRain' },
  { id: 'fatigue', name: 'Fatigue', icon: 'BedDouble' },
  { id: 'constipation', name: 'Constipation', icon: 'CircleSlash' },
  { id: 'diarrhea', name: 'Diarrhea', icon: 'CircleDot' },
  { id: 'sulfur', name: 'Sulfur burps', icon: 'Wind' },
  { id: 'reflux', name: 'Reflux', icon: 'Flame' },
  { id: 'headache', name: 'Headache', icon: 'Brain' },
  { id: 'injection', name: 'Injection rxn', icon: 'Syringe' },
  { id: 'dizziness', name: 'Dizziness', icon: 'CircleEllipsis' },
  { id: 'mood', name: 'Mood shift', icon: 'CloudSun' },
  { id: 'hairloss', name: 'Hair loss', icon: 'Scissors' },
  { id: 'cravings', name: 'Cravings', icon: 'Cookie' },
];

export const TAB_TITLES: Record<TabId, { title: string; sub: string }> = {
  home: { title: 'Today', sub: 'Your GLP-1 journey at a glance' },
  medication: { title: 'Medication', sub: 'Injections, vials, and your med-level curve' },
  symptoms: { title: 'Side effects', sub: 'Track patterns. Bring this to your doctor.' },
  body: { title: 'Body', sub: 'The whole picture, not just the scale' },
  nutrition: { title: 'Nutrition', sub: 'Protein-first. Hit your target. Preserve muscle.' },
  activity: { title: 'Activity', sub: 'Resistance training is non-negotiable on GLP-1' },
  supplements: { title: 'Stack', sub: '10 essentials for serious GLP-1 users' },
  mood: { title: 'Mood & sleep', sub: 'Real GLP-1 signals. Track them.' },
  insights: { title: 'Wins & insights', sub: "The things scales don't measure" },
  community: { title: 'Community', sub: 'Connect with others on the same journey' },
  // Phase 46 Plan 08 — Classroom tab title strip.
  classroom: { title: 'Classroom', sub: 'Courses, lessons, and earned certificates' },
  // Phase 47 Plan 10 — Events tab title strip (EVENT-01 / 02 / 03).
  events: { title: 'Events', sub: 'Live calls, workshops, and Q&As — RSVP and join' },
};

export const SITES = [
  'abdomen-ul',
  'abdomen-ur',
  'abdomen-ll',
  'abdomen-lr',
  'thigh-l',
  'thigh-r',
  'arm-l',
  'arm-r',
] as const;

export function siteShort(s: string): string {
  return (
    (
      {
        'abdomen-ul': 'Abd UL',
        'abdomen-ur': 'Abd UR',
        'abdomen-ll': 'Abd LL',
        'abdomen-lr': 'Abd LR',
        'thigh-l': 'Thigh L',
        'thigh-r': 'Thigh R',
        'arm-l': 'Arm L',
        'arm-r': 'Arm R',
      } as Record<string, string>
    )[s] ?? s
  );
}
