import { Target, Sparkles, Droplet, ListChecks, ChartLine, X } from 'lucide-react';
import { useState } from 'react';
import { ProteinChart, NoiseChart } from '@/components/dashboard/charts/SimpleCharts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useToast } from '@/hooks/useToast';
import { AIUnavailableError, RateLimitedError, callAIChat } from '@/lib/ai';
import { todayStr } from '@/lib/helpers';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function NutritionTab() {
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
    if (!meal.name.trim()) return toast('Enter what you ate', 'error');
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
    toast('Meal logged');
    setMeal({ name: '', cal: '', pro: '', fib: '', hunger: '', sat: '' });
  };

  const aiEstimate = async (): Promise<void> => {
    if (!meal.name.trim()) return toast('Type what you ate first', 'error');
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
      toast('AI estimated');
    } catch (e) {
      if (e instanceof RateLimitedError)
        toast('Hit the AI rate limit — try again in a minute', 'error');
      else if (e instanceof AIUnavailableError)
        toast('AI is unavailable right now — enter manually', 'error');
      else toast('AI failed — enter manually', 'error');
    } finally {
      setAIBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={12}>
        <CardHeader title="Today's targets" icon={<Target className="size-4" />} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Macro
            label="Protein"
            value={protein}
            target={u.proteinTarget}
            unit="g"
            color="var(--color-success)"
          />
          <Macro
            label="Calories"
            value={calories}
            target={u.calorieTarget}
            unit="kcal"
            color="var(--color-primary)"
          />
          <Macro
            label="Fiber"
            value={fiber}
            target={u.fiberTarget}
            unit="g"
            color="var(--color-amber)"
          />
          <Macro
            label="Water"
            value={waterToday}
            target={u.waterTarget}
            unit="cups"
            color="#5AB7C7"
          />
        </div>
      </Card>

      <Card span={7}>
        <CardHeader
          title="Quick log meal"
          icon={<Sparkles className="size-4" />}
          action={<Badge tone="info">AI</Badge>}
        />
        <div className="space-y-3">
          <Input
            label="What did you eat?"
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
            {aiBusy ? 'Estimating…' : 'Estimate macros with AI'}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Calories"
              type="number"
              inputMode="numeric"
              value={meal.cal}
              onChange={(e) => setMeal({ ...meal, cal: e.target.value })}
            />
            <Input
              label="Protein (g)"
              type="number"
              inputMode="numeric"
              value={meal.pro}
              onChange={(e) => setMeal({ ...meal, pro: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Fiber (g)"
              type="number"
              inputMode="numeric"
              value={meal.fib}
              onChange={(e) => setMeal({ ...meal, fib: e.target.value })}
            />
            <Input
              label="Hunger (1–10)"
              type="number"
              min={1}
              max={10}
              inputMode="numeric"
              value={meal.hunger}
              onChange={(e) => setMeal({ ...meal, hunger: e.target.value })}
            />
          </div>
          <Input
            label="Satisfaction after"
            type="number"
            min={1}
            max={10}
            inputMode="numeric"
            value={meal.sat}
            onChange={(e) => setMeal({ ...meal, sat: e.target.value })}
          />
          <Button block onClick={submit}>
            Log meal
          </Button>
        </div>
      </Card>

      <Card span={5}>
        <CardHeader title="Water & food noise" icon={<Droplet className="size-4" />} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
          Water (cups, 8oz)
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Array.from({ length: Math.max(u.waterTarget, waterToday) + 2 }, (_, i) => i + 1).map(
            (n) => (
              <button
                key={n}
                aria-label={`Set water to ${n}`}
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
          Food noise (1=silent, 10=loud)
        </p>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const active = foodNoise[today] === n;
            return (
              <button
                key={n}
                aria-label={`Food noise ${n}`}
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
          Lower = the medication is working.
        </p>
      </Card>

      <Card span={12}>
        <CardHeader title="Today's meals" icon={<ListChecks className="size-4" />} />
        {todayMeals.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-4">
            No meals today.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2 px-1">Meal</th>
                  <th className="text-left font-semibold py-2 px-1">Cal</th>
                  <th className="text-left font-semibold py-2 px-1">Pro</th>
                  <th className="text-left font-semibold py-2 px-1">Fib</th>
                  <th className="text-left font-semibold py-2 px-1">H→S</th>
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
                      <td className="py-2 px-1 text-right">
                        <button
                          onClick={() => removeMeal(realIdx)}
                          aria-label="Delete meal"
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
        <CardHeader title="Protein · 14 days" icon={<ChartLine className="size-4" />} />
        <ProteinChart />
      </Card>
      <Card span={6}>
        <CardHeader title="Food noise · 14 days" icon={<ChartLine className="size-4" />} />
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
