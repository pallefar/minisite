#!/usr/bin/env node
// scripts/notion-mirror-hipaa-policies.mjs
// Phase 25 Plan 25-10 — HIPAA-11 Notion mirror of /legal/hipaa/ policies.
//
// Zero deps. Node 22 built-ins (fs, fetch).
// Idempotent via scripts/.notion-mirror-state.json mapping filename -> notion_page_id.
//
// Env vars:
//   NOTION_API_TOKEN           — required; if missing logs warn + exits 0 (vendor-gated pattern)
//   NOTION_HIPAA_PARENT_PAGE_ID — required if token present
//
// CLI flags:
//   --dry-run    Skip Notion API calls; print what would be created/updated
//   --json       Emit JSON report to stdout
//
// Limitation: Notion API accepts max 100 blocks per create/append call.
// Files with more than 100 lines will be truncated at the 100-block limit.
// This is documented as a known limitation; a paginated PATCH approach is
// deferred to post-v1.3 work. See: T-25-10-T1 in 25-10-PLAN.md threat model.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.NOTION_API_TOKEN;
const PARENT = process.env.NOTION_HIPAA_PARENT_PAGE_ID;

// Resolve paths relative to script location so the script works regardless
// of which directory it is invoked from.
const SCRIPT_DIR = new URL('.', import.meta.url).pathname;
const REPO_ROOT = join(SCRIPT_DIR, '..');
const STATE_PATH = join(SCRIPT_DIR, '.notion-mirror-state.json');
const POLICY_DIR = join(REPO_ROOT, 'legal', 'hipaa');

const DRY_RUN = process.argv.includes('--dry-run');
const JSON_MODE = process.argv.includes('--json');

const report = {
  dryRun: DRY_RUN,
  files: [],
};

if (!TOKEN || !PARENT) {
  // Vendor-gated pattern: log warning only, exit 0 so CI does not fail
  // when secrets are not yet configured. Once NOTION_API_TOKEN and
  // NOTION_HIPAA_PARENT_PAGE_ID are set as GitHub Secrets, the step will
  // run the full sync on every push to main.
  console.warn('[notion-mirror] credentials missing — vendor-gated no-op exit 0');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Markdown → Notion blocks
// Simple line-by-line converter. Supported: heading_1/2/3, bulleted_list_item,
// paragraph. Tables, code blocks, and inline images are NOT converted (v1.3
// scope; richer converter is post-v1.3 work).
// ---------------------------------------------------------------------------

/**
 * @param {string} md
 * @returns {Array<Record<string, unknown>>}
 */
function markdownToBlocks(md) {
  const blocks = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('### ')) {
      blocks.push({
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
      });
    } else if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
      });
    } else if (line.startsWith('- ')) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
      });
    } else if (line.trim() === '') {
      blocks.push({ type: 'paragraph', paragraph: { rich_text: [] } });
    } else {
      blocks.push({
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Notion API client
// Pattern S3 (security): log HTTP status only, never log response body
// (response body may contain token reflection or PHI in error messages).
// ---------------------------------------------------------------------------

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<unknown>}
 */
async function notionFetch(path, opts = {}) {
  const r = await fetch('https://api.notion.com/v1' + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) {
    // Log status code only — never log body (Pattern S3)
    throw new Error(`notion-api-${r.status}`);
  }
  return await r.json();
}

/**
 * Create a new Notion page as a child of PARENT with the given title and blocks.
 * Notion API limits children to 100 blocks per create call.
 *
 * @param {string} title
 * @param {Array<Record<string, unknown>>} blocks
 * @returns {Promise<{id: string}>}
 */
async function createPage(title, blocks) {
  return /** @type {{id: string}} */ (
    await notionFetch('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: PARENT },
        properties: {
          title: { title: [{ type: 'text', text: { content: title } }] },
        },
        children: blocks.slice(0, 100),
      }),
    })
  );
}

/**
 * Update the children of an existing Notion page by:
 * 1. Deleting all existing child blocks
 * 2. Appending the new blocks
 *
 * This makes the update idempotent — page content reflects the current
 * file state exactly. Note: deletes all children individually (Notion API
 * does not support bulk delete); 7 policy files × ~5 API calls each stays
 * well within Notion's ~3 req/s rate limit.
 *
 * @param {string} pageId
 * @param {Array<Record<string, unknown>>} blocks
 * @returns {Promise<void>}
 */
async function updatePageChildren(pageId, blocks) {
  const existing = /** @type {{results: Array<{id: string}>}} */ (
    await notionFetch(`/blocks/${pageId}/children`)
  );
  for (const block of existing.results) {
    await notionFetch(`/blocks/${block.id}`, { method: 'DELETE' });
  }
  await notionFetch(`/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children: blocks.slice(0, 100) }),
  });
}

// ---------------------------------------------------------------------------
// Main sync loop
// ---------------------------------------------------------------------------

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
const files = readdirSync(POLICY_DIR).filter((f) => f.endsWith('.md'));

for (const file of files) {
  const md = readFileSync(join(POLICY_DIR, file), 'utf8');
  const blocks = markdownToBlocks(md);
  const title = file.replace(/\.md$/, '');
  const action = state[file] ? 'update' : 'create';
  const pageId = state[file] ?? null;

  if (JSON_MODE) {
    report.files.push({ file, action, pageId, blockCount: blocks.length });
  }

  if (DRY_RUN) {
    console.log(`[notion-mirror] dry-run: would ${action} "${file}" (${blocks.length} blocks, capped at 100)`);
    continue;
  }

  try {
    if (pageId) {
      await updatePageChildren(pageId, blocks);
      console.log(`[notion-mirror] updated "${file}" -> ${pageId}`);
    } else {
      const page = /** @type {{id: string}} */ (await createPage(title, blocks));
      state[file] = page.id;
      console.log(`[notion-mirror] created "${file}" -> ${page.id}`);
    }
  } catch (e) {
    // Log error name only — never log body or error.message (may contain token or PHI context)
    console.error('[notion-mirror] failed', file, e instanceof Error ? e.name : 'unknown');
    process.exit(1);
  }
}

if (!DRY_RUN) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[notion-mirror] done — ${files.length} file(s) synced`);
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
