// scripts/__tests__/sync-store-release-notes.test.mjs
// Phase 71 Plan 71-02 Task 1 (PU-04) — unit tests for the markdown→plain-text
// store-notes transform + file-target selection + newest-published pick logic.
//
// Imports the PURE helpers from the .mjs (the module guards its live main() with
// `if (import.meta.url === file://${process.argv[1]})`, so importing here never
// touches the DB / network).
//
// Collected via vitest.config.ts `test.include` widened to
// 'scripts/**/__tests__/*.test.mjs'.

import { describe, it, expect } from 'vitest';
import {
  markdownToPlainText,
  resolveTargets,
  pickEntry,
  entryToReleaseNotes,
} from '../sync-store-release-notes.mjs';

describe('markdownToPlainText', () => {
  it('strips headings, list markers, bold, and link syntax (CONTEXT sample)', () => {
    const md = '# Title\n\n- **Bold** item\n- [link](https://x)';
    const out = markdownToPlainText(md);

    // No markdown syntax leaks through.
    expect(out).not.toMatch(/[#*]/);
    expect(out).not.toMatch(/\]\(/);

    // Heading text + link text are preserved; URL dropped.
    expect(out).toContain('Title');
    expect(out).toContain('Bold item');
    expect(out).toContain('link');
    expect(out).not.toContain('https://x');
  });

  it('unwraps ATX headings to plain text', () => {
    expect(markdownToPlainText('## Heading 2')).toBe('Heading 2');
    expect(markdownToPlainText('### Deeper')).toBe('Deeper');
  });

  it('removes italic and underscore emphasis markers', () => {
    expect(markdownToPlainText('this is *emphasised* and __strong__')).toBe(
      'this is emphasised and strong',
    );
  });

  it('strips inline code backticks while keeping the code text', () => {
    expect(markdownToPlainText('run `node script.mjs` now')).toBe('run node script.mjs now');
  });

  it('strips blockquote markers', () => {
    expect(markdownToPlainText('> quoted line')).toBe('quoted line');
  });

  it('normalises ordered list markers', () => {
    expect(markdownToPlainText('1. first\n2. second')).toBe('first\nsecond');
  });

  it('collapses 3+ blank lines to a single blank line and trims', () => {
    const out = markdownToPlainText('a\n\n\n\n\nb\n\n\n');
    expect(out).toBe('a\n\nb');
  });

  it('returns empty string for null/undefined', () => {
    expect(markdownToPlainText(null)).toBe('');
    expect(markdownToPlainText(undefined)).toBe('');
  });
});

describe('resolveTargets', () => {
  it('android path ends with changelogs/<versionCode>.txt', () => {
    const { androidPath } = resolveTargets('2.0.0', 1);
    expect(androidPath.endsWith('changelogs/1.txt')).toBe(true);
  });

  it('ios path ends with the release_notes.txt metadata file', () => {
    const { iosPath } = resolveTargets('2.0.0', 1);
    expect(iosPath.endsWith('fastlane/metadata/ios/en-US/release_notes.txt')).toBe(true);
  });

  it('uses a different versionCode in the android filename', () => {
    const { androidPath } = resolveTargets('2.1.0', 42);
    expect(androidPath.endsWith('changelogs/42.txt')).toBe(true);
  });
});

describe('pickEntry', () => {
  const rows = [
    {
      title: 'Older',
      body_md: 'old',
      version: '2.0.0',
      status: 'published',
      published_at: '2026-05-01T00:00:00Z',
    },
    {
      title: 'Newest',
      body_md: 'new',
      version: '2.0.0',
      status: 'published',
      published_at: '2026-05-20T00:00:00Z',
    },
    {
      title: 'Draft (ignored)',
      body_md: 'draft',
      version: '2.0.0',
      status: 'draft',
      published_at: '2026-05-25T00:00:00Z',
    },
  ];

  it('returns the newest published row matching the version', () => {
    const entry = pickEntry(rows, '2.0.0');
    expect(entry).not.toBeNull();
    expect(entry.title).toBe('Newest');
  });

  it('ignores draft rows even if they are newer', () => {
    const entry = pickEntry(rows, '2.0.0');
    expect(entry.status).toBe('published');
  });

  it('returns null when no published row matches the version', () => {
    expect(pickEntry(rows, '9.9.9')).toBeNull();
  });

  it('returns null for an empty/invalid result set', () => {
    expect(pickEntry([], '2.0.0')).toBeNull();
    expect(pickEntry(null, '2.0.0')).toBeNull();
  });
});

describe('entryToReleaseNotes', () => {
  it('prepends the title and strips markdown from the body', () => {
    const notes = entryToReleaseNotes({
      title: 'Release 2.0',
      body_md: '# Heading\n\n- **Faster** sync',
    });
    expect(notes.startsWith('Release 2.0\n\n')).toBe(true);
    expect(notes).toContain('Faster sync');
    expect(notes).not.toMatch(/[#*]/);
    expect(notes.endsWith('\n')).toBe(true);
  });
});
