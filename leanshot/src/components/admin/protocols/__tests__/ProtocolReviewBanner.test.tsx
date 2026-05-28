/**
 * Phase 61 Plan 61-05 — ProtocolReviewBanner unit tests.
 *
 * 3 behavior assertions:
 *  T1 — Author view: renders banner text, NO Publish Protocol button in DOM
 *  T2 — Reviewer view: renders 'Review as: Dr. Smith', renders 'Publish Protocol' button
 *  T3 — Reviewer clicks Publish: onPublish called
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProtocolReviewBanner } from '../ProtocolReviewBanner';

describe('ProtocolReviewBanner', () => {
  it('T1 — author view: renders pending copy, Publish Protocol button ABSENT from DOM', () => {
    render(
      <ProtocolReviewBanner
        isAuthor={true}
        reviewerName="Dr. Smith"
        onPublish={vi.fn()}
        publishing={false}
      />,
    );

    expect(screen.getByText('Pending review by another admin')).toBeTruthy();

    // Critical PROTOCOL-04 invariant: button must be completely absent, not just hidden
    expect(screen.queryByText('Publish Protocol')).toBeNull();
  });

  it('T2 — reviewer view: renders reviewer copy and Publish Protocol button', () => {
    render(
      <ProtocolReviewBanner
        isAuthor={false}
        reviewerName="Dr. Smith"
        onPublish={vi.fn()}
        publishing={false}
      />,
    );

    expect(screen.getByText(/Review as: Dr\. Smith/)).toBeTruthy();
    expect(screen.getByText('Publish Protocol')).toBeTruthy();
  });

  it('T3 — reviewer clicks Publish: onPublish called', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);

    render(
      <ProtocolReviewBanner
        isAuthor={false}
        reviewerName="Dr. Smith"
        onPublish={onPublish}
        publishing={false}
      />,
    );

    fireEvent.click(screen.getByText('Publish Protocol'));
    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledOnce();
    });
  });

  it('T4 — reviewer view without onPublish: no Publish Protocol button', () => {
    render(<ProtocolReviewBanner isAuthor={false} reviewerName="Dr. Smith" publishing={false} />);

    // onPublish not provided — no button rendered
    expect(screen.queryByText('Publish Protocol')).toBeNull();
    expect(screen.getByText(/Review as: Dr\. Smith/)).toBeTruthy();
  });
});
