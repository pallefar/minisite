/**
 * RTL tests for StreakCard (VALIDATION row 35-06-03 / GAME-06 + GAME-03).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { GamificationDashboardData } from '@/lib/gamification/dashboard-data';
import { StreakCard } from '../StreakCard';

const baseData: GamificationDashboardData = {
  xpTotal: 0,
  level: 1,
  prestige: 0,
  xpToNext: 100,
  xpInLevel: 0,
  nextLevelXp: 100,
  streak: { current: 5, longest: 12, lastActionAt: null },
  freezeTokens: 2,
};

describe('StreakCard (GAME-06 + GAME-03)', () => {
  it('renders current streak and longest streak', () => {
    render(<StreakCard data={baseData} />);
    expect(screen.getByText(/5d/)).toBeInTheDocument();
    expect(screen.getByText(/Longest: 12d/)).toBeInTheDocument();
  });

  it('renders freeze token count (plural)', () => {
    render(<StreakCard data={baseData} />);
    expect(screen.getByText(/2 freeze tokens/)).toBeInTheDocument();
  });

  it('uses singular "token" when freeze count = 1', () => {
    render(<StreakCard data={{ ...baseData, freezeTokens: 1 }} />);
    expect(screen.getByText(/1 freeze token$/)).toBeInTheDocument();
  });

  it('renders zero streak without error', () => {
    render(<StreakCard data={{ ...baseData, streak: { current: 0, longest: 0, lastActionAt: null }, freezeTokens: 0 }} />);
    // aria-label on the ring svg contains the full text
    expect(screen.getByRole('img', { name: /0-day streak/i })).toBeInTheDocument();
    expect(screen.getByText(/0 freeze tokens/)).toBeInTheDocument();
  });

  it('renders the Streak card header', () => {
    render(<StreakCard data={baseData} />);
    expect(screen.getByText('Streak')).toBeInTheDocument();
  });
});
