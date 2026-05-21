/**
 * Phase 37 Plan 37-08 Task 2 — KBEditorPage (HELP-07 + HELP-08).
 *
 * Admin authoring surface for kb_articles. Side-by-side markdown editor with
 * live preview via react-markdown + DOMPurify (same sanitization stack as the
 * widget-side KBArticleView from Plan 37-06).
 *
 * Locale model (D-08):
 *   - editLocale = 'en'  → editing fields .title / .body
 *   - editLocale = 'es'  → editing fields .title_es / .body_es
 *   - State for EN and ES is held separately so toggling never clobbers the
 *     other locale's draft.
 *
 * Publish flow:
 *   - Calls publish_kb_article SECDEF RPC (Task 1 of this plan). The RPC
 *     atomically writes a kb_article_versions snapshot + UPDATEs kb_articles.
 *   - On success, refetch article + version list.
 *
 * Role gate (T-37-08-01 mitigation):
 *   - UI disables Publish for non-admin roles (RLS + RPC also enforce server-
 *     side; UI gate is purely UX so users see a disabled button + tooltip).
 */
import DOMPurify from 'dompurify';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────
interface KBArticle {
  id: string;
  org_id: string | null;
  slug: string;
  title: string;
  body: string;
  title_es: string | null;
  body_es: string | null;
  locale_set: string[];
  published_at: string | null;
  published_version: number;
  created_by: string | null;
  updated_at: string | null;
}

interface KBVersion {
  id: string;
  article_id: string;
  version: number;
  title: string;
  body: string;
  title_es: string | null;
  body_es: string | null;
  published_by: string | null;
  published_at: string;
}

type EditLocale = 'en' | 'es';

