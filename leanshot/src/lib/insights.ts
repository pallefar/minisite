/**
 * Pure rule engine for "Smart insights" + "Today's focus" cards.
 * Ported from v1 generateInsightsArray (leanshot.html:3119) and refactored
 * to consume the typed store.
 */
import type { PersistedState } from './storage';
import { todayStr } from './helpers';
import { SUPPS_DEFAULT, SYMPTOMS_LIST } from './constants';

export interface Insight {
  /** Lucide icon name for the leading glyph. */
  icon: string;
  title: string;
  body: string;
  /** Tone influences the surface color used by the InsightCard. */
  tone: 'info' | 'warning' | 'success' | 'neutral';
  cta?: { label: string; tab: string };
}

export function generateInsights(s: PersistedState): Insight[] {
  const u = s.user;
  if (!u) return [];
  const out: Insight[] = [];
  const wU = u.units === 'metric' ? 'kg' : 'lb';

  // Pace
  if (s.weights.length >= 4) {
    const first = s.weights[0]!;
    const last = s.weights[s.weights.length - 1]!;
    const days = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000);
    const ratePerWeek = ((first.weight - last.weight) / days) * 7;
    if (ratePerWeek > (u.units === 'metric' ? 1 : 2.2)) {
      out.push({
        icon: 'TriangleAlert', tone: 'warning',
        title: 'Pace check',
        body: `You're losing ${ratePerWeek.toFixed(1)} ${wU}/week — faster than ideal for muscle preservation. Make sure you're hitting protein and lifting weights.`,
      });
    } else if (ratePerWeek > 0) {
      out.push({
        icon: 'TrendingDown', tone: 'success',
        title: 'Steady progress',
        body: `Losing about ${ratePerWeek.toFixed(1)} ${wU}/week — sustainable pace.`,
      });
    }
  }

  // Protein
  const last7Meals = s.meals.filter((m) => Date.now() - new Date(m.date).getTime() < 7 * 86_400_000);
  if (last7Meals.length > 0) {
    const dailyProtein: Record<string, number> = {};
    for (const m of last7Meals) dailyProtein[m.date] = (dailyProtein[m.date] ?? 0) + (m.protein || 0);
    const values = Object.values(dailyProtein);
    const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    if (avg < u.proteinTarget * 0.7) {
      out.push({
        icon: 'Beef', tone: 'warning',
        title: 'Protein gap',
        body: `Averaging ${Math.round(avg)}g/day — below your ${u.proteinTarget}g target. A whey scoop adds 25g instantly.`,
        cta: { label: 'Log a meal', tab: 'nutrition' },
      });
    } else if (avg >= u.proteinTarget) {
      out.push({
        icon: 'Dumbbell', tone: 'success',
        title: 'Crushing protein',
        body: `${Math.round(avg)}g/day this week. Exactly what protects your muscle.`,
      });
    }
  }

  // Symptoms patterns
  if (s.symptoms.length >= 3 && s.injections.length >= 2) {
    const recent = s.symptoms.filter((sx) => Date.now() - new Date(sx.date).getTime() < 14 * 86_400_000);
    if (recent.length > 5) {
      const counts: Record<string, number> = {};
      for (const sx of recent) counts[sx.symptom] = (counts[sx.symptom] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const sym = SYMPTOMS_LIST.find((x) => x.id === top[0]);
        if (sym) {
          out.push({
            icon: 'Search', tone: 'info',
            title: `${sym.name} pattern`,
            body: `${sym.name} ${top[1]}× in 2 weeks. Track if it spikes after dose changes.`,
            cta: { label: 'See symptoms', tab: 'symptoms' },
          });
        }
      }
    }
  }

  // Workouts
  const lastWO = s.workouts[0];
  const daysSinceWO = lastWO ? Math.floor((Date.now() - new Date(lastWO.date).getTime()) / 86_400_000) : 999;
  if (daysSinceWO > 4 && s.workouts.length > 0) {
    out.push({
      icon: 'Dumbbell', tone: 'warning',
      title: 'Time to lift',
      body: `${daysSinceWO} days since your last workout. Resistance training keeps weight loss as fat loss.`,
      cta: { label: 'Log workout', tab: 'activity' },
    });
  } else if (s.workouts.length === 0 && s.weights.length >= 3) {
    out.push({
      icon: 'Dumbbell', tone: 'info',
      title: 'Add resistance training',
      body: 'You\'re losing without lifting. Up to 40% of GLP-1 weight loss can come from muscle. Even 2 sessions/wk helps.',
      cta: { label: 'Log workout', tab: 'activity' },
    });
  }

  // Hydration
  const today = todayStr();
  if ((s.water[today] ?? 0) < u.waterTarget * 0.5 && new Date().getHours() > 14) {
    out.push({
      icon: 'Droplet', tone: 'info',
      title: 'Hydration low',
      body: `Only ${s.water[today] ?? 0} cups today. GLP-1s blunt thirst — sip throughout the day.`,
      cta: { label: 'Add water', tab: 'nutrition' },
    });
  }

  // Mood
  const recentMood = s.mood.slice(-7);
  if (recentMood.length >= 3) {
    const avg = recentMood.reduce((acc, m) => acc + m.mood, 0) / recentMood.length;
    if (avg < 2.5) {
      out.push({
        icon: 'HeartHandshake', tone: 'warning',
        title: 'Mood check',
        body: 'Mood low this week. Mood shifts can happen on GLP-1s — talk to your doctor if it persists.',
      });
    }
  }

  return out;
}

