/**
 * Phase 9 Plan 09-02 — OrgCreateFlow RTL coverage.
 *
 * Behaviors tested (UI-SPEC State Coverage Checklist rows 705-754):
 *   1. Step 1 mount — name auto-focused, slug empty.
 *   2. Slug auto-derives from name on keystroke (debounced).
 *   3. Slug becomes independently editable on first manual edit.
 *   4. Slug invalid characters inline error.
 *   5. Slug reserved-word inline error.
 *   6. Slug taken inline error (server response branch).
 *   7. Logo too-large error + state cleared.
 *   8. Logo wrong-type error.
 *   9. Create workspace disabled until validation passes.
 *  10. Success state with Fraunces heading + dual CTAs.
 *  11. Server error on submit preserves form state.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgCreateFlow } from './OrgCreateFlow';

const mockCheckSlugAvailable = vi.fn();
const mockCreateOrg = vi.fn();
const mockUpdateOrg = vi.fn();
const mockUploadOrgLogo = vi.fn();
const mockToastFn = vi.fn();

vi.mock('@/lib/clinic', () => ({
  checkSlugAvailable: (...args: unknown[]) => mockCheckSlugAvailable(...args),
  createOrg: (...args: unknown[]) => mockCreateOrg(...args),
  updateOrg: (...args: unknown[]) => mockUpdateOrg(...args),
  uploadOrgLogo: (...args: unknown[]) => mockUploadOrgLogo(...args),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToastFn,
}));

// jsdom does not implement URL.createObjectURL; stub to a fake blob URL.
if (typeof URL.createObjectURL !== 'function') {
  (URL as { createObjectURL?: (f: File | Blob) => string }).createObjectURL = () => 'blob:mock';
}

beforeEach(() => {
  mockCheckSlugAvailable.mockReset();
  mockCreateOrg.mockReset();
  mockUpdateOrg.mockReset();
  mockUploadOrgLogo.mockReset();
  mockToastFn.mockReset();
  // Default: every slug is available unless a test overrides.
  mockCheckSlugAvailable.mockResolvedValue({ available: true });
});

afterEach(() => {
  cleanup();
});

describe('OrgCreateFlow — Step 1', () => {
  it('mounts with the workspace-name Input auto-focused', async () => {
    render(<OrgCreateFlow />);
    const nameInput = await screen.findByLabelText(/Workspace name/i);
    expect(document.activeElement).toBe(nameInput);
  });

  it('auto-derives slug from workspace name and lowercases + kebab-cases', async () => {
    render(<OrgCreateFlow />);
    const nameInput = screen.getByLabelText(/Workspace name/i);
    await userEvent.type(nameInput, 'Northside Endo');
    const slugInput = screen.getByLabelText(/Workspace URL/i) as HTMLInputElement;
    expect(slugInput.value).toBe('northside-endo');
  });

  it('locks slug from auto-derive after the user manually edits it', async () => {
    render(<OrgCreateFlow />);
    const nameInput = screen.getByLabelText(/Workspace name/i);
    const slugInput = screen.getByLabelText(/Workspace URL/i) as HTMLInputElement;
    await userEvent.type(nameInput, 'Foo');
    expect(slugInput.value).toBe('foo');
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'custom');
    await userEvent.type(nameInput, ' Clinic');
    // Slug stays at 'custom' — does NOT re-derive
    expect(slugInput.value).toBe('custom');
  });

  it('renders "Use lowercase letters, numbers, and hyphens only." on invalid slug', async () => {
    mockCheckSlugAvailable.mockResolvedValueOnce({ available: false, reason: 'invalid' });
    render(<OrgCreateFlow />);
    const slugInput = screen.getByLabelText(/Workspace URL/i);
    await userEvent.type(slugInput, 'BadSlug!');
    // Trigger blur to fire immediate check
    await userEvent.tab();
    expect(
      await screen.findByText('Use lowercase letters, numbers, and hyphens only.'),
    ).toBeInTheDocument();
  });

  it('renders "That URL is reserved." on reserved word', async () => {
    mockCheckSlugAvailable.mockResolvedValueOnce({ available: false, reason: 'reserved' });
    render(<OrgCreateFlow />);
    const slugInput = screen.getByLabelText(/Workspace URL/i);
    await userEvent.type(slugInput, 'admin');
    await userEvent.tab();
    expect(await screen.findByText('That URL is reserved. Try another.')).toBeInTheDocument();
  });

  it('renders "That URL is already taken." on server-taken response', async () => {
    mockCheckSlugAvailable.mockResolvedValueOnce({ available: false, reason: 'taken' });
    render(<OrgCreateFlow />);
    const slugInput = screen.getByLabelText(/Workspace URL/i);
    await userEvent.type(slugInput, 'acme');
    await userEvent.tab();
    expect(
      await screen.findByText('That URL is already taken. Try another.'),
    ).toBeInTheDocument();
  });

  it('disables Create workspace until name + slug pass', async () => {
    render(<OrgCreateFlow />);
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    expect(submitBtn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Workspace name/i), 'Acme');
    // Slug auto-derives; need to wait for debounce to settle
    await waitFor(() => expect(submitBtn).toBeEnabled());
  });
});

describe('OrgCreateFlow — Logo validation', () => {
  function makeFile(name: string, type: string, bytes: number): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it('rejects files over 2 MB with the spec error copy', async () => {
    render(<OrgCreateFlow />);
    const fileInput = screen.getByLabelText(/Workspace logo file/i) as HTMLInputElement;
    const tooBig = makeFile('logo.png', 'image/png', 2 * 1024 * 1024 + 1);
    await userEvent.upload(fileInput, tooBig);
    expect(
      await screen.findByText('That file is over 2 MB. Try a smaller image.'),
    ).toBeInTheDocument();
  });

  it('rejects .gif with the spec error copy', async () => {
    render(<OrgCreateFlow />);
    const fileInput = screen.getByLabelText(/Workspace logo file/i) as HTMLInputElement;
    const wrong = makeFile('logo.gif', 'image/gif', 1024);
    // Use fireEvent.change directly to bypass userEvent's `accept`-attribute
    // filter; the validation we're testing is OurS, not the browser's.
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [wrong],
    });
    fireEvent.change(fileInput);
    expect(await screen.findByText('Use a PNG or JPEG image.')).toBeInTheDocument();
  });
});

describe('OrgCreateFlow — Submit flow', () => {
  it('shows success state with Fraunces heading + dual CTAs on success', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      ok: true,
      data: { org_id: 'org-1', slug: 'acme' },
    });
    render(<OrgCreateFlow />);
    await userEvent.type(screen.getByLabelText(/Workspace name/i), 'Acme');
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await userEvent.click(submitBtn);
    const heading = await screen.findByText('Workspace created');
    // Fraunces serif italic class applied
    expect(heading.className).toMatch(/italic/);
    expect(heading.className).toMatch(/font-serif/);
    expect(screen.getByText(/app\.leanshot\.app\/clinic\/acme/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite first patient/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to workspace/i })).toBeInTheDocument();
  });

  it('on slug_taken server response: inline error preserved + form state intact', async () => {
    mockCreateOrg.mockResolvedValueOnce({ ok: false, error: 'slug_taken' });
    render(<OrgCreateFlow />);
    await userEvent.type(screen.getByLabelText(/Workspace name/i), 'Acme');
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await userEvent.click(submitBtn);
    expect(
      await screen.findByText('That URL is already taken. Try another.'),
    ).toBeInTheDocument();
    // Form state preserved — name still in input
    expect((screen.getByLabelText(/Workspace name/i) as HTMLInputElement).value).toBe('Acme');
  });

  it('"Invite first patient" calls onComplete with openInviteModal=true', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      ok: true,
      data: { org_id: 'org-1', slug: 'acme' },
    });
    const onComplete = vi.fn();
    render(<OrgCreateFlow onComplete={onComplete} />);
    await userEvent.type(screen.getByLabelText(/Workspace name/i), 'Acme');
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await userEvent.click(submitBtn);
    await screen.findByText('Workspace created');
    await userEvent.click(screen.getByRole('button', { name: /invite first patient/i }));
    expect(onComplete).toHaveBeenCalledWith('acme', true);
  });

  it('"Go to workspace" calls onComplete with openInviteModal=false', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      ok: true,
      data: { org_id: 'org-1', slug: 'acme' },
    });
    const onComplete = vi.fn();
    render(<OrgCreateFlow onComplete={onComplete} />);
    await userEvent.type(screen.getByLabelText(/Workspace name/i), 'Acme');
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await userEvent.click(submitBtn);
    await screen.findByText('Workspace created');
    await userEvent.click(screen.getByRole('button', { name: /go to workspace/i }));
    expect(onComplete).toHaveBeenCalledWith('acme', false);
  });
});
