// PHASE-44-06 STUB. 44-08 replaces this file with the real implementation.
// The prop signature here MUST match 44-08's final component exactly.
// See 44-08-PLAN.md Task 1 Step 3.
import type { CommunityPost } from '@/lib/community/community-types';

export interface CommunityPostMediaStripProps {
  post: CommunityPost;
  mediaSignedUrls: Record<string, string>;
}

// Empty render; 44-08 will replace with the real strip (image carousel + lazy Mux player).
export function CommunityPostMediaStrip(_props: CommunityPostMediaStripProps): null {
  return null;
}

export default CommunityPostMediaStrip;
