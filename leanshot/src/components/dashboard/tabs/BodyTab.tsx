import {
  AlertCircle,
  ArrowLeftRight,
  Camera,
  ChartLine,
  CloudOff,
  ListChecks,
  MoreVertical,
  Plus,
  Ruler,
  Scale,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';
import { WeightChart, CompositionChart } from '@/components/dashboard/charts/SimpleCharts';
import { PhotoCompareModal } from '@/components/dashboard/modals/PhotoCompareModal';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressRing';
import { Skeleton } from '@/components/ui/Skeleton';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { useToast } from '@/hooks/useToast';
import { EmptyPhotos } from '@/illustrations/EmptyPhotos';
import { todayStr, formatShort } from '@/lib/helpers';
import { useActiveProtocolAssignment } from '@/lib/hooks/useActiveProtocolAssignment';
import { TRIAL_DATA, trialClass } from '@/lib/pharmacology';
import { softDeletePhoto } from '@/lib/photo-trash';
import { storageTransformUrl } from '@/lib/photo-url';
import { useStore } from '@/lib/store';
import type { Measurement, Photo } from '@/types';

// Phase 23 Plan 23-04 (DEBT-03) — lazy-load PhotoTrashView so it splits
// into its own chunk and does NOT grow the BodyTab entry chunk.
// Confirmed by `npm run build` producing PhotoTrashView-<hash>.js.
const PhotoTrashView = lazy(() =>
  import('@/components/dashboard/photos/PhotoTrashView').then((m) => ({
    default: m.PhotoTrashView,
  })),
);
// Phase 16 Plan 16-01 Task 4 — storageTransformUrl is the Pro-tier
// Supabase-Storage transform URL builder used inside <PhotoTile> as a
// fallback rendering path. Today (Free tier) the transformed URLs return
// 404 — the existing signed-URL flow via @/lib/signed-url-cache is the
// active path. Once Wave-0 vendor-checkpoint Task 6 (Supabase Pro upgrade)
// lands, the PhotoTile state machine can switch primary→transform with no
// further code changes here.

export function BodyTab() {
  const { t } = useTranslation('patient');
  // Phase 7 Plan 07-09 (D-06): nullable selector + early-return after hooks.
  const u = useStore((s) => s.user);
  const weights = useStore((s) => s.weights);
  const upsertWeight = useStore((s) => s.upsertWeight);
  const removeWeight = useStore((s) => s.removeWeight);
  const addMeasurement = useStore((s) => s.addMeasurement);
  const photos = useStore((s) => s.photos);
  const addPhoto = useStore((s) => s.addPhoto);
  const toast = useToast();
  // Phase 61 Plan 07 — Protocol adherence card (PROTOCOL-07 Surface 6).
  // Hook is unconditional (rules-of-hooks); null patientId returns null data immediately.
  // User ID comes from the Supabase signedIn slice (not the LeanShot User shape which lacks id).
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? null);
  const { data: activeAssignment } = useActiveProtocolAssignment(currentUserId);
  const injections = useStore((s) => s.injections);

  const adherencePct = useMemo(() => {
    if (!activeAssignment) return null;
    // Compute adherence over last N weeks (N = min(currentWeek, 4))
    const weeks = Math.min(activeAssignment.currentWeek, 4);
    const recentInjections = injections.filter((inj) => {
      const d = new Date(inj.datetime).getTime();
      return d >= Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
    });
    if (recentInjections.length === 0) return 0;
    let onTarget = 0;
    for (const inj of recentInjections) {
      // Only count mg injections against protocol steps
      if (inj.unit !== 'mg') continue;
      const loggedMg = parseFloat(inj.dose);
      if (isNaN(loggedMg)) continue;
      const injDate = new Date(inj.datetime);
      const weekOffset =
        Math.floor(
          (injDate.getTime() - new Date(activeAssignment.assignment.started_at).getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        ) + 1;
      const step = activeAssignment.allSteps.find((s) => s.week === weekOffset);
      if (!step) continue;
      const deviation = Math.abs(step.dose_mg - loggedMg) / step.dose_mg;
      if (deviation <= 0.2) onTarget += 1;
    }
    return Math.round((onTarget / recentInjections.length) * 100);
  }, [activeAssignment, injections]);

  const [compareOpen, setCompareOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Track which photo's overflow menu is open (null = none)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Optimistic set of photo_ids that have been soft-deleted locally
  const [locallyTrashed, setLocallyTrashed] = useState<Set<string>>(new Set());
  const [wForm, setWForm] = useState({ date: todayStr(), value: '', bf: '' });
  const [meas, setMeas] = useState({
    waist: '',
    hips: '',
    chest: '',
    neck: '',
    arms: '',
    thighs: '',
  });

  if (!u) return null;

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const latest = weights[weights.length - 1];
  const lost = latest ? u.startWeight - latest.weight : 0;
  const goalLoss = u.startWeight - u.goalWeight;
  const goalPct = goalLoss > 0 ? Math.min(100, Math.max(0, (lost / goalLoss) * 100)) : 0;
  const lean = latest && latest.bodyFat ? latest.weight * (1 - latest.bodyFat / 100) : null;

  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));
  const trial = TRIAL_DATA[trialClass(u.medication)];
  let trialPct = 0;
  let myPct = 0;
  if (trial && weeks > 2) {
    myPct = u.startWeight > 0 ? (lost / u.startWeight) * 100 : 0;
    for (let i = 0; i < trial.length; i++) {
      const cur = trial[i]!;
      if (cur.w >= weeks) {
        if (i === 0) {
          trialPct = (weeks / cur.w) * cur.pct;
        } else {
          const a = trial[i - 1]!;
          trialPct = a.pct + ((weeks - a.w) / (cur.w - a.w)) * (cur.pct - a.pct);
        }
        break;
      }
      if (i === trial.length - 1) trialPct = cur.pct;
    }
  }
  const ahead = myPct >= trialPct;

  const submitWeight = (): void => {
    const w = parseFloat(wForm.value);
    const bf = parseFloat(wForm.bf) || null;
    if (!wForm.date || !w) return toast(t('patient:tab.body.toast_date_weight_required'), 'error');
    upsertWeight({ date: wForm.date, weight: w, bodyFat: bf, ts: Date.now() });
    toast(t('patient:tab.body.toast_weight_saved'));
    setWForm({ date: todayStr(), value: '', bf: '' });
  };

  const submitMeasurements = (): void => {
    const entry: Measurement = { date: todayStr() };
    let any = false;
    (Object.keys(meas) as Array<keyof typeof meas>).forEach((k) => {
      const v = parseFloat(meas[k]);
      if (v) {
        (entry as unknown as Record<string, number | string>)[k] = v;
        any = true;
      }
    });
    if (!any) return toast(t('patient:tab.body.toast_one_measurement_required'), 'error');
    addMeasurement(entry);
    toast(t('patient:tab.body.toast_measurements_saved'));
    setMeas({ waist: '', hips: '', chest: '', neck: '', arms: '', thighs: '' });
  };

  // Phase 23 Plan 23-04 (DEBT-03) — soft-delete a photo (sets trashed_at = NOW()).
  // Optimistically hides the photo from the main grid immediately; if the RPC
  // fails, the photo remains visible (no partial-state inconsistency).
  const handleSoftDelete = (photo: Photo): void => {
    if (!photo.photo_id) return;
    setOpenMenuId(null);
    // Optimistic hide
    setLocallyTrashed((prev) => new Set([...prev, photo.photo_id]));
    void (async () => {
      try {
        await softDeletePhoto(photo.photo_id);
        toast(t('patient:tab.body.toast_photo_trashed'));
      } catch (err) {
        // Undo optimistic hide on failure
        setLocallyTrashed((prev) => {
          const next = new Set(prev);
          next.delete(photo.photo_id);
          return next;
        });
        console.error('[leanshot] softDeletePhoto failed', err);
        toast(t('patient:tab.body.toast_photo_trash_failed'), 'error');
      }
    })();
  };

  // Phase 6 06-04 — addPhoto(blob, meta) compresses (D-06), persists to
  // IndexedDB, and enqueues a 'upload' op drained by sync.ts's flushPhotoOps.
  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        await addPhoto(file, { date: todayStr(), weight: latest?.weight ?? null });
        toast(t('patient:tab.body.toast_photo_saved'));
      } catch (err) {
        console.error('[leanshot] addPhoto failed', err);
        toast(t('patient:tab.body.toast_photo_failed'), 'error');
      }
    })();
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <StatTile
        label={t('patient:tab.body.stat_current_weight')}
        value={latest ? latest.weight.toFixed(1) : '—'}
        unit={wU}
      />
      <StatTile label={t('patient:tab.body.stat_total_lost')} value={lost.toFixed(1)} unit={wU} />
      <StatTile
        label={t('patient:tab.body.stat_goal_progress')}
        value={`${Math.round(goalPct)}%`}
      />
      <StatTile
        label={t('patient:tab.body.stat_lean_mass')}
        value={lean ? lean.toFixed(1) : t('patient:tab.body.stat_lean_mass_log_hint')}
        unit={lean ? wU : ''}
      />

      {trial && weeks > 2 && (
        <Card span={12}>
          <CardHeader
            title={t('patient:tab.body.trial_title')}
            icon={<Target className="size-4" />}
          />
          <div className="grid grid-cols-2 gap-4 items-center">
            <div>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {t('patient:tab.body.trial_your_loss', { week: weeks })}
              </p>
              <p
                className={`text-[28px] font-extrabold tracking-tight ${ahead ? 'text-[var(--color-success)]' : ''}`}
              >
                {myPct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {t('patient:tab.body.trial_average')}
              </p>
              <p className="text-[28px] font-extrabold tracking-tight">{trialPct.toFixed(1)}%</p>
            </div>
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-3">
            {ahead ? t('patient:tab.body.trial_ahead') : t('patient:tab.body.trial_behind')}{' '}
            <em>{t('patient:tab.body.trial_source')}</em>
          </p>
        </Card>
      )}

      {/* Phase 61 Plan 07 — Protocol adherence card (PROTOCOL-07 / UI-SPEC Surface 6).
          Accent color on percentage number is the ONE permitted accent use per UI-SPEC reserved-for #5. */}
      <Card span={6}>
        <CardHeader title="Protocol adherence" icon={<ListChecks className="size-4" />} />
        {activeAssignment ? (
          <div className="space-y-1">
            <p className="text-[28px] font-semibold text-[var(--color-primary)] tabular-nums">
              {adherencePct ?? 0}%
            </p>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              last {Math.min(activeAssignment.currentWeek, 4)} week
              {Math.min(activeAssignment.currentWeek, 4) !== 1 ? 's' : ''}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">No protocol assigned</p>
        )}
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.body.log_weight_title')}
          icon={<Scale className="size-4" />}
        />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.body.label_date')}
              type="date"
              value={wForm.date}
              onChange={(e) => setWForm({ ...wForm, date: e.target.value })}
            />
            <Input
              label={t('patient:tab.body.label_weight', { unit: wU })}
              type="number"
              step="0.1"
              inputMode="decimal"
              value={wForm.value}
              onChange={(e) => setWForm({ ...wForm, value: e.target.value })}
            />
          </div>
          <Input
            label={t('patient:tab.body.label_body_fat')}
            type="number"
            step="0.1"
            inputMode="decimal"
            value={wForm.bf}
            onChange={(e) => setWForm({ ...wForm, bf: e.target.value })}
          />
          <Button block onClick={submitWeight}>
            {t('patient:tab.body.action_save_weight')}
          </Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.body.measurements_title')}
          icon={<Ruler className="size-4" />}
        />
        <div className="grid grid-cols-2 gap-3">
          {(['waist', 'hips', 'chest', 'neck', 'arms', 'thighs'] as const).map((k) => (
            <Input
              key={k}
              label={k[0]!.toUpperCase() + k.slice(1)}
              type="number"
              step="0.1"
              inputMode="decimal"
              value={meas[k]}
              onChange={(e) => setMeas({ ...meas, [k]: e.target.value })}
            />
          ))}
        </div>
        <Button block onClick={submitMeasurements} className="mt-3">
          {t('patient:tab.body.action_save_measurements')}
        </Button>
      </Card>

      <Card span={12}>
        <CardHeader
          title={t('patient:tab.body.trajectory_title')}
          icon={<ChartLine className="size-4" />}
        />
        <WeightChart />
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.body.photos_title')}
          icon={<Camera className="size-4" />}
          action={
            <div className="flex items-center gap-2">
              {/* Phase 23 Plan 23-04 (DEBT-03) — View Trash link */}
              <button
                className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex items-center gap-1"
                onClick={() => setTrashOpen(true)}
                aria-label={t('patient:tab.body.aria_view_trash')}
              >
                <Trash2 className="size-3" aria-hidden />
                {t('patient:tab.body.action_trash')}
              </button>
              {photos.length >= 2 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCompareOpen(true)}
                  leadingIcon={<ArrowLeftRight className="size-3.5" />}
                >
                  {t('patient:tab.body.action_compare')}
                </Button>
              )}
            </div>
          }
        />
        <input type="file" accept="image/*" id="photo-up" hidden onChange={onPhoto} />
        <Button
          variant="ghost"
          block
          leadingIcon={<Plus className="size-4" />}
          onClick={() => document.getElementById('photo-up')?.click()}
        >
          {t('patient:tab.body.action_add_photo')}
        </Button>
        {photos.filter((p) => !locallyTrashed.has(p.photo_id)).length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyPhotos className="w-32" />}
            title={t('patient:tab.body.photos_empty_title')}
            body={t('patient:tab.body.photos_empty_body')}
          />
        ) : (
          // Phase 16 Plan 16-01 Task 4 (BL-2 fix MOBILE-08) — wrap photo
          // grid in <VirtuosoGrid> so 200+ photo libraries don't OOM on
          // iPhone 12. Grid height is bounded so the surrounding Card
          // span={6} layout doesn't stretch indefinitely; VirtuosoGrid
          // virtualizes off-screen tiles past the visible window.
          // Phase 23 Plan 23-04 (DEBT-03) — filter locally-trashed photos
          // from the active grid (optimistic hide).
          <div className="mt-3" data-testid="body-tab-photo-grid">
            <VirtuosoGrid
              totalCount={photos.filter((p) => !locallyTrashed.has(p.photo_id)).length}
              style={{ height: '60vh' }}
              listClassName="grid grid-cols-3 gap-2"
              itemContent={(i) => {
                const activePhotos = photos.filter((p) => !locallyTrashed.has(p.photo_id));
                const p = activePhotos[i];
                if (!p) return null;
                const isMenuOpen = openMenuId === p.photo_id;
                return (
                  <SwipeToDelete
                    key={p.photo_id ?? i}
                    onDelete={() => handleSoftDelete(p)}
                    className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[var(--color-surface-elevated)] border border-[var(--color-border)] group"
                  >
                    <PhotoTile photo={p} />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent text-white px-2 py-1.5 text-[10px] font-semibold z-10">
                      <p>{formatShort(p.date)}</p>
                      {p.weight != null && (
                        <p className="opacity-80">
                          {p.weight.toFixed(1)} {wU}
                        </p>
                      )}
                    </div>
                    {/* Phase 23 Plan 23-04 — overflow menu (3-dot) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(isMenuOpen ? null : (p.photo_id ?? null));
                      }}
                      aria-label="Photo options"
                      aria-expanded={isMenuOpen}
                      className="absolute top-1.5 right-1.5 size-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity z-20"
                    >
                      <MoreVertical className="size-3.5" aria-hidden />
                    </button>
                    {/* Overflow popover */}
                    {isMenuOpen && (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stopPropagation wrapper; popover content has its own keyboard-navigable buttons
                      <div
                        className="absolute top-8 right-1.5 z-30 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg py-1 min-w-[130px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="w-full text-start px-3 py-2 text-[13px] hover:bg-[var(--color-surface-elevated)] flex items-center gap-2"
                          onClick={() => {
                            setOpenMenuId(null);
                            // Open the photo in a new tab if storage_path exists
                          }}
                          aria-label={t('patient:tab.body.aria_open_photo')}
                        >
                          {t('patient:tab.body.action_open_photo')}
                        </button>
                        <button
                          className="w-full text-start px-3 py-2 text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-surface-elevated)] flex items-center gap-2"
                          onClick={() => handleSoftDelete(p)}
                          aria-label={t('patient:tab.body.aria_move_to_trash')}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          {t('patient:tab.body.action_move_to_trash')}
                        </button>
                      </div>
                    )}
                    <span className="sr-only">{t('patient:tab.body.sr_swipe_delete')}</span>
                  </SwipeToDelete>
                );
              }}
            />
          </div>
        )}
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.body.lean_vs_fat_title')}
          icon={<ChartLine className="size-4" />}
        />
        <CompositionChart />
      </Card>

      <Card span={12}>
        <CardHeader
          title={t('patient:tab.body.history_title')}
          icon={<ListChecks className="size-4" />}
        />
        {weights.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-4">
            {t('patient:tab.body.history_empty')}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.body.col_date')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.body.col_weight')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.body.col_bf')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.body.col_delta')}
                  </th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {[...weights].reverse().map((w, idx, arr) => {
                  const next = arr[idx + 1];
                  const delta = next ? w.weight - next.weight : 0;
                  const realIdx = weights.length - 1 - idx;
                  return (
                    <tr key={w.date} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1">{formatShort(w.date)}</td>
                      <td className="py-2 px-1 font-bold numerals-tabular">
                        {w.weight.toFixed(1)} {wU}
                      </td>
                      <td className="py-2 px-1">{w.bodyFat ? `${w.bodyFat.toFixed(1)}%` : '—'}</td>
                      <td className="py-2 px-1">
                        {delta ? (
                          <span
                            className={
                              delta < 0
                                ? 'text-[var(--color-success)]'
                                : 'text-[var(--color-warning)]'
                            }
                          >
                            {delta < 0 ? '↓' : '↑'}
                            {Math.abs(delta).toFixed(1)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-1 text-end">
                        <button
                          onClick={() => removeWeight(realIdx)}
                          aria-label={t('patient:tab.body.aria_delete')}
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
        {weights.length > 0 && (
          <ProgressBar
            value={goalPct}
            className="mt-4"
            color="var(--color-success)"
            thickness="thick"
            label={t('patient:tab.body.stat_goal_progress')}
          />
        )}
      </Card>

      <PhotoCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />

      {/* Phase 23 Plan 23-04 (DEBT-03) — lazy Trash modal */}
      <Suspense fallback={null}>
        <PhotoTrashView open={trashOpen} onClose={() => setTrashOpen(false)} />
      </Suspense>
    </div>
  );
}

/**
 * Phase 6 06-04 — per-tile state matrix (06-UI-SPEC §3):
 *   - loading-signed-url → Skeleton overlay
 *   - loaded → signed-URL <img>
 *   - signed-url-failed → AlertCircle + retry button
 *   - queued-for-upload → local Blob preview + "Queued" badge
 *
 * Dynamic-imports `@/lib/signed-url-cache` + `@/lib/photo-queue` so neither
 * module appears on BodyTab's static graph (preserves bundle ceiling — sync
 * subsystem only loads after BodyTab is itself lazy-loaded by App.tsx).
 */
type TileState = 'loading' | 'loaded' | 'failed' | 'queued';

function PhotoTile({ photo }: { photo: Photo }) {
  const [state, setState] = useState<TileState>('loading');
  const [url, setUrl] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Phase 16 Plan 16-01 Task 4 — Pro-tier transform URL pre-computed for the
  // grid thumbnail size budget (200×200 cover q=75). Free tier returns 404
  // for this endpoint, so it's stored in `data-transform-url` for forensic
  // inspection + as the post-Pro-upgrade swap target. Plan 16-04+ flips
  // PhotoTile to prefer this URL over the signed-URL flow once
  // ytnsipxxmzgaebkqmokp upgrades to Pro (Wave-0 vendor-checkpoint Task 6).
  const transformedUrl = photo.storage_path
    ? storageTransformUrl(photo.storage_path, { width: 200, height: 200 })
    : null;

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;
    setState('loading');
    setUrl(null);
    (async () => {
      if (!photo.storage_path) {
        // Queued-for-upload: local Blob preview from IndexedDB.
        try {
          const { getPhotoBlob } = await import('@/lib/photo-queue');
          const blob = await getPhotoBlob(photo.photo_id);
          if (cancelled) return;
          if (blob) {
            createdObjectUrl = URL.createObjectURL(blob);
            setUrl(createdObjectUrl);
            setState('queued');
          } else {
            setState('failed');
          }
        } catch {
          if (!cancelled) setState('failed');
        }
        return;
      }
      try {
        const { getSignedPhotoUrl } = await import('@/lib/signed-url-cache');
        const signed = await getSignedPhotoUrl(photo.storage_path);
        if (cancelled) return;
        setUrl(signed);
        setState('loaded');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [photo.storage_path, photo.photo_id, retryNonce]);

  return (
    <div
      role="img"
      aria-busy={state === 'loading'}
      aria-label={
        state === 'queued'
          ? `Photo from ${photo.date}, queued for upload`
          : `Photo from ${photo.date}`
      }
      className="absolute inset-0"
    >
      {state === 'loading' && <Skeleton shape="rect" className="absolute inset-0" />}
      {url && (state === 'loaded' || state === 'queued') && (
        <img
          src={url}
          alt=""
          width={200}
          height={200}
          loading="lazy"
          decoding="async"
          data-transform-url={transformedUrl ?? undefined}
          className="w-full h-full object-cover absolute inset-0"
          onError={() => setState('failed')}
        />
      )}
      {state === 'failed' && (
        <button
          onClick={() => setRetryNonce((n) => n + 1)}
          aria-label={`Retry loading photo from ${photo.date}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[var(--color-surface-elevated)] text-[var(--color-danger)]"
        >
          <AlertCircle className="size-6" aria-hidden />
          <span className="text-[12px] font-semibold">Tap to retry</span>
        </button>
      )}
      {state === 'queued' && (
        <span
          className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-[var(--color-warning-soft,#fef3c7)] text-[var(--color-warning,#b45309)] text-[11px] font-semibold"
          aria-hidden
        >
          <CloudOff className="size-3" aria-hidden />
          Queued
        </span>
      )}
    </div>
  );
}
