/**
 * Phase 66 Plan 66-06 — MfaStatusBadge unit tests.
 *
 * Asserts the 3 states resolve correctly + each renders the expected token
 * classes (via the Badge primitive's toneClasses lookup, which references
 * verified @theme tokens). Also covers the pure resolveMfaStatus helper.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MfaStatusBadge, resolveMfaStatus } from './MfaStatusBadge';

const REQ_ADMIN = new Map<string, boolean>([
  ['superadmin', true],
  ['admin', true],
  ['staff', false],
  ['clinic-admin', false],
  ['user', false],
]);

describe('resolveMfaStatus', () => {
  it("returns 'on' when userMfaFactors > 0 regardless of role requirement", () => {
    expect(resolveMfaStatus(1, 'user', REQ_ADMIN)).toBe('on');
    expect(resolveMfaStatus(2, 'admin', REQ_ADMIN)).toBe('on');
  });

  it("returns 'required-not-enrolled' when role required + factors==0", () => {
    expect(resolveMfaStatus(0, 'admin', REQ_ADMIN)).toBe('required-not-enrolled');
    expect(resolveMfaStatus(0, 'superadmin', REQ_ADMIN)).toBe('required-not-enrolled');
  });

  it("returns 'off' when role not required + factors==0", () => {
    expect(resolveMfaStatus(0, 'user', REQ_ADMIN)).toBe('off');
    expect(resolveMfaStatus(0, 'staff', REQ_ADMIN)).toBe('off');
  });

  it("returns 'off' for an unknown role with factors==0", () => {
    expect(resolveMfaStatus(0, 'unknown-role', REQ_ADMIN)).toBe('off');
  });
});

describe('<MfaStatusBadge>', () => {
  it("renders 'MFA on' with success tone when factors > 0", () => {
    render(
      <MfaStatusBadge userMfaFactors={1} userRole="admin" roleRequirements={REQ_ADMIN} />,
    );
    const badge = screen.getByTestId('mfa-status-badge');
    expect(badge.getAttribute('data-state')).toBe('on');
    expect(badge.textContent).toContain('MFA on');
    // success tone maps to --color-success-soft / --color-success
    expect(badge.className).toMatch(/color-success-soft/);
    expect(badge.className).toMatch(/color-success/);
  });

  it("renders 'MFA required' with warning tone when role-required + factors==0", () => {
    render(
      <MfaStatusBadge userMfaFactors={0} userRole="admin" roleRequirements={REQ_ADMIN} />,
    );
    const badge = screen.getByTestId('mfa-status-badge');
    expect(badge.getAttribute('data-state')).toBe('required-not-enrolled');
    expect(badge.textContent).toContain('MFA required');
    // warning tone maps to --color-warning-soft / --color-warning
    expect(badge.className).toMatch(/color-warning-soft/);
    expect(badge.className).toMatch(/color-warning/);
  });

  it("renders 'MFA off' with neutral tone otherwise", () => {
    render(
      <MfaStatusBadge userMfaFactors={0} userRole="user" roleRequirements={REQ_ADMIN} />,
    );
    const badge = screen.getByTestId('mfa-status-badge');
    expect(badge.getAttribute('data-state')).toBe('off');
    expect(badge.textContent).toContain('MFA off');
    // neutral tone maps to --color-surface-elevated / --color-text-secondary
    expect(badge.className).toMatch(/color-surface-elevated/);
    expect(badge.className).toMatch(/color-text-secondary/);
  });

  it("uses aria-label that matches the state for screen readers", () => {
    const { rerender } = render(
      <MfaStatusBadge userMfaFactors={1} userRole="user" roleRequirements={REQ_ADMIN} />,
    );
    expect(screen.getByLabelText('MFA on')).toBeDefined();
    rerender(
      <MfaStatusBadge userMfaFactors={0} userRole="admin" roleRequirements={REQ_ADMIN} />,
    );
    expect(screen.getByLabelText('MFA required but not enrolled')).toBeDefined();
    rerender(
      <MfaStatusBadge userMfaFactors={0} userRole="user" roleRequirements={REQ_ADMIN} />,
    );
    expect(screen.getByLabelText('MFA off')).toBeDefined();
  });
});
