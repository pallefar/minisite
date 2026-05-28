import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TierGate } from '@/components/billing/TierGate';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Textarea } from '@/components/ui/Input';
import { useConfirm } from '@/hooks/useConfirm';
import { AIAvatar } from '@/illustrations/AIAvatar';
import { AIUnavailableError, RateLimitedError, callAIChat } from '@/lib/ai';
import { cn } from '@/lib/helpers';
import { parseCitations } from '@/lib/rag/remark-citations';
import { useStore } from '@/lib/store';
// Phase 60 Plan 60-10 — RAG citation UI (additive augmentation; AI-04 fence untouched)
import { CitationMarker } from './CitationMarker';
import { CitationPopover } from './CitationPopover';
import { RefusalCard } from './RefusalCard';
import { SourcesFooter } from './SourcesFooter';
import type { SourceCitationEntry } from './SourcesFooter';

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

const KEYWORDS_FOR_DATA_REF = [
  'protein',
  'weight',
  'dose',
  'shot',
  'injection',
  'sleep',
  'mood',
  'side effect',
  'symptom',
  'streak',
  'plateau',
  'hunger',
  'meal',
];

function detectDataRef(text: string): boolean {
  const t = text.toLowerCase();
  return KEYWORDS_FOR_DATA_REF.some((k) => t.includes(k));
}

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. ALL hooks (useStore×7, useConfirm, useState×2, useRef,
  // useEffect) run unconditionally above the `if (!u) return null;` guard.
  const { t } = useTranslation(['patient', 'common']);
  const u = useStore((s) => s.user);
  const history = useStore((s) => s.aiHistory);
  const append = useStore((s) => s.appendAI);
  const updateLastAssistant = useStore((s) => s.updateLastAssistant);
  const clear = useStore((s) => s.clearAI);
  const weights = useStore((s) => s.weights);
  const symptoms = useStore((s) => s.symptoms);

  const {
    confirm,
    open: confirmOpen,
    message: confirmMessage,
    title: confirmTitle,
    confirmLabel,
    cancelLabel,
    destructive: confirmDestructive,
    handleConfirm,
    handleCancel,
  } = useConfirm();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Phase 60 Plan 60-10 — popover state for citation marker activation
  const [popoverState, setPopoverState] = useState<{
    chunkId: string;
    anchorEl: HTMLElement;
    siblings: string[];
  } | null>(null);
  // Phase 14 Plan 14-05 — CONTEXT D-07: local model selector state.
  // Wiring to the actual @/lib/ai request payload is deferred to Phase 14
  // follow-up (the gate visibility is the user-observable unlock).
  // TODO(14-05): wire chatModel into callAIChat payload in Phase 14 follow-up.
  const [chatModel, setChatModel] = useState<'sonnet' | 'opus'>('sonnet');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, open, busy]);

  if (!u) return null;

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const latest = weights[weights.length - 1];
  const lost = latest ? u.startWeight - latest.weight : 0;
  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));
  const recentSx = symptoms
    .slice(0, 5)
    .map((s) => `${s.symptom} (${s.severity}/5)`)
    .join(', ');
  const ctx = `User context: Name: ${u.name}. On ${u.medication} at ${u.dose}${u.doseUnit}, weekly. Started ${u.startDate} (week ${weeks}). Starting weight ${u.startWeight}${wU}, current ${latest?.weight ?? '?'}${wU}, goal ${u.goalWeight}${wU}, lost ${lost.toFixed(1)}${wU}. Goal type: ${u.goal}. Lifting: ${u.liftingLevel}. Recent symptoms: ${recentSx || 'none'}. Protein target: ${u.proteinTarget}g/day.`;

  // Adaptive prompt suggestions based on context
  const suggestions: string[] = [];
  if (recentSx) suggestions.push('Why might I be feeling these symptoms?');
  if (weeks >= 8 && weeks < 16) suggestions.push('Should I bump my dose this week?');
  if (lost < 0 || (weeks >= 6 && lost < 2)) suggestions.push('Why have I plateaued?');
  if (u.liftingLevel === 'none') suggestions.push("What's a beginner lifting routine for me?");
  suggestions.push('How do I hit my protein on tough nausea days?');
  while (suggestions.length < 3) suggestions.push('Tell me about my titration phase');

  const send = async (text: string): Promise<void> => {
    if (!text.trim() || busy) return;
    setInput('');
    const trimmed = text.trim();
    // Snapshot the conversation BEFORE appending the placeholder so we
    // send a clean history to the proxy (placeholder is browser-only UX).
    const wireHistory = [...history, { role: 'user' as const, content: trimmed }];
    append({ role: 'user', content: trimmed });
    append({ role: 'assistant', content: '' });
    setBusy(true);
    try {
      await callAIChat({
        messages: wireHistory,
        mode: 'coach',
        userContext: ctx,
        onText: (delta) => updateLastAssistant(delta),
      });
      // Final pass: stamp hasDataReference once the stream is complete so
      // the "Personalized" badge appears on contextual replies. Read the
      // accumulated content from the store via getState (selectors are
      // for renders; this is a one-shot post-stream side-effect).
      const finalContent =
        useStore.getState().aiHistory[useStore.getState().aiHistory.length - 1]?.content ?? '';
      if (detectDataRef(finalContent)) {
        const hist = useStore.getState().aiHistory;
        const last = hist[hist.length - 1];
        if (last?.role === 'assistant') {
          useStore.setState({
            aiHistory: [...hist.slice(0, -1), { ...last, hasDataReference: true }],
          });
        }
      }
    } catch (e) {
      if (e instanceof RateLimitedError) {
        updateLastAssistant(t('patient:ai.error_rate_limit'));
      } else if (e instanceof AIUnavailableError) {
        updateLastAssistant(t('patient:ai.error_unavailable'));
      } else {
        updateLastAssistant(t('patient:ai.error_unavailable'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-[var(--color-surface-overlay)] backdrop-blur-md flex items-stretch md:items-center md:justify-end md:p-6"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t('patient:ai.panel_aria_label')}
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 md:flex-none md:w-[480px] bg-[var(--color-surface)] border border-[var(--color-border)] md:rounded-card shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-3 p-4 md:p-5 border-b border-[var(--color-border)]">
                <AIAvatar size={42} thinking={busy} />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold tracking-tight">
                    {t('patient:ai.panel_title')}
                  </p>
                  <p className="text-[12px] text-[var(--color-text-secondary)] truncate">
                    {busy
                      ? t('patient:ai.thinking')
                      : t('patient:ai.subtitle_journey', { weeks, medication: u.medication })}
                  </p>
                </div>
                {/* Phase 14 Plan 14-05 — CONTEXT D-07: model selector gated
                    behind TierGate hard-block-cta. Free users see the
                    PaywallUpsell CTA pill via TierGate's hard-block-cta fallback.
                    TODO(14-05): wire chatModel value into callAIChat in Phase 14 follow-up. */}
                <TierGate tier="paid" mode="hard-block-cta" feature="advanced-ai">
                  <select
                    aria-label="AI model"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value as 'sonnet' | 'opus')}
                    className="bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-[12px] font-semibold rounded-pill px-3 py-1.5 border-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
                  </select>
                </TierGate>
                <IconButton
                  aria-label={t('patient:ai.aria_clear')}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm(t('patient:ai.confirm_clear'), {
                        title: t('patient:ai.confirm_clear_title'),
                        confirmLabel: t('patient:ai.confirm_clear_btn'),
                        destructive: true,
                      });
                      if (!ok) return;
                      clear();
                    })();
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
                <IconButton
                  aria-label={t('common:action.close')}
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                >
                  <X className="size-5" />
                </IconButton>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-3">
                {history.length === 0 && (
                  <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-4 py-3.5">
                    <p className="text-[13px] leading-relaxed text-[var(--color-text)]">
                      {t('patient:ai.welcome', { name: u.name })}
                    </p>
                  </div>
                )}
                {history.map((m, i) => (
                  <Bubble
                    key={i}
                    role={m.role}
                    content={m.content}
                    hasRef={m.hasDataReference}
                    onCitationClick={(chunkId, anchorEl, siblings) =>
                      setPopoverState({ chunkId, anchorEl, siblings })
                    }
                  />
                ))}
                {busy && <ThinkingBubble />}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggestions */}
              {history.length === 0 && (
                <div className="px-4 md:px-5 pb-2 flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 3).map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="px-3 py-1.5 rounded-pill bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-[12px] font-semibold hover:bg-[var(--color-primary)] hover:text-[var(--color-primary-foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      <Sparkles className="inline size-3 me-1 -mt-0.5" />
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="p-3 md:p-4 border-t border-[var(--color-border)] safe-bottom">
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={1}
                    placeholder={t('patient:ai.placeholder')}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => send(input)}
                    disabled={!input.trim()}
                    loading={busy}
                    aria-label={t('patient:ai.aria_send')}
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-[var(--color-text-tertiary)] text-center mt-2">
                  {t('patient:ai.disclaimer')}
                </p>
              </div>

              {/* Phase 60 Plan 60-10 — CitationPopover (mounted at panel root) */}
              {popoverState && (
                <CitationPopover
                  chunkId={popoverState.chunkId}
                  anchorEl={popoverState.anchorEl}
                  siblings={popoverState.siblings}
                  onClose={() => setPopoverState(null)}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={confirmDestructive}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

// Phase 60 Plan 60-10 — Refusal sentinel regex (anchored to message start)
const REFUSAL_SENTINEL_RE = /^\[\[REFUSAL:(pharma_02|out_of_corpus|citation_validation_failed)\]\]/;

function Bubble({
  role,
  content,
  hasRef,
  onCitationClick,
}: {
  role: 'user' | 'assistant';
  content: string;
  hasRef?: boolean;
  onCitationClick?: (chunkId: string, anchorEl: HTMLElement, siblings: string[]) => void;
}) {
  const { t } = useTranslation('patient');

  // Phase 60 Plan 60-10 — assistant message augmentation (additive; AI-04 ctx composition unchanged)
  if (role === 'assistant') {
    // 1. Detect refusal sentinel (anchored to start of message per AI-SPEC §6 G5)
    const refusalMatch = REFUSAL_SENTINEL_RE.exec(content);
    if (refusalMatch) {
      const kind = refusalMatch[1] as 'pharma_02' | 'out_of_corpus' | 'citation_validation_failed';
      return (
        <div className="flex">
          <div className="max-w-[88%]">
            <RefusalCard kind={kind} />
          </div>
        </div>
      );
    }

    // 2. Parse citation markers (UUID [<uuid>] tokens from 60-06 synthesis Fn)
    const { segments, citations } = parseCitations(content);
    const hasCitations = citations.length > 0;

    if (hasCitations) {
      // Build sibling chunkIds list for ←/→ cycling in CitationPopover
      const siblingChunkIds = citations.map((c) => c.chunkId);

      // Build sources footer citation entries
      // We need source metadata — but at parse time we only have chunkId + refIndex.
      // SourcesFooter needs sourceName + sourceTier + canonicalUrl which require an API call.
      // For the footer we pass minimal data; CitationPopover fetches the full chunk on open.
      // Use a deferred approach: SourcesFooter receives the basic refs; it will display
      // what it has (chunkId as placeholder name when details unavailable).
      // Per plan spec, SourcesFooter takes CitationRef with sourceName etc —
      // at render time we don't have this. We'll render a simplified footer with
      // the citation index only. This is sufficient for the collapsible source count UX.
      const footerCitations: SourceCitationEntry[] = citations.map((c) => ({
        chunkId: c.chunkId,
        refIndex: c.refIndex,
        // These will be filled lazily when popover is opened; for the footer list
        // we show the refIndex + a truncated chunkId as placeholder source name.
        sourceName: `Citation ${c.refIndex}`,
        sourceTier: 'A' as const, // placeholder — popover shows real tier
        canonicalUrl: `#citation-${c.refIndex}`,
      }));

      return (
        <div className="flex">
          <div className="max-w-[88%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] rounded-bl-md">
            {hasRef && (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-2 rounded-pill bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-[10px] font-bold uppercase tracking-[0.06em]">
                  <Sparkles className="size-3" /> {t('patient:ai.badge_personalized')}
                </span>
                <br />
              </>
            )}
            {segments.map((seg, idx) => {
              if (seg.type === 'text') {
                return (
                  <span key={idx} className="whitespace-pre-wrap">
                    {seg.text}
                  </span>
                );
              }
              return (
                <CitationMarker
                  key={idx}
                  refIndex={seg.refIndex}
                  chunkId={seg.chunkId}
                  onActivate={(chunkId, el) => {
                    onCitationClick?.(chunkId, el, siblingChunkIds);
                  }}
                />
              );
            })}
            <SourcesFooter citations={footerCitations} />
          </div>
        </div>
      );
    }
  }

  // Existing render path — unchanged for user messages AND assistant messages without citations
  return (
    <div className={cn('flex', role === 'user' && 'justify-end')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap',
          role === 'user'
            ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] rounded-br-md'
            : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] rounded-bl-md',
        )}
      >
        {hasRef && role === 'assistant' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-2 rounded-pill bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-[10px] font-bold uppercase tracking-[0.06em]">
            <Sparkles className="size-3" /> {t('patient:ai.badge_personalized')}
          </span>
        )}
        {hasRef && <br />}
        {content}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex">
      <div className="rounded-2xl rounded-bl-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full bg-[var(--color-primary)]"
            style={{ animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '0ms' }}
          />
          <span
            className="size-2 rounded-full bg-[var(--color-primary)]"
            style={{ animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '160ms' }}
          />
          <span
            className="size-2 rounded-full bg-[var(--color-primary)]"
            style={{ animation: 'thinking 1.4s ease-in-out infinite', animationDelay: '320ms' }}
          />
        </div>
      </div>
    </div>
  );
}
