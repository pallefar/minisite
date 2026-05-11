import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal — dismissible prop (D-09)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset overflow that Modal sets on body during open
    document.body.style.overflow = '';
  });

  it('calls onClose on Escape when dismissible (default)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    // Do NOT wrap in StrictMode — RTL effects fire twice under StrictMode
    // and break call-count assertions (PATTERNS.md guidance)
    render(
      <Modal open onClose={onClose} title="Default modal">
        <p>body</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose on Escape when dismissible=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} dismissible={false} title="Blocking modal">
        <p>body</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT call onClose on backdrop click when dismissible=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} dismissible={false} title="Blocking modal">
        <p>body</p>
      </Modal>,
    );

    const backdrop = screen.getByRole('dialog');
    await user.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('treats dismissible=true identically to omitting the prop (Escape closes)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} dismissible={true} title="Explicit dismissible">
        <p>body</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
