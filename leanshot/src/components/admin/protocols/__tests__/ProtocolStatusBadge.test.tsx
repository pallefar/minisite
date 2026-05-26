/**
 * Phase 61 Plan 61-04 — ProtocolStatusBadge unit tests.
 *
 * Verifies that each of the 4 protocol_review_state values renders
 * the correct human-readable label and aria-label.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProtocolStatusBadge } from '../ProtocolStatusBadge';

describe('ProtocolStatusBadge', () => {
  it.each([
    ['draft', 'Draft', 'Protocol status: draft'],
    ['in_review', 'In review', 'Protocol status: pending review'],
    ['published', 'Published', 'Protocol status: published'],
    ['archived', 'Archived', 'Protocol status: archived'],
  ] as const)('renders %s with label %s and aria %s', (status, label, aria) => {
    render(<ProtocolStatusBadge status={status} />);
    expect(screen.getByLabelText(aria)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