/** "Daily focus" — pick the single most important action for today. */
export function pickFocus(s: PersistedState): {
  title: string;
  body: string;
  cta: { label: string; tab: string };
  icon: string;
} {
  const u = s.user;
  if (!u) {
    return {
      title: 'Welcome to your dashboard',
      body: 'Log your first weight to start your trajectory.',
      cta: { label: 'Open Body', tab: 'body' },
      icon: 'Sparkles',
    };
  }
  const today = todayStr();
  const dayOfWeek = new Date().getDay();
  const lastInj = s.injections[0];
  const daysSinceInj = lastInj
    ? Math.floor((Date.now() - new Date(lastInj.datetime).getTime()) / 86_400_000)
    : 999;

  // 1) Injection day priority
  if (dayOfWeek === u.injectionDay && daysSinceInj >= 6) {
    return {
      title: 'Today is shot day',
      body: 'Rotate your site, log it after, and watch your med-level reset.',
      cta: { label: 'Log injection', tab: 'medication' },
      icon: 'Syringe',
    };
  }

  // 2) Vial running out
  const activeVial = s.vials.find((v) => v.dosesUsed < v.dosesPerVial);
  const remaining = activeVial ? activeVial.dosesPerVial - activeVial.dosesUsed : 0;
  if (activeVial && remaining <= 1) {
    return {
      title: 'You\'re almost out of vial',
      body: `Only ${remaining} dose${remaining === 1 ? '' : 's'} left. Refill before the gap.`,
      cta: { label: 'See supply', tab: 'medication' },
      icon: 'PackageOpen',
    };
  }

  // 3) Protein
  const todayMeals = s.meals.filter((m) => m.date === today);
  const todayProtein = todayMeals.reduce((acc, m) => acc + (m.protein || 0), 0);
  if (todayProtein < u.proteinTarget * 0.4 && new Date().getHours() >= 12) {
    return {
      title: 'Protein is your priority',
      body: `${Math.round(todayProtein)}g logged so far. ${Math.round(u.proteinTarget - todayProtein)}g left to hit your target — preserve that muscle.`,
      cta: { label: 'Log meal', tab: 'nutrition' },
      icon: 'Beef',
    };
  }

  // 4) Supplements not yet logged
  const todaySupps = s.supplements[today] ?? {};
  const taken = Object.values(todaySupps).filter(Boolean).length;
  if (taken < SUPPS_DEFAULT.length * 0.3 && new Date().getHours() >= 9) {
    return {
      title: 'Run your stack',
      body: `${taken}/${SUPPS_DEFAULT.length} supplements logged today. The right ones smooth your week.`,
      cta: { label: 'Open stack', tab: 'supplements' },
      icon: 'PillBottle',
    };
  }

  // 5) Daily weight
  const hasTodayWeight = s.weights.some((w) => w.date === today);
  if (!hasTodayWeight && new Date().getHours() >= 7) {
    return {
      title: 'Weigh in',
      body: 'A daily weight reading keeps your trajectory honest. Same time, same conditions.',
      cta: { label: 'Log weight', tab: 'body' },
      icon: 'Scale',
    };
  }

  // 6) Default — celebrate
  return {
    title: 'You\'re ahead of today',
    body: 'Protein in. Stack run. Shot tracked. Take a walk and stack tomorrow\'s win.',
    cta: { label: 'See your wins', tab: 'insights' },
    icon: 'Sparkles',
  };
}
