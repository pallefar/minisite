/**
 * Phase 31 Plan 31-05 Task 4 — OnboardingTab
 *
 * Onboarding flow builder for clinic owners.
 *
 * Surfaces:
 *   Owner view (surfaceCheck('onboarding.edit') = true):
 *     - Left: SortableTreePanel<OnboardingStepNode> step list + add-step palette
 *     - Right: Patient preview pane (ProgressIndicator + step content)
 *     - Version history Select + Restore this version button
 *     - Save flow → save_org_onboarding_flow RPC
 *
 *   Clinician read-only view (surfaceCheck = false):
 *     - Static step list, no edit controls
 *     - "Only workspace owners can edit the onboarding flow."
 *
 * Behaviors per UI-SPEC §Surface 2:
 *   - SortableTreePanel drag/keyboard reorder for non-locked steps
 *   - Toggle Skippable pill on allowed steps
 *   - Edit modal (welcome + intro_card only) — "Apply changes" mutates local state
 *   - Add step: inline palette filtered to steps not already present
 *   - Remove step: optimistic + 6s undo toast pattern
 *   - Version history: select prior version → "Restore this version" button
 *   - Save flow: calls save_org_onboarding_flow, shows toast with version N
 */
import {
  FileCheck,
  Image,
  Map,
  Pencil,
  Pill as PillIcon,
  Plus,
  Scale,
  Sparkles,
  Stethoscope,
  Target,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ProgressIndicator } from '@/components/onboarding/ProgressIndicator';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';
import { surfaceCheck } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import {
  EDITABLE_STEP_TYPES,
  MANDATORY_STEP_TYPES,
  STEP_TYPES,
  type OnboardingStepNode,
  type StepType,
} from '@/types/onboarding-step';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type LucideIcon = typeof Sparkles;

const STEP_TYPE_ICONS: Record<StepType, LucideIcon> = {
  welcome:       Sparkles,
  intro_card:    Image,
  medication:    PillIcon,
  goals:         Target,
  body_stats:    Scale,
  consent:       FileCheck,
  doctor_invite: Stethoscope,
  tour:          Map,
};

const STEP_TYPE_LABELS: Record<StepType, string> = {
  welcome:       'Welcome',
  intro_card:    'Intro card',
  medication:    'Medication',
  goals:         'Goals',
  body_stats:    'Body stats',
  consent:       'Consent',
  doctor_invite: 'Doctor invite',
  tour:          'Tour',
};

const STEP_TYPE_DESCRIPTIONS: Record<StepType, string> = {
  welcome:       'Personal greeting from your clinic.',
  intro_card:    'A custom card with optional image.',
  medication:    'Medication logging setup (required).',
  goals:         'Help patients set their health goals.',
  body_stats:    'Collect initial weight and body stats.',
  consent:       'Patient data consent agreement (required).',
  doctor_invite: 'Invite the patient\'s doctor.',
  tour:          'Quick walkthrough of the app.',
};

const MANDATORY_TYPES = new Set<StepType>(MANDATORY_STEP_TYPES);
const SKIPPABLE_TYPES = new Set<StepType>(
  STEP_TYPES.filter((t) => !MANDATORY_TYPES.has(t)),
);
const EDITABLE_TYPES = new Set<StepType>(EDITABLE_STEP_TYPES);

// Steps that appear in the "Add step" palette (medication + consent NEVER added via palette)
const PALETTE_ORDER: readonly StepType[] = [
  'welcome',
  'intro_card',
  'goals',
  'body_stats',
  'doctor_invite',
  'tour',
];