const ADMIN_ROLES = new Set(['owner', 'support_admin', 'support_lead']);

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function KBEditorPage(): React.JSX.Element {
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<KBArticle | null>(null);
  const [versions, setVersions] = useState<KBVersion[]>([]);

  // Editor fields — held separately per locale so toggling doesn't clobber.
  const [editTitle, setEditTitle] = useState<string>('');
  const [editBody, setEditBody] = useState<string>('');
  const [editTitleEs, setEditTitleEs] = useState<string>('');
  const [editBodyEs, setEditBodyEs] = useState<string>('');
  const [editLocale, setEditLocale] = useState<EditLocale>('en');

  // Role state (drives Publish enable).
  const [role, setRole] = useState<string | null>(null);

  // Misc UI.
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState<string>('');
  const [showNew, setShowNew] = useState<boolean>(false);

  // ─── Fetch article list ───────────────────────────────────────────────────
  const fetchArticles = useCallback(async () => {
    const builder = supabase
      .from('kb_articles')
      .select(
        'id, org_id, slug, title, body, title_es, body_es, locale_set, published_at, published_version, created_by, updated_at',
      )
      .order('updated_at', { ascending: false });
    const { data, error } = (await builder) as {
      data: KBArticle[] | null;
      error: { message: string } | null;
    };
    if (error) {
      setErr(error.message);
      return;
    }
    setArticles(data ?? []);
  }, []);

  // ─── Fetch role for current user (first matching org_members row) ────────
  const fetchRole = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('org_members')
      .select('role, org_id, user_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    const memberRole = (data as { role?: string } | null)?.role ?? null;
    setRole(memberRole);
  }, []);

  // ─── Fetch single article + versions on selection ───────────────────────
  const loadArticle = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('kb_articles')
      .select(
        'id, org_id, slug, title, body, title_es, body_es, locale_set, published_at, published_version, created_by, updated_at',
      )
      .eq('id', id)
      .single();
    if (error) {
      setErr(error.message);
      return;
    }
    const article = data as KBArticle | null;
    if (!article) return;
    setCurrent(article);
    setEditTitle(article.title);
    setEditBody(article.body);
    setEditTitleEs(article.title_es ?? '');
    setEditBodyEs(article.body_es ?? '');

    const versionsResult = (await supabase
      .from('kb_article_versions')
      .select('id, article_id, version, title, body, title_es, body_es, published_by, published_at')
      .eq('article_id', id)
      .order('version', { ascending: false })
      .limit(20)) as { data: KBVersion[] | null; error: { message: string } | null };
    setVersions(versionsResult.data ?? []);
  }, []);

  // Initial load.
  useEffect(() => {
    void fetchArticles();
    void fetchRole();
  }, [fetchArticles, fetchRole]);

  // Load article on selection.
  useEffect(() => {
    if (selectedId) void loadArticle(selectedId);
  }, [selectedId, loadArticle]);

  // ─── New-article handler ──────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!newSlug.trim()) return;
    setBusy(true);
    setErr(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;
    // org_id resolution: read from org_members first row.
    const { data: memData } = await supabase
      .from('org_members')
      .select('org_id, user_id, role')
      .eq('user_id', userId ?? '')
      .limit(1)
      .single();
    const orgId = (memData as { org_id?: string } | null)?.org_id ?? null;
    const insertResult = await supabase
      .from('kb_articles')
      .insert({
        slug: newSlug.trim(),
        title: 'Untitled',
        body: '',
        org_id: orgId,
        created_by: userId,
      })
      .select()
      .single();
    setBusy(false);
    const inserted = (insertResult as { data: KBArticle | null }).data;
    if (inserted) {
      setShowNew(false);
      setNewSlug('');
      await fetchArticles();
      setSelectedId(inserted.id);
    }
  }, [newSlug, fetchArticles]);

  // ─── Publish handler ──────────────────────────────────────────────────────
  const canPublish = !!current && !!role && ADMIN_ROLES.has(role);

  const handlePublish = useCallback(async () => {
    if (!current || !canPublish) return;
    setBusy(true);
    setErr(null);
    const localeSet: string[] = ['en'];
    if (editTitleEs.trim() || editBodyEs.trim()) localeSet.push('es');
    const { error } = await supabase.rpc('publish_kb_article', {
      p_article_id: current.id,
      p_title: editTitle,
      p_body: editBody,
      p_title_es: editTitleEs.trim() ? editTitleEs : null,
      p_body_es: editBodyEs.trim() ? editBodyEs : null,
      p_locale_set: localeSet,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    await fetchArticles();
    await loadArticle(current.id);
  }, [current, canPublish, editTitle, editBody, editTitleEs, editBodyEs, fetchArticles, loadArticle]);

  // ─── Preview-source selection ─────────────────────────────────────────────
  const previewBody = editLocale === 'en' ? editBody : editBodyEs;
  const sanitizedPreview = useMemo(
    () => DOMPurify.sanitize(previewBody, { USE_PROFILES: { html: true } }),
    [previewBody],
  );

  // ─── Bind textarea/input to correct locale ────────────────────────────────
  const titleValue = editLocale === 'en' ? editTitle : editTitleEs;
  const bodyValue = editLocale === 'en' ? editBody : editBodyEs;
  const setTitleValue = (v: string): void => {
    if (editLocale === 'en') setEditTitle(v);
    else setEditTitleEs(v);
  };
  const setBodyValue = (v: string): void => {
    if (editLocale === 'en') setEditBody(v);
    else setEditBodyEs(v);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[40%_60%] min-h-[600px]">
      {/* Article list ------------------------------------------------------ */}
      <aside className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Articles</h2>
          <button
            type="button"
            className="px-2 py-1 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
            onClick={() => setShowNew((v) => !v)}
            disabled={!canPublish}
            aria-label="New article"
          >
            + New article
          </button>
        </div>
        {showNew && (
          <div className="flex flex-col gap-2 p-2 border border-[var(--color-border)] rounded">
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="slug-for-new-article"
              aria-label="New article slug"
              className="px-2 py-1 text-xs border border-[var(--color-border)] rounded"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy || !newSlug.trim()}
              className="px-2 py-1 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
            >
              Create
            </button>
          </div>
        )}
        {err && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {err}
          </p>
        )}
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {articles.length === 0 ? (
            <li className="text-xs text-[var(--color-text-secondary)]">
              No articles yet
            </li>
          ) : (
            articles.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={
                    selectedId === a.id
                      ? 'w-full text-left px-2 py-1 text-xs rounded bg-[var(--color-surface-elevated)]'
                      : 'w-full text-left px-2 py-1 text-xs rounded hover:bg-[var(--color-surface-elevated)]'
                  }
                >
                  <span className="block font-medium">{a.title}</span>
                  <span className="block text-[10px] text-[var(--color-text-secondary)]">
                    {a.slug} · v{a.published_version}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Editor + preview -------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        {!current ? (
          <p className="text-sm text-[var(--color-text-secondary)] p-4">
            Select an article on the left, or create a new one.
          </p>
        ) : (
          <>
            {/* Locale toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-secondary)]">
                Locale:
              </span>
              <button
                type="button"
                aria-pressed={editLocale === 'en'}
                onClick={() => setEditLocale('en')}
                className={
                  editLocale === 'en'
                    ? 'px-2 py-0.5 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'px-2 py-0.5 text-xs rounded border border-[var(--color-border)]'
                }
              >
                EN
              </button>
              <button
                type="button"
                aria-pressed={editLocale === 'es'}
                onClick={() => setEditLocale('es')}
                className={
                  editLocale === 'es'
                    ? 'px-2 py-0.5 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'px-2 py-0.5 text-xs rounded border border-[var(--color-border)]'
                }
              >
                ES
              </button>
              <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">
                v{current.published_version} · {formatRelative(current.published_at)}
              </span>
            </div>

            {/* Title */}
            <label className="flex flex-col gap-1 text-xs">
              <span>Title</span>
              <input
                type="text"
                aria-label="Title"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                className="px-2 py-1 text-sm border border-[var(--color-border)] rounded"
              />
            </label>

            {/* Body + preview side-by-side */}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span>Body (markdown)</span>
                <textarea
                  aria-label="Body"
                  value={bodyValue}
                  onChange={(e) => setBodyValue(e.target.value)}
                  rows={18}
                  className="px-2 py-1 text-sm font-mono border border-[var(--color-border)] rounded"
                />
              </label>
              <div className="flex flex-col gap-1 text-xs">
                <span>Preview</span>
                <div className="prose prose-sm max-w-none p-2 border border-[var(--color-border)] rounded min-h-[200px]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                  >
                    {sanitizedPreview}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Publish */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={!canPublish || busy}
                aria-label="Publish"
                title={
                  canPublish
                    ? 'Publish a new version'
                    : 'Only owner / support_admin / support_lead can publish'
                }
                className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
              >
                Publish
              </button>
              {!canPublish && (
                <span className="text-xs text-[var(--color-text-secondary)]">
                  Read-only (role: {role ?? 'unknown'})
                </span>
              )}
            </div>

            {/* Version history */}
            <div className="mt-4">
              <h3 className="text-xs font-semibold mb-2">Version history</h3>
              {versions.length === 0 ? (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  No prior versions
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between text-xs px-2 py-1 border border-[var(--color-border)] rounded"
                    >
                      <span className="font-mono">{`v${v.version}`}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {formatRelative(v.published_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
