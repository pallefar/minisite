/**
 * RTL tests for ConfettiBurst (VALIDATION row 35-06-01).
 *
 * Verifies:
 *   T-35-06-02: useReducedMotion=true → no burst fires (defense-in-depth #1 gate)
 *   T-35-06-01: trigger=null → no burst fires
 *   Normal path: trigger='level-up' + reduced=false → fireLevelUpBurst called with level
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fireChallengeCompleteBurst, fireLevelUpBurst } from '@/lib/gamification-defer';
import { ConfettiBurst } from '../ConfettiBurst';

vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: vi.fn() }));
vi.mock('@/lib/gamification-defer', () => ({
  fireLevelUpBurst: vi.fn(),
  fireChallengeCompleteBurst: vi.fn(),
}));

const mockUseReducedMotion = useReducedMotion as ReturnType<typeof vi.fn>;
const mockFireLevelUpBurst = fireLevelUpBurst as ReturnType<typeof vi.fn>;
const mockFireChallengeCompleteBurst = fireChallengeCompleteBurst as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConfettiBurst (D-claude-discretion / T-35-06-01 / T-35-06-02)', () => {
  it('does NOT fire when useReducedMotion=true (defense-in-depth #1 gate)', () => {
    mockUseReducedMotion.mockReturnValue(true);
    render(<ConfettiBurst trigger="level-up" level={5} />);
    expect(mockFireLevelUpBurst).not.toHaveBeenCalled();
  });

  it('fires fireLevelUpBurst when useReducedMotion=false and trigger=level-up', () => {
    mockUseReducedMotion.mockReturnValue(false);
    render(<ConfettiBurst trigger="level-up" level={5} />);
    expect(mockFireLevelUpBurst).toHaveBeenCalledWith(5);
  });

  it('does NOT fire when trigger=null', () => {
    mockUseReducedMotion.mockReturnValue(false);
    render(<ConfettiBurst trigger={null} />);
    expect(mockFireLevelUpBurst).not.toHaveBeenCalled();
    expect(mockFireChallengeCompleteBurst).not.toHaveBeenCalled();
  });

  it('fires fireChallengeCompleteBurst when trigger=challenge-complete', () => {
    mockUseReducedMotion.mockReturnValue(false);
    render(<ConfettiBurst trigger="challenge-complete" rewardKind="badge" />);
    expect(mockFireChallengeCompleteBurst).toHaveBeenCalledWith('badge');
  });

  it('defaults level to 1 when level prop is undefined', () => {
    mockUseReducedMotion.mockReturnValue(false);
    render(<ConfettiBurst trigger="level-up" />);
    expect(mockFireLevelUpBurst).toHaveBeenCalledWith(1);
  });
});
