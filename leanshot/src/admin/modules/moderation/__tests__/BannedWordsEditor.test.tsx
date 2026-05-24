// Phase 48 — BannedWordsEditor test (scaffold).
// WAVE 0: RED. Drives Plan 48-10 to GREEN.

import { describe, it } from 'vitest';

describe('BannedWordsEditor', () => {
  it.todo('renders empty state when no banned_words');
  it.todo('lists existing words with severity badge (warn/flag/escalate)');
  it.todo('add: opens form, validates non-empty word + severity select, calls banned_word_upsert RPC');
  it.todo('edit: pre-fills form, saves via banned_word_upsert (UPDATE branch)');
  it.todo('delete: confirms then calls banned_word_remove RPC');
  it.todo('case-insensitive toggle persists');
  it.todo('non-staff caller cannot mount editor (route guard)');
});
