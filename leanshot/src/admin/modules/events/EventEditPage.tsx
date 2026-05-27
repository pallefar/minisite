/**
 * Phase 47 Plan 47-11 — EventEditPage (admin create/edit form).
 *
 * Implements admin half of EVENT-01 (event creation/editing) + EVENT-03
 * (Zoom radio: paste-link vs Generate via zoom-create-meeting Fn).
 *
 * Fields (per CONTEXT D-01 + D-06 + D-15 + D-16):
 *   - title (text, required)
 *   - description (markdown textarea)
 *   - start_at, end_at (datetime-local; CHECK end_at > start_at enforced DB-side)
 *   - capacity (number, default 0 = unlimited)
 *   - space_id (dropdown from community_spaces)
 *   - Zoom radio (D-06): "Paste meeting URL" | "Generate Zoom meeting"
 *     - paste → write join_url directly on INSERT
 *     - generate → INSERT first (need event_id) → invoke zoom-create-meeting Fn
 *       → Fn writes back join_url + zoom_meeting_id + zoom_managed=true via
 *       service-role (events RLS is_staff-gated, but the Fn uses service-role
 *       so it can ALSO set the hidden columns the column-allowlist may filter
 *       on read; see 20270801000002_p47_events_rls.sql).
 *   - attach_to_module_id (D-15): dropdown of course_modules with "Course › Module" label
 *   - cover image upload (D-16): file input → upload to event-covers bucket at
 *     path "{event_id}/{filename}" → write returned publicUrl to events.cover_url
 *
 * Security:
 *   - UX gate: AdminShell minRole='staff' (manifest entry).
 *   - DB gate: events INSERT/UPDATE policies require public.is_staff()
 *     (20270801000002_p47_events_rls.sql lines 84/91).
 *   - event-covers bucket INSERT policy requires is_staff()
 *     (20270801000005_p47_event_covers_bucket.sql).
 *
 * Admin surface — pathname-based routing only; no client-router package
 * imports per reference_react_router_consumer_admin_split (CORRECTED 2026-05-23).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventEditPageProps {
  /** null → create mode, string → edit mode. */
  eventId: string | null;
  onNavigate: (path: string) => void;
}

type ZoomMode = 'paste' | 'generate';

interface SpaceOption {
  id: string;
  name: string;
}

interface ModuleOption {
  id: string;
  label: string; // "Course Title › Module Title"
}

interface FormState {
  title: string;
  description: string;
  start_at: string; // datetime-local string
  end_at: string;   // datetime-local string
  capacity: number;
  space_id: string;
  cover_url: string;
  attach_to_module_id: string;
  zoom_mode: ZoomMode;
  zoom_paste_url: string;
  zoom_meeting_id: string;
  zoom_managed: boolean;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  start_at: '',
  end_at: '',
  capacity: 0,
  space_id: '',
  cover_url: '',
  attach_to_module_id: '',
  zoom_mode: 'paste',
  zoom_paste_url: '',
  zoom_meeting_id: '',
  zoom_managed: false,
};

// Convert ISO timestamptz → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Strip timezone offset: render as local wall-clock.
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

