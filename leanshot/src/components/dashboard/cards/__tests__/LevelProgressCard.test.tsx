/**
 * RTL tests for LevelProgressCard (VALIDATION row 35-06-03 / GAME-06).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { GamificationDashboardData } from '@/lib/gamification/dashboard-data';
import { LevelProgressCard } from '../LevelProgressCard';

const baseData: GamificationDashboardData = {
  xpTotal: 500,
  level: 2,
  prestige: 0,
  xpToNext: 400,
  xpInLevel: 100,
  nextLevelXp: 900,
  streak: { current: 0, longest: 0, lastActionAt: null },
  freezeTokens: 0,
};

describe('LevelProgressCard (GAME-06)', () => {
  it('renders the level number and XP-to-next-level text', () => {
    render(<LevelProgressCard data={baseData} />);
    // Level number shown in aria-label on the SVG ring
    expect(screen.getByRole('img', { name: /Level 2/i })).toBeInTheDocument();
    // XP-to-next below the ring
    expect(screen.getByText(/400 XP to level 3/i)).toBeInTheDocument();
  });

  it('displays prestige indicator when prestige > 0', () => {
    const prestigeData: GamificationDashboardData = {
      ...baseData,
      level: 100,
      prestige: 1,
      xpToNext: 20200,
      xpInLevel: 0,
      nextLevelXp: 1020100,
    };
    render(<LevelProgressCard data={prestigeData} />);
    // Level 100 is max display, prestige P1 shown
    expect(screen.getByText(/P1/)).toBeInTheDocument();
  });

  it('caps display level at 100', () => {
    const highLevel: GamificationDashboardData = {
      ...baseData,
      level: 105,
      prestige: 1,
    };
    render(<LevelProgressCard data={highLevel} />);
    // Display should cap at 100 (appears in aria-label)
    expect(screen.getByRole('img', { name: /Level 100/i })).toBeInTheDocument();
  });

  it('renders the Level card header', () => {
    render(<LevelProgressCard data={baseData} />);
    expect(screen.getByText('Level')).toBeInTheDocument();
  });
});
