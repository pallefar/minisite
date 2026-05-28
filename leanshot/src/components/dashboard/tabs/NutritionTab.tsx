import { Target, Sparkles, Droplet, ListChecks, ChartLine, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProteinChart, NoiseChart } from '@/components/dashboard/charts/SimpleCharts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useToast } from '@/hooks/useToast';
import { EmptyPlate } from '@/illustrations/EmptyPlate';
import { AIUnavailableError, RateLimitedError, callAIChat } from '@/lib/ai';
import { todayStr } from '@/lib/helpers';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function NutritionTab() {
  const { t } = useTranslation('patient');
  // Phase 7 Plan 07-09 (D-06): nullable selector + early-return after hooks.
  const u = useStore((s) => s.user);
  const meals = useStore((s) => s.meals);
  const water = useStore((s) => s.water);
  const foodNoise = useStore((s) => s.foodNoise);
  const addMeal = useStore((s) => s.addMeal);
  const removeMeal = useStore((s) => s.removeMeal);
  const setWater = useStore((s) => s.setWater);
  const setNoise = useStore((s) => s.setFoodNoise);
  const toast = useToast();

  const today = todayStr();
  const todayMeals = meals.filter((m) => m.date === today);
  const protein = todayMeals.reduce((s, m) => s + (m.protein || 0), 0);
  const calories = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const fiber = todayMeals.reduce((s, m) => s + (m.fiber || 0), 0);
  const waterToday = water[today] ?? 0;

  const [meal, setMeal] = useState({ name: '', cal: '', pro: '', fib: '', hunger: '', sat: '' });
  const [aiBusy, setAIBusy] = useState(false);

  if (!u) return null;

  const submit = (): void => {
    if (!meal.name.trim()) return toast(t('patient:tab.nutrition.toast_enter_meal'), 'error');
    addMeal({
      date: today,
      name: meal.name.trim(),
      calories: parseFloat(meal.cal) || 0,
      protein: parseFloat(meal.pro) || 0,
      fiber: parseFloat(meal.fib) || 0,
      hunger: parseInt(meal.hunger) || null,
      satisfaction: parseInt(meal.sat) || null,
      ts: Date.now(),
    });
    toast(t('patient:tab.nutrition.toast_meal_logged'));
    setMeal({ name: '', cal: '', pro: '', fib: '', hunger: '', sat: '' });
  };

  const aiEstimate = async (): Promise<void> => {
    if (!meal.name.trim()) return toast(t('patient:tab.nutrition.toast_type_meal_first'), 'error');
    setAIBusy(true);
    try {
      let buffer = '';
      await callAIChat({
        messages: [
          {
            role: 'user',
            content: `Estimate macros. Return ONLY a JSON object, no markdown.\nFormat: {"calories": number, "protein": number, "fiber": number}\n\nMeal: ${meal.name}`,
          },
        ],
        mode: 'macro-estimator',
        onText: (delta) => {
          buffer += delta;
        },
      });
      const cleaned = buffer.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { calories?: number; protein?: number; fiber?: number };
      setMeal((m) => ({
        ...m,
        cal: String(Math.round(parsed.calories ?? 0)),
        pro: String(Math.round(parsed.protein ?? 0)),
        fib: String(Math.round(parsed.fiber ?? 0)),
      }));
      toast(t('patient:tab.nutrition.toast_ai_estimated'));
    } catch (e) {
      if (e instanceof RateLimitedError)
        toast(t('patient:tab.nutrition.toast_ai_rate_limit'), 'error');
      else if (e instanceof AIUnavailableError)
        toast(t('patient:tab.nutrition.toast_ai_unavailable'), 'error');
      else toast(t('patient:tab.nutrition.toast_ai_failed'), 'error');
    } finally {
      setAIBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={12}>
        <CardHeader
          title={t('patient:tab.nutrition.targets_title')}
          icon={<Target className="size-4" />}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Macro
            label={t('patient:tab.nutrition.macro_protein')}
            value={protein}
            target={u.proteinTarget}
            unit="g"
            color="var(--color-success)"
          />
          <Macro
            label={t('patient:tab.nutrition.macro_calories')}
            value={calories}
            target={u.calorieTarget}
            unit="kcal"
            color="var(--color-primary)"
          />
          <Macro
            label={t('patient:tab.nutrition.macro_fiber')}
            value={fiber}
            target={u.fiberTarget}
            unit="g"
            color="var(--color-amber)"
          />
          <Macro
            label={t('patient:tab.nutrition.macro_water')}
            value={waterToday}
            target={u.waterTarget}
            unit={t('patient:tab.nutrition.macro_water_unit')}
            color="#5AB7C7"
          />
        </div>
      </Card>

      <Card span={7}>
        <CardHeader
          title={t('patient:tab.nutrition.log_title')}
          icon={<Sparkles className="size-4" />}
          action={<Badge tone="info">AI</Badge>}
        />
        <div className="space-y-3">
          <Input
            label={t('patient:tab.nutrition.label_what_ate')}
            placeholder="e.g. Greek yogurt with berries"
            value={meal.name}
            onChange={(e) => setMeal({ ...meal, name: e.target.value })}
          />
          <Button
            variant="ghost"
            block
            leadingIcon={<Sparkles className="size-4" />}
            loading={aiBusy}
            onClick={aiEstimate}
          >
            {aiBusy
              ? t('patient:tab.nutrition.ai_estimating')
              : t('patient:tab.nutrition.action_ai_estimate')}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.nutrition.macro_calories')}
              type="number"
              inputMode="numeric"
              value={meal.cal}
              onChange={(e) => setMeal({ ...meal, cal: e.target.value })}
            />
            <Input
              label={t('patient:tab.nutrition.label_protein_g')}
              type="number"
              inputMode="numeric"
              value={meal.pro}
              onChange={(e) => setMeal({ ...meal, pro: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.nutrition.label_fiber_g')}
              type="number"
              inputMode="numeric"
              value={meal.fib}
              onChange={(e) => setMeal({ ...meal, fib: e.target.value })}
            />
            <Input
              label={t('patient:tab.nutrition.label_hunger')}
              type="number"
              min={1}
              max={10}
              inputMode="numeric"
              value={meal.hunger}
              onChange={(e) => setMeal({ ...meal, hunger: e.target.value })}
            />
          </div>
          <Input
            label={t('patient:tab.nutrition.label_satisfaction')}
            type="number"
            min={1}
            max={10}
            inputMode="numeric"
            value={meal.sat}
            onChange={(e) => setMeal({ ...meal, sat: e.target.value })}
          />
          <Button block onClick={submit}>
            {t('patient:tab.nutrition.action_log_meal')}
          </Button>
        </div>
      </Card>

      <Card span={5}>
        <CardHeader
          title={t('patient:tab.nutrition.water_noise_title')}
          icon={<Droplet className="size-4" />}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
          {t('patient:tab.nutrition.water_label')}
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Array.from({ length: Math.max(u.waterTarget, waterToday) + 2 }, (_, i) => i + 1).map(
            (n) => (
              <button
                key={n}
                aria-label={t('patient:tab.nutrition.aria_set_water', { n })}
                onClick={() => setWater(today, n)}
                className={cn(
                  'size-9 rounded-xl border text-[16px] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  n <= waterToday
                    ? 'bg-[#5AB7C7]/15 border-[#5AB7C7] text-[#5AB7C7]'
                    : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-tertiary)]',
                )}
              >
                <Droplet className="size-4" fill={n <= waterToday ? 'currentColor' : 'none'} />
              </button>
            ),
          )}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
          {t('patient:tab.nutrition.food_noise_label')}
        </p>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const active = foodNoise[today] === n;
            return (
              <button
                key={n}
                aria-label={t('patient:tab.nutrition.aria_food_noise', { n })}
                onClick={() => setNoise(today, n)}
                className={cn(
                  'size-9 rounded-xl text-[13px] font-bold inline-flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  active
                    ? 'bg-[#5AB7C7] border-[#5AB7C7] text-white'
                    : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-secondary)]',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2">
          {t('patient:tab.nutrition.food_noise_hint')}
        </p>
      </Card>

      <Card span={12}>
        <CardHeader
          title={t('patient:tab.nutrition.meals_title')}
          icon={<ListChecks className="size-4" />}
        />
        {todayMeals.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyPlate className="w-32" />}
            title={t('patient:tab.nutrition.meals_empty_title')}
            body={t('patient:tab.nutrition.meals_empty_body')}
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.nutrition.col_meal')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.nutrition.col_cal')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.nutrition.col_pro')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.nutrition.col_fib')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.nutrition.col_hunger_sat')}
                  </th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {todayMeals.map((m) => {
                  const realIdx = meals.indexOf(m);
                  return (
                    <tr key={m.ts} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1 font-semibold">{m.name}</td>
                      <td className="py-2 px-1 numerals-tabular">{m.calories || 0}</td>
                      <td className="py-2 px-1 numerals-tabular">{m.protein || 0}g</td>
                      <td className="py-2 px-1 numerals-tabular">{m.fiber || 0}g</td>
                      <td className="py-2 px-1 text-[var(--color-text-secondary)]">
                        {m.hunger ?? '—'}→{m.satisfaction ?? '—'}
                      </td>
                      <td className="py-2 px-1 text-end">
                        <button
                          onClick={() => removeMeal(realIdx)}
                          aria-label={t('patient:tab.nutrition.aria_delete_meal')}
                          className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-elevated)] inline-flex items-center justify-center"
                        >
                          <X className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.nutrition.protein_chart_title')}
          icon={<ChartLine className="size-4" />}
        />
        <ProteinChart />
      </Card>
      <Card span={6}>
        <CardHeader
          title={t('patient:tab.nutrition.noise_chart_title')}
          icon={<ChartLine className="size-4" />}
        />
        <NoiseChart />
      </Card>
    </div>
  );
}

function Macro({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="flex flex-col items-center text-center gap-1">
      <ProgressRing value={pct} size={84} strokeWidth={6} color={color}>
        <div>
          <p className="text-[15px] font-extrabold leading-tight numerals-tabular">
            {Math.round(value)}
          </p>
          <p className="text-[9px] text-[var(--color-text-tertiary)] font-semibold">
            /{target}
            {unit}
          </p>
        </div>
      </ProgressRing>
      <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">{label}</p>
    </div>
  );
}
