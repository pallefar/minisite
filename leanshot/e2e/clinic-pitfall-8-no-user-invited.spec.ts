// Phase 9 Plan 09-01 Wave-0 scaffold for Pitfall #8 scenario (b):
// no-personal-user + invited (signup-from-invite).
import { test } from '@playwright/test';

test.fixme(
  'Pitfall #8 scenario (b): new-user signup-from-invite produces ONE auth.users row — Plan 09-09 implements',
  async () => {
    // Pitfall #1 race: tab-1 signup-from-invite + tab-2 marketing-page signup
    // must collapse to ONE auth.users row via supabase.auth.signUp's
    // UNIQUE(email) serializer. Plan 09-09 spec asserts the second signUp
    // surfaces an "email exists" error and routes the user to State C.
  },
);
