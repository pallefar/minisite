/**
 * Phase 71 Plan 71-01 Task 3 — EntryEditorView tests (PU-01).
 *
 * Asserts the authoring-form behaviours:
 *   1. Typing a title auto-fills the slug field (slugify).
 *   2. Manually editing the slug stops the auto-fill (title changes no longer
 *      overwrite the slug).
 *   3. The live-preview pane renders the body through the SAME SafeMarkdown
 *      renderer the WhatsNewDrawer uses — a `<script>` in the body is
 *      sanitised away (no live script survives in the preview DOM).
 *
 * Runs in the src-ui-unit project (include widened to src/admin/**\/__tests__).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntryEditorView } from '../EntryEditorView';

// The editor imports the real supabase singleton at module load — mock it so
// the unit test never touches the network. The form behaviours under test
// (slug auto-fill + preview sanitisation) don't depend on supabase.
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
}));

// useToast pulls in the store; stub it to a no-op spy.
vi.mock('@/hooks/useToast', () => ({ useToast: () => vi.fn() }));

function getSlugInput(): HTMLInputElement {
  return screen.getByLabelText(/slug/i) as HTMLInputElement;
}
function getTitleInput(): HTMLInputElement {
  return screen.getByLabelText(/title/i) as HTMLInputElement;
}

describe('EntryEditorView', () => {
  it('auto-fills the slug from the title', () => {
    render(<EntryEditorView entry={null} />);
    fireEvent.change(getTitleInput(), { target: { value: 'Hello, World! v2' } });
    expect(getSlugInput().value).toBe('hello-world-v2');
  });

  it('stops auto-filling the slug once the slug is manually edited', () => {
    render(<EntryEditorView entry={null} />);
    fireEvent.change(getTitleInput(), { target: { value: 'First Title' } });
    expect(getSlugInput().value).toBe('first-title');

    // User manually overrides the slug.
    fireEvent.change(getSlugInput(), { target: { value: 'custom-slug' } });
    expect(getSlugInput().value).toBe('custom-slug');

    // Further title edits no longer overwrite the manual slug.
    fireEvent.change(getTitleInput(), { target: { value: 'Second Title' } });
    expect(getSlugInput().value).toBe('custom-slug');
  });

  it('sanitises a <script> in the body so no live script reaches the preview', () => {
    render(<EntryEditorView entry={null} />);
    const body = screen.getByLabelText(/body/i);
    fireEvent.change(body, {
      target: { value: '# Safe heading\n\n<script>alert(1)</script>' },
    });

    const preview = screen.getByTestId('markdown-preview');
    // The heading renders…
    expect(preview.textContent).toContain('Safe heading');
    // …but no executable <script> element survives the SafeMarkdown sanitiser.
    expect(preview.querySelector('script')).toBeNull();
  });
});