const DEFAULT_STEPS_TEMPLATE: readonly StepType[] = [
  'welcome',
  'intro_card',
  'medication',
  'goals',
  'body_stats',
  'consent',
  'doctor_invite',
  'tour',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingTabProps {
  orgId: string;
}

interface VersionRecord {
  id: string;
  version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Client-side validation
// ---------------------------------------------------------------------------

function validateSteps(steps: OnboardingStepNode[]): string | null {
  for (const mandatory of MANDATORY_STEP_TYPES) {
    if (!steps.some((s) => s.type === mandatory)) {
      return `Missing required step: ${STEP_TYPE_LABELS[mandatory]}`;
    }
  }
  for (const s of steps) {
    if (!STEP_TYPES.includes(s.type)) {
      return `Unknown step type: ${s.type}`;
    }
    if (s.custom && !EDITABLE_TYPES.has(s.type)) {
      return `Custom content is not allowed on step type: ${s.type}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ReadOnlyView sub-component (clinician view)
// ---------------------------------------------------------------------------

function ReadOnlyView({ orgId }: { orgId: string }) {
  const [steps, setSteps] = useState<OnboardingStepNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('org_onboarding_flows')
        .select('id, steps, version')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .maybeSingle();
      if (!cancelled && data?.steps) {
        setSteps(data.steps as OnboardingStepNode[]);
      } else if (!cancelled) {
        // Default steps for preview
        setSteps(
          DEFAULT_STEPS_TEMPLATE.map((t) => ({
            id: crypto.randomUUID(),
            type: t,
          })),
        );
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-11 bg-[var(--color-surface-elevated)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-[16px] font-semibold text-[var(--color-text)]">
          Current patient onboarding flow
        </h1>
      </header>
      <ul aria-label="Current onboarding steps" className="space-y-1">
        {steps.map((step) => {
          const Icon = STEP_TYPE_ICONS[step.type] ?? Sparkles;
          return (
            <li
              key={step.id}
              className="flex items-center gap-2 h-11 px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              <Icon size={18} className="text-[var(--color-text-secondary)] shrink-0" aria-hidden />
              <span className="text-[13px] font-medium text-[var(--color-text)] flex-1">
                {STEP_TYPE_LABELS[step.type]}
              </span>
              {MANDATORY_TYPES.has(step.type) && (
                <Badge tone="neutral" className="text-[10px]">Required</Badge>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-[var(--color-text-tertiary)] italic mt-4">
        Only workspace owners can edit the onboarding flow.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatientPreviewPane sub-component
// ---------------------------------------------------------------------------

function PatientPreviewPane({ steps }: { steps: OnboardingStepNode[] }) {
  const [previewIdx, setPreviewIdx] = useState(0);

  const safeIdx = Math.min(previewIdx, Math.max(0, steps.length - 1));
  const currentStep = steps[safeIdx];

  return (
    <Card variant="elevated" className="md:sticky md:top-24">
      <div
        role="img"
        aria-label="Preview of patient onboarding flow"
      >
        <p className="text-[12px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
          Patient view
        </p>
        {steps.length === 0 ? (
          <EmptyState
            title="No steps yet"
            body="Add steps to build your patient onboarding experience."
            inline
          />
        ) : (
          <>
            <ProgressIndicator step={safeIdx + 1} total={steps.length} />
            <div className="min-h-[80px] mb-4">
              <p className="text-[14px] font-semibold text-[var(--color-text)] mb-1">
                {currentStep?.custom?.title ?? STEP_TYPE_LABELS[currentStep?.type ?? 'welcome']}
              </p>
              {currentStep?.custom?.body ? (
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {currentStep.custom.body}
                </p>
              ) : (
                <p className="text-[13px] text-[var(--color-text-tertiary)] italic">
                  (LeanShot default content)
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Previous step"
                disabled={safeIdx <= 0}
                onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
              >
                ←
              </IconButton>
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                Step {safeIdx + 1} of {steps.length}
              </span>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Next step"
                disabled={safeIdx >= steps.length - 1}
                onClick={() => setPreviewIdx((i) => Math.min(steps.length - 1, i + 1))}
              >
                →
              </IconButton>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// StepEditorModal sub-component (welcome + intro_card only)
// ---------------------------------------------------------------------------

interface StepEditorModalProps {
  step: OnboardingStepNode | null;
  onClose: () => void;
  onApply: (updated: OnboardingStepNode) => void;
  orgId: string;
}

function StepEditorModal({ step, onClose, onApply, orgId }: StepEditorModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Sync staged state when step changes
  useEffect(() => {
    if (!step) return;
    setTitle(step.custom?.title ?? '');
    setBody(step.custom?.body ?? '');
    setImageUrl(step.custom?.image_url ?? null);
  }, [step]);

  const handleApply = () => {
    if (!step) return;
    onApply({
      ...step,
      custom: {
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(step.type === 'intro_card' && imageUrl ? { image_url: imageUrl } : {}),
      },
    });
    onClose();
  };

  const handleImageUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast('Image must be under 2 MB.', 'error');
      return;
    }
    setUploadingImage(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'branding-asset-upload-url',
        { body: { p_org_id: orgId, p_kind: 'intro_card' } },
      );
      if (error || !data?.upload_url) {
        toast('Image upload failed. Please try again.', 'error');
        return;
      }
      const res = await fetch(data.upload_url as string, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!res.ok) {
        toast('Image upload failed. Please try again.', 'error');
        return;
      }
      setImageUrl(data.public_url as string);
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <Modal
      open={step !== null}
      onClose={onClose}
      title={`Edit ${step ? STEP_TYPE_LABELS[step.type] : ''}`}
      size="md"
      mobileFullscreen
    >
      <div className="space-y-4">
        <Input
          label="Step title"
          placeholder="Your clinic's personal greeting"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          aria-label="Step title (max 60 characters)"
        />
        <Textarea
          label="Body text"
          placeholder="Welcome message for your patients…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={200}
        />
        {step?.type === 'intro_card' && (
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">
              Card image (optional)
            </p>
            {imageUrl ? (
              <div className="flex items-center gap-2">
                <img
                  src={imageUrl}
                  alt="Card preview"
                  className="w-16 h-16 rounded-xl object-cover border border-[var(--color-border)]"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImageUrl(null)}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={uploadingImage}
                  aria-busy={uploadingImage}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadingImage ? 'Uploading…' : 'Upload image'}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleApply}>
            Apply changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Undo state for remove
// ---------------------------------------------------------------------------

interface UndoState {
  removedStep: OnboardingStepNode;
  removedIdx: number;
  timerId: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Main owner-view component
// ---------------------------------------------------------------------------

// Use a simple integer counter to force re-renders when needed
type Action =
  | { type: 'SET_STEPS'; steps: OnboardingStepNode[] }
  | { type: 'REORDER'; steps: OnboardingStepNode[] };

function stepsReducer(state: OnboardingStepNode[], action: Action): OnboardingStepNode[] {
  switch (action.type) {
    case 'SET_STEPS':
    case 'REORDER':
      return action.steps;
    default:
      return state;
  }
}

export function OnboardingTab({ orgId }: OnboardingTabProps) {
  const canEdit = surfaceCheck('onboarding.edit');

  if (!canEdit) {
    return <ReadOnlyView orgId={orgId} />;
  }

  return <OnboardingTabOwner orgId={orgId} />;
}

function OnboardingTabOwner({ orgId }: { orgId: string }) {
  const toast = useToast();
  const reducedMotion = useReducedMotion();

  const [steps, dispatchSteps] = useReducer(stepsReducer, []);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<OnboardingStepNode | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch initial data
  // ---------------------------------------------------------------------------
  const fetchVersionHistory = useCallback(async () => {
    const { data } = await supabase
      .from('org_onboarding_flows')
      .select('id, version, created_at')
      .eq('org_id', orgId)
      .order('version', { ascending: false })
      .limit(5);
    if (data) setVersions(data as VersionRecord[]);
    return data as VersionRecord[] | null;
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);

      // Parallel fetch: active flow + version history
      const [activeResult, versionsResult] = await Promise.all([
        supabase
          .from('org_onboarding_flows')
          .select('id, steps, version')
          .eq('org_id', orgId)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('org_onboarding_flows')
          .select('id, version, created_at')
          .eq('org_id', orgId)
          .order('version', { ascending: false })
          .limit(5),
      ]);

      if (cancelled) return;

      if (activeResult.data?.steps) {
        dispatchSteps({
          type: 'SET_STEPS',
          steps: activeResult.data.steps as OnboardingStepNode[],
        });
        setActiveFlowId(activeResult.data.id as string);
      } else {
        // Initialize from default template
        dispatchSteps({
          type: 'SET_STEPS',
          steps: DEFAULT_STEPS_TEMPLATE.map((t) => ({
            id: crypto.randomUUID(),
            type: t,
          })),
        });
        setActiveFlowId(null);
      }

      if (versionsResult.data) {
        setVersions(versionsResult.data as VersionRecord[]);
        if (versionsResult.data.length > 0) {
          setSelectedVersionId(versionsResult.data[0].id);
        }
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Step handlers
  // ---------------------------------------------------------------------------

  const handleReorder = (next: OnboardingStepNode[]) => {
    dispatchSteps({ type: 'REORDER', steps: next });
  };

  const handleToggleSkip = (id: string) => {
    dispatchSteps({
      type: 'SET_STEPS',
      steps: steps.map((s) =>
        s.id === id && SKIPPABLE_TYPES.has(s.type) ? { ...s, skip: !s.skip } : s,
      ),
    });
  };

  const handleRemoveStep = (id: string, idx: number) => {
    const step = steps[idx];
    if (!step) return;
    const next = steps.filter((s) => s.id !== id);
    dispatchSteps({ type: 'SET_STEPS', steps: next });

    // Cancel existing undo
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const timerId = setTimeout(() => setUndoState(null), 6000);
    undoTimerRef.current = timerId;
    setUndoState({ removedStep: step, removedIdx: idx, timerId });
    toast('Step removed.', 'info');
  };

  const handleUndoRemove = () => {
    if (!undoState) return;
    const next = [...steps];
    const insertIdx = Math.min(undoState.removedIdx, next.length);
    next.splice(insertIdx, 0, undoState.removedStep);
    dispatchSteps({ type: 'SET_STEPS', steps: next });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState(null);
  };

  const handleAddStep = (type: StepType) => {
    dispatchSteps({
      type: 'SET_STEPS',
      steps: [...steps, { id: crypto.randomUUID(), type }],
    });
    setPaletteOpen(false);
  };

  const handleApplyEdit = (updated: OnboardingStepNode) => {
    dispatchSteps({
      type: 'SET_STEPS',
      steps: steps.map((s) => (s.id === updated.id ? updated : s)),
    });
    setEditingStep(null);
  };

  // ---------------------------------------------------------------------------
  // Save / Restore
  // ---------------------------------------------------------------------------

  const handleSaveFlow = async () => {
    const validationError = validateSteps(steps);
    if (validationError) {
      toast(validationError, 'error');
      return;
    }
    setSaving(true);
    try {
      const { data: newFlowId, error } = await supabase.rpc('save_org_onboarding_flow', {
        p_org_id: orgId,
        p_steps: steps,
      });
      if (error) {
        toast('Something went wrong. Please try again.', 'error');
        return;
      }
      // Refetch version history to find the new version number
      const updated = await fetchVersionHistory();
      const newRow = updated?.find(
        (v) => v.id === (newFlowId as string),
      );
      const versionN = newRow?.version ?? '?';
      toast(
        `Saved version ${versionN} — new patients will see this flow.`,
        'success',
      );
      setActiveFlowId(newFlowId as string);
      if (updated && updated.length > 0) {
        setSelectedVersionId(updated[0].id);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreVersion = async () => {
    if (!selectedVersionId) return;
    const versionRecord = versions.find((v) => v.id === selectedVersionId);
    setRestoring(true);
    try {
      const { error } = await supabase.rpc('activate_onboarding_flow_version', {
        p_org_id: orgId,
        p_flow_id: selectedVersionId,
      });
      if (error) {
        toast('Restore failed. Please try again.', 'error');
        return;
      }
      toast(
        `Flow version ${versionRecord?.version ?? '?'} restored — new patients will see this flow.`,
        'success',
      );
      // Refetch active flow
      const { data: activeData } = await supabase
        .from('org_onboarding_flows')
        .select('id, steps, version')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .maybeSingle();
      if (activeData?.steps) {
        dispatchSteps({
          type: 'SET_STEPS',
          steps: activeData.steps as OnboardingStepNode[],
        });
        setActiveFlowId(activeData.id as string);
      }
      await fetchVersionHistory();
    } finally {
      setRestoring(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render step row (passed to SortableTreePanel)
  // ---------------------------------------------------------------------------

  const renderStepRow = useCallback(
    (step: OnboardingStepNode, idx: number, _isDragging: boolean) => {
      const Icon = STEP_TYPE_ICONS[step.type] ?? Sparkles;
      const isMandatory = MANDATORY_TYPES.has(step.type);
      const isSkippable = SKIPPABLE_TYPES.has(step.type);
      const isEditable = EDITABLE_TYPES.has(step.type);

      return (
        <div className="flex items-center gap-2 h-11 flex-1 pe-1">
          <Icon size={18} className="text-[var(--color-text-secondary)] shrink-0" aria-hidden />
          <span className="text-[13px] font-medium text-[var(--color-text)] flex-1 truncate">
            {step.custom?.title ?? STEP_TYPE_LABELS[step.type]}
          </span>
          {isMandatory && (
            <Badge tone="neutral" className="text-[10px] shrink-0">
              Required
            </Badge>
          )}
          {isSkippable && (
            <Pill
              size="sm"
              active={!step.skip}
              aria-pressed={!step.skip}
              aria-label={`${STEP_TYPE_LABELS[step.type]} skippable: ${!step.skip ? 'yes' : 'no'}`}
              onClick={() => handleToggleSkip(step.id)}
              className="text-[10px] shrink-0"
            >
              {step.skip ? 'Required' : 'Skippable'}
            </Pill>
          )}
          {isEditable && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`Edit ${STEP_TYPE_LABELS[step.type]} step`}
              onClick={() => setEditingStep(step)}
            >
              <Pencil size={13} aria-hidden />
            </IconButton>
          )}
          {!isMandatory && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`Remove ${STEP_TYPE_LABELS[step.type]} step`}
              className="text-[var(--color-danger)]"
              onClick={() => handleRemoveStep(step.id, idx)}
            >
              <Trash2 size={13} aria-hidden />
            </IconButton>
          )}
        </div>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps],
  );

  // ---------------------------------------------------------------------------
  // Add-step palette
  // ---------------------------------------------------------------------------

  const availablePaletteSteps = PALETTE_ORDER.filter(
    (t) => !steps.some((s) => s.type === t),
  );

  // ---------------------------------------------------------------------------
  // Relative date formatting
  // ---------------------------------------------------------------------------
  const formatRelativeDate = (isoStr: string): string => {
    try {
      const d = new Date(isoStr);
      const diffMs = Date.now() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return d.toLocaleDateString();
    } catch {
      return isoStr;
    }
  };

  // ---------------------------------------------------------------------------
  // Validation for Save button
  // ---------------------------------------------------------------------------
  const saveDisabled = saving || validateSteps(steps) !== null;
  const canRestore =
    selectedVersionId &&
    selectedVersionId !== activeFlowId &&
    !restoring;

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-11 bg-[var(--color-surface-elevated)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Header */}
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
          Patient onboarding flow
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          Customize the steps new patients go through when joining your clinic.
        </p>
      </header>

      {/* Undo banner */}
      {undoState && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[13px]"
        >
          <span className="text-[var(--color-text-secondary)]">Step removed.</span>
          <button
            type="button"
            onClick={handleUndoRemove}
            className="text-[var(--color-primary)] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
          >
            Undo
          </button>
        </div>
      )}

      {/* Version history */}
      {versions.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="version-history-select" className="text-[13px] font-semibold text-[var(--color-text)]">
            Version history
          </label>
          <Select
            id="version-history-select"
            value={selectedVersionId}
            onChange={(e) => setSelectedVersionId(e.target.value)}
            aria-label="Select a flow version"
            className="w-auto"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} — {formatRelativeDate(v.created_at)}
              </option>
            ))}
          </Select>
          {canRestore && (
            <Button
              variant="secondary"
              size="sm"
              disabled={restoring}
              aria-busy={restoring}
              onClick={() => void handleRestoreVersion()}
            >
              {restoring ? 'Restoring…' : 'Restore this version'}
            </Button>
          )}
          {!canRestore && selectedVersionId === activeFlowId && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">Active version</span>
          )}
        </div>
      )}

      {/* Two-column layout md+ */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left: step builder */}
        <div className="flex-1 min-w-0 space-y-3">
          {steps.length === 0 ? (
            <EmptyState
              title="No steps yet"
              body="Add steps to build your patient onboarding experience."
              inline
            />
          ) : (
            <SortableTreePanel<OnboardingStepNode>
              items={steps}
              getId={(s) => s.id}
              onReorder={handleReorder}
              announceItemLabel={(s) => STEP_TYPE_LABELS[s.type]}
              isDragDisabled={(s) => MANDATORY_TYPES.has(s.type)}
              renderItem={renderStepRow}
            />
          )}

          {/* Add step button */}
          <div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus size={14} aria-hidden />}
              onClick={() => setPaletteOpen((v) => !v)}
              aria-expanded={paletteOpen}
              aria-controls="add-step-palette"
              disabled={availablePaletteSteps.length === 0}
            >
              Add step
            </Button>

            {/* Inline step palette */}
            {paletteOpen && availablePaletteSteps.length > 0 && (
              <div
                id="add-step-palette"
                className={[
                  'mt-2 grid grid-cols-2 gap-2',
                  !reducedMotion ? 'animate-[fadeIn_0.15s_ease-out]' : '',
                ].join(' ')}
              >
                {availablePaletteSteps.map((type) => {
                  const Icon = STEP_TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleAddStep(type)}
                      className="flex items-start gap-2 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      <Icon size={16} className="text-[var(--color-text-secondary)] mt-0.5 shrink-0" aria-hidden />
                      <span>
                        <p className="text-[12px] font-semibold text-[var(--color-text)]">
                          {STEP_TYPE_LABELS[type]}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-tertiary)] leading-tight">
                          {STEP_TYPE_DESCRIPTIONS[type]}
                        </p>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save flow button */}
          <div className="pt-2">
            <Button
              variant="primary"
              disabled={saveDisabled}
              aria-busy={saving}
              onClick={() => void handleSaveFlow()}
            >
              {saving ? 'Saving…' : 'Save flow'}
            </Button>
          </div>
        </div>

        {/* Right: patient preview */}
        <div className="w-full md:w-[300px] md:shrink-0">
          <PatientPreviewPane steps={steps} />
        </div>
      </div>

      {/* Step editor modal */}
      <StepEditorModal
        step={editingStep}
        onClose={() => setEditingStep(null)}
        onApply={handleApplyEdit}
        orgId={orgId}
      />
    </div>
  );
}

export default OnboardingTab;