// Convert "YYYY-MM-DDTHH:MM" (local wall-clock) → ISO UTC string for write.
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventEditPage({ eventId, onNavigate }: EventEditPageProps) {
  const toast = useToast();
  const isNew = !eventId;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [generatingZoom, setGeneratingZoom] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Load spaces dropdown.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('community_spaces')
        .select('id, name')
        .order('name', { ascending: true });
      setSpaces(((data ?? []) as SpaceOption[]));
    })();
  }, []);

  // Load course_modules dropdown (Phase 46 schema) for attach-to-module picker.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('course_modules')
        .select('id, title, course:courses(title)')
        .order('title', { ascending: true });
      const opts: ModuleOption[] = (data ?? []).map((r) => {
        const row = r as {
          id: string;
          title: string;
          course: { title: string } | { title: string }[] | null;
        };
        const course = Array.isArray(row.course) ? row.course[0] ?? null : row.course;
        const courseTitle = course?.title ?? 'Untitled course';
        return { id: row.id, label: `${courseTitle} › ${row.title}` };
      });
      setModules(opts);
    })();
  }, []);

  // Load existing event for edit mode.
  useEffect(() => {
    if (!eventId) return;

    void (async () => {
      setLoading(true);
      // Note: column allowlist (20270801000002_p47_events_rls.sql) excludes
      // join_url + zoom_meeting_id from authenticated SELECT. Admin sees them
      // implicitly via the "Generate" UX (just-set, server-side write); the
      // existing zoom_managed flag tells us whether a generated link is in play.
      const { data, error } = await supabase
        .from('events')
        .select(
          'id, title, description, start_at, end_at, capacity, space_id, cover_url, attach_to_module_id, zoom_managed',
        )
        .eq('id', eventId)
        .single();

      if (error || !data) {
        toast(`Failed to load event: ${error?.message ?? 'Not found'}`, 'error');
        setLoading(false);
        return;
      }

      const row = data as {
        title: string;
        description: string | null;
        start_at: string;
        end_at: string;
        capacity: number;
        space_id: string;
        cover_url: string | null;
        attach_to_module_id: string | null;
        zoom_managed: boolean;
      };
      setForm({
        title: row.title,
        description: row.description ?? '',
        start_at: toLocalInput(row.start_at),
        end_at: toLocalInput(row.end_at),
        capacity: row.capacity,
        space_id: row.space_id,
        cover_url: row.cover_url ?? '',
        attach_to_module_id: row.attach_to_module_id ?? '',
        zoom_mode: row.zoom_managed ? 'generate' : 'paste',
        zoom_paste_url: '',
        zoom_meeting_id: '',
        zoom_managed: row.zoom_managed,
      });
      setLoading(false);
    })();
  }, [eventId, toast]);

  // ── Validation ────────────────────────────────────────────────────────────

  const titleError = form.title.trim().length === 0 ? 'Title is required.' : '';
  const spaceError = form.space_id.trim().length === 0 ? 'Space is required.' : '';
  const startError = !form.start_at ? 'Start time is required.' : '';
  const endError = !form.end_at
    ? 'End time is required.'
    : form.start_at && form.end_at && fromLocalInput(form.end_at)! <= fromLocalInput(form.start_at)!
    ? 'End time must be after start time.'
    : '';
  const pasteError =
    form.zoom_mode === 'paste' && form.zoom_paste_url.trim().length === 0 && isNew
      ? 'Paste a Zoom meeting URL or switch to “Generate”.'
      : '';

  const isValid =
    !titleError && !spaceError && !startError && !endError && !pasteError;

  // ── Cover upload ──────────────────────────────────────────────────────────

  const handleCoverUpload = async (file: File): Promise<void> => {
    // Need an event_id to namespace the upload path. In create mode we lazily
    // mint a UUID-ish path using the title-slug; final URL is the public path
    // anyway and the bucket policy is is_staff() gated (T-47-45 mitigation).
    // For edit mode we use the existing event id.
    const ns = eventId ?? `pending-${Date.now()}`;
    const path = `${ns}/${file.name}`;
    setUploadingCover(true);
    const { error: upErr } = await supabase.storage
      .from('event-covers')
      .upload(path, file, { upsert: true });
    if (upErr) {
      toast(`Cover upload failed: ${upErr.message}`, 'error');
      setUploadingCover(false);
      return;
    }
    const { data } = supabase.storage.from('event-covers').getPublicUrl(path);
    setForm((f) => ({ ...f, cover_url: data.publicUrl }));

    // If editing an existing row, persist the cover_url change immediately so
    // the row reflects the new cover even if the operator doesn't click Save.
    if (eventId) {
      const { error: updErr } = await supabase
        .from('events')
        .update({ cover_url: data.publicUrl })
        .eq('id', eventId);
      if (updErr) {
        toast(`Saved upload but row update failed: ${updErr.message}`, 'error');
      } else {
        toast('Cover image updated.', 'success');
      }
    }
    setUploadingCover(false);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSave = async (): Promise<void> => {
    if (!isValid || saving) return;
    setSaving(true);

    const startISO = fromLocalInput(form.start_at);
    const endISO = fromLocalInput(form.end_at);
    if (!startISO || !endISO) {
      toast('Invalid start or end time.', 'error');
      setSaving(false);
      return;
    }

    // Base payload — set on both INSERT + UPDATE.
    const basePayload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      start_at: startISO,
      end_at: endISO,
      capacity: Number.isFinite(form.capacity) ? form.capacity : 0,
      space_id: form.space_id,
      cover_url: form.cover_url || null,
      attach_to_module_id: form.attach_to_module_id || null,
    };

    // Zoom radio handling.
    // - paste mode: write join_url directly, zoom_managed=false.
    // - generate mode (NEW only): INSERT bare, then invoke zoom-create-meeting Fn.
    //   On edit, re-generating is out of scope (Fn is one-shot per event row;
    //   admin can clear zoom_managed and re-generate in a later iteration).
    if (form.zoom_mode === 'paste') {
      basePayload.join_url = form.zoom_paste_url.trim() || null;
      basePayload.zoom_managed = false;
    } else {
      basePayload.zoom_managed = true;
    }

    if (isNew) {
      const { data: ins, error: insErr } = await supabase
        .from('events')
        .insert(basePayload)
        .select('id')
        .single();
      if (insErr || !ins) {
        toast(`Failed to create event: ${insErr?.message ?? 'Unknown'}`, 'error');
        setSaving(false);
        return;
      }
      const newId = (ins as { id: string }).id;

      // Generate Zoom meeting via Edge Fn (Phase 47 Plan 47-06).
      if (form.zoom_mode === 'generate') {
        setGeneratingZoom(true);
        const { error: fnErr } = await supabase.functions.invoke(
          'zoom-create-meeting',
          { body: { event_id: newId } },
        );
        setGeneratingZoom(false);
        if (fnErr) {
          toast(
            `Event created but Zoom meeting creation failed: ${fnErr.message}`,
            'error',
          );
          // Don't abort — the event row exists; operator can re-run from edit screen.
        } else {
          toast('Event created and Zoom meeting generated.', 'success');
        }
      } else {
        toast('Event created.', 'success');
      }

      onNavigate(`/admin/events/${newId}/edit`);
    } else {
      const { error: updErr } = await supabase
        .from('events')
        .update(basePayload)
        .eq('id', eventId!);
      if (updErr) {
        toast(`Failed to update event: ${updErr.message}`, 'error');
        setSaving(false);
        return;
      }
      toast('Event updated.', 'success');
    }

    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading event…</div>
    );
  }

  return (
    <div className="space-y-5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] max-w-2xl">
      <h3 className="text-base font-semibold">
        {isNew ? 'New event' : 'Edit event'}
      </h3>

      {/* Title */}
      <div>
        <label htmlFor="event-title" className="block text-sm font-medium mb-1">
          Title <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
        </label>
        <Input
          id="event-title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          disabled={saving}
          maxLength={200}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'event-title-error' : undefined}
        />
        {titleError && (
          <p id="event-title-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {titleError}
          </p>
        )}
      </div>

      {/* Description (markdown) */}
      <div>
        <label htmlFor="event-description" className="block text-sm font-medium mb-1">
          Description (markdown)
        </label>
        <textarea
          id="event-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          disabled={saving}
          rows={5}
          maxLength={4000}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
          placeholder="What is this event about? Markdown supported."
        />
      </div>

      {/* Start / End */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="event-start" className="block text-sm font-medium mb-1">
            Start <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="event-start"
            type="datetime-local"
            value={form.start_at}
            onChange={(e) => setForm({ ...form, start_at: e.target.value })}
            disabled={saving}
            aria-invalid={!!startError}
            aria-describedby={startError ? 'event-start-error' : undefined}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
          />
          {startError && (
            <p id="event-start-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {startError}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="event-end" className="block text-sm font-medium mb-1">
            End <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="event-end"
            type="datetime-local"
            value={form.end_at}
            onChange={(e) => setForm({ ...form, end_at: e.target.value })}
            disabled={saving}
            aria-invalid={!!endError}
            aria-describedby={endError ? 'event-end-error' : undefined}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
          />
          {endError && (
            <p id="event-end-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {endError}
            </p>
          )}
        </div>
      </div>

      {/* Capacity */}
      <div>
        <label htmlFor="event-capacity" className="block text-sm font-medium mb-1">
          Capacity
        </label>
        <Input
          id="event-capacity"
          type="number"
          min={0}
          step={1}
          value={String(form.capacity)}
          onChange={(e) =>
            setForm({ ...form, capacity: Math.max(0, parseInt(e.target.value, 10) || 0) })
          }
          disabled={saving}
        />
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          0 means unlimited. When exceeded, RSVPs are auto-promoted to a waitlist.
        </p>
      </div>

      {/* Space */}
      <div>
        <label htmlFor="event-space" className="block text-sm font-medium mb-1">
          Community space <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
        </label>
        <select
          id="event-space"
          value={form.space_id}
          onChange={(e) => setForm({ ...form, space_id: e.target.value })}
          disabled={saving}
          aria-invalid={!!spaceError}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
        >
          <option value="">— Select a space —</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {spaceError && (
          <p className="mt-1 text-xs text-[var(--color-danger)]">{spaceError}</p>
        )}
      </div>

      {/* Zoom radio (D-06) */}
      <fieldset className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3">
        <legend className="px-1 text-sm font-medium">Meeting link</legend>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="zoom-mode"
              value="paste"
              checked={form.zoom_mode === 'paste'}
              onChange={() => setForm({ ...form, zoom_mode: 'paste' })}
              disabled={saving}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Paste meeting URL</span>
              <span className="block text-xs text-[var(--color-text-secondary)]">
                Use an existing Zoom (or other) meeting URL.
              </span>
            </span>
          </label>
          {form.zoom_mode === 'paste' && (
            <Input
              aria-label="Pasted meeting URL"
              value={form.zoom_paste_url}
              onChange={(e) => setForm({ ...form, zoom_paste_url: e.target.value })}
              disabled={saving}
              placeholder="https://zoom.us/j/…"
            />
          )}
          {pasteError && (
            <p className="text-xs text-[var(--color-danger)]">{pasteError}</p>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="zoom-mode"
              value="generate"
              checked={form.zoom_mode === 'generate'}
              onChange={() => setForm({ ...form, zoom_mode: 'generate' })}
              disabled={saving || (!isNew && form.zoom_managed)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Generate Zoom meeting</span>
              <span className="block text-xs text-[var(--color-text-secondary)]">
                Calls the <code className="font-mono text-[10px]">zoom-create-meeting</code> Edge
                Function after Save. Requires the Zoom OAuth integration to be
                configured server-side. The generated join URL and meeting ID
                are stored server-side and only revealed to attendees via{' '}
                <code className="font-mono text-[10px]">event_get_join_url</code>{' '}
                15 minutes before start.
              </span>
            </span>
          </label>
          {!isNew && form.zoom_managed && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              This event already has a managed Zoom meeting. Re-generation is not
              supported from this form.
            </p>
          )}
          {generatingZoom && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              Generating Zoom meeting…
            </p>
          )}
        </div>
      </fieldset>

      {/* Attach to module (D-15) */}
      <div>
        <label htmlFor="event-module" className="block text-sm font-medium mb-1">
          Attach recording to course module (optional)
        </label>
        <select
          id="event-module"
          value={form.attach_to_module_id}
          onChange={(e) => setForm({ ...form, attach_to_module_id: e.target.value })}
          disabled={saving}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
        >
          <option value="">— Standalone recording —</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          When set, the post-event recording becomes a lesson under the chosen module.
        </p>
      </div>

      {/* Cover image (D-16) */}
      <div>
        <label htmlFor="event-cover-file" className="block text-sm font-medium mb-1">
          Cover image
        </label>
        <input
          id="event-cover-file"
          type="file"
          accept="image/*"
          disabled={saving || uploadingCover}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleCoverUpload(f);
          }}
          aria-label="Upload event cover image to event-covers bucket"
          className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--color-primary)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[var(--color-primary-foreground)] file:hover:opacity-90 disabled:opacity-60"
        />
        {form.cover_url && (
          <div className="mt-2 flex items-center gap-3">
            <img
              src={form.cover_url}
              alt="Event cover preview"
              className="h-16 w-28 rounded-md object-cover border border-[var(--color-border)]"
            />
            <p className="text-xs text-[var(--color-text-secondary)] break-all font-mono">
              {form.cover_url}
            </p>
          </div>
        )}
        {uploadingCover && (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Uploading to event-covers bucket…
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!isValid || saving}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : isNew ? 'Create event' : 'Save changes'}
        </Button>
        {!isNew && eventId && (
          <>
            <button
              type="button"
              onClick={() => onNavigate(`/admin/events/${eventId}/attendees`)}
              className="text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              Manage attendees →
            </button>
            <button
              type="button"
              onClick={() => onNavigate(`/admin/events/${eventId}/recording`)}
              className="text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              Upload recording →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default EventEditPage;
