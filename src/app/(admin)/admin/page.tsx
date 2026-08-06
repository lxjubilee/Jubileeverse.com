'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clearStoredAuth } from '@/lib/authStorage';
import CategoryManager from '@/components/admin-dashboard/CategoryManager';
import ArticlesPanel from '@/components/admin-dashboard/ArticlesPanel';
import ArticleEditorModal from '@/components/admin-dashboard/ArticleEditorModal';
import CurrentEventsQueue from '@/components/admin-dashboard/CurrentEventsQueue';
import PulseTasks, { type PulseTasksHandle } from '@/components/admin-dashboard/PulseTasks';
import NewTaskModal from '@/components/admin-dashboard/NewTaskModal';
import AdminChat from '@/components/admin-dashboard/AdminChat';
import type { DashCategory } from '@/components/admin-dashboard/types';
import styles from './dashboard.module.css';

/**
 * JubileeVerse back-office dashboard (route /admin). Faithful App Router port of
 * the original static public/admin/dashboard.html. Auth gating is handled by the
 * (admin) layout's <AdminGate>; this page assumes a CMS-capable user.
 */

type MainTab = 'content' | 'pulse-tasks' | 'portal-articles';

interface ToastState {
  msg: string;
  type: 'success' | 'error';
}

const PANEL_WIDTH_KEY = 'categoryPanelWidth';
const ACTIVE_TAB_KEY = 'jubileeActiveTab';
const CHAT_OPEN_KEY = 'jubileeChatOpen';

export default function AdminDashboardPage() {
  const { user } = useAuth();

  const [tab, setTab] = useState<MainTab>('content');
  const [selectedCategory, setSelectedCategory] = useState<DashCategory | null>(null);
  const [categoryHasChildren, setCategoryHasChildren] = useState(false);

  const [editingArticleId, setEditingArticleId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [panelWidth, setPanelWidth] = useState(35); // percent
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pulseRef = useRef<PulseTasksHandle>(null);

  // ----- Toast -----------------------------------------------------------
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ----- Restore persisted UI state (tab, panel width, chat) -------------
  useEffect(() => {
    try {
      const savedTab = localStorage.getItem(ACTIVE_TAB_KEY);
      if (savedTab === 'pulse-tasks' || savedTab === 'portal-articles') setTab(savedTab);

      const savedWidth = localStorage.getItem(PANEL_WIDTH_KEY);
      if (savedWidth) {
        const pct = parseFloat(savedWidth);
        if (!Number.isNaN(pct)) setPanelWidth(Math.max(20, Math.min(60, pct)));
      }

      if (localStorage.getItem(CHAT_OPEN_KEY) === 'true') setChatOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const switchTab = useCallback((next: MainTab) => {
    setTab(next);
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const onSelectCategory = useCallback((cat: DashCategory, hasChildren: boolean) => {
    setSelectedCategory(cat);
    setCategoryHasChildren(hasChildren);
  }, []);

  // ----- Resize handle (drag the divider, width persisted as %) ----------
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setPanelWidth(Math.max(20, Math.min(60, pct)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, `${panelWidth}%`);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [panelWidth]);

  const startResize = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  // ----- Chat toggle (persisted) -----------------------------------------
  const toggleChat = useCallback(() => {
    setChatOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHAT_OPEN_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const refreshPulse = useCallback(() => pulseRef.current?.reload(), []);

  // After a task is created in the modal: start its heartbeat, refresh tasks,
  // and (if chat is mounted) ask it to monitor the task for progress.
  const onTaskCreated = useCallback(
    async (taskId: number | string | undefined) => {
      refreshPulse();
      if (taskId == null) return;
      try {
        await api.post('/api/pulse-tasks/start-heartbeat', { task_id: taskId });
      } catch {
        showToast(`Failed to start task #${taskId}.`, 'error');
      }
      window.dispatchEvent(new CustomEvent('jv-monitor-task', { detail: { taskId } }));
    },
    [refreshPulse, showToast],
  );

  const logout = useCallback(() => {
    clearStoredAuth();
    window.location.href = '/signin';
  }, []);

  const userName =
    user?.displayName || user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Admin User';

  // Category path label for the New Task modal.
  const categoryPath = selectedCategory?.name || 'No category selected';

  const showNewContentBtn = tab !== 'portal-articles';
  const newContentLabel = tab === 'pulse-tasks' ? '+ New Task' : '+ New Content';
  const onNewContent = () => {
    if (tab === 'pulse-tasks') setShowNewTask(true);
    else showToast('New Content creation is not available in this build.', 'error');
  };

  return (
    <div className={styles.page}>
      {/* HEADER */}
      <header className={styles.adminHeader}>
        <h1>
          <span>
            <span style={{ color: 'var(--text-primary)' }}>Jubilee</span>
            <span style={{ color: 'var(--accent-gold)' }}>Verse</span>
            <span style={{ color: 'var(--text-primary)' }}>.com</span>
          </span>
          <span className={styles.adminSub}>Jubilee Intelligence Architecture (JIA)</span>
        </h1>
        <div className={styles.userInfo}>
          <span>{userName}</span>
          <button className={styles.btnLogout} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* TOP NAV — dashboard tabs + sibling admin routes */}
      <nav className={styles.topNav}>
        <span className={styles.navGroupLabel}>Dashboard</span>
        <button
          className={`${styles.navLink} ${tab === 'content' ? styles.active : ''}`}
          onClick={() => switchTab('content')}
        >
          Content
        </button>
        <button
          className={`${styles.navLink} ${tab === 'pulse-tasks' ? styles.active : ''}`}
          onClick={() => switchTab('pulse-tasks')}
        >
          Pulse Tasks
        </button>
        <button
          className={`${styles.navLink} ${tab === 'portal-articles' ? styles.active : ''}`}
          onClick={() => switchTab('portal-articles')}
        >
          Approval Queue
        </button>
        <span className={styles.navDivider} />
        <span className={styles.navGroupLabel}>Admin</span>
        <Link className={styles.navLink} href="/admin/articles">
          Articles
        </Link>
        <Link className={styles.navLink} href="/scanner">
          Scanner
        </Link>
        <Link className={styles.navLink} href="/reviewer-activity">
          Reviewer Activity
        </Link>
      </nav>

      {/* MAIN */}
      <div className={styles.dashboardContainer} ref={containerRef}>
        {/* LEFT: categories */}
        <div style={{ width: `${panelWidth}%`, display: 'flex', minWidth: 250 }}>
          <CategoryManager onSelect={onSelectCategory} onToast={showToast} />
        </div>

        {/* DIVIDER */}
        <div className={styles.resizeHandle} onMouseDown={startResize} />

        {/* RIGHT: tabbed content */}
        <div className={styles.articlePanel}>
          <div className={styles.articlePanelHeader}>
            <div className={styles.articlePanelTabs}>
              <button
                className={`${styles.tabButton} ${tab === 'content' ? styles.active : ''}`}
                onClick={() => switchTab('content')}
              >
                Content
              </button>
              <button
                className={`${styles.tabButton} ${tab === 'pulse-tasks' ? styles.active : ''}`}
                onClick={() => switchTab('pulse-tasks')}
              >
                Pulse Tasks
              </button>
              <button
                className={`${styles.tabButton} ${tab === 'portal-articles' ? styles.active : ''}`}
                onClick={() => switchTab('portal-articles')}
              >
                Portal Articles
              </button>
            </div>
            {showNewContentBtn ? (
              <button className={styles.btnNewContent} onClick={onNewContent}>
                {newContentLabel}
              </button>
            ) : null}
          </div>

          {tab === 'content' ? (
            <div className={styles.tabContent}>
              <ArticlesPanel
                category={selectedCategory}
                categoryHasChildren={categoryHasChildren}
                onOpenArticle={(id) => setEditingArticleId(id)}
              />
            </div>
          ) : null}

          {tab === 'pulse-tasks' ? (
            <div className={styles.tabContent}>
              <PulseTasks ref={pulseRef} />
            </div>
          ) : null}

          {tab === 'portal-articles' ? (
            <div className={styles.tabContent}>
              <CurrentEventsQueue onToast={showToast} />
            </div>
          ) : null}
        </div>

        {/* CHAT (right slide-in) */}
        {chatOpen ? <AdminChat onClose={toggleChat} onTaskActivity={refreshPulse} /> : null}
      </div>

      {/* CHAT FAB */}
      {!chatOpen ? (
        <button
          className={styles.chatToggleFab}
          onClick={toggleChat}
          title="Open Jubilee Inspire"
        >
          <img
            src="/brand/brand-logo.png"
            alt="Jubilee"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </button>
      ) : null}

      {/* MODALS */}
      {editingArticleId != null ? (
        <ArticleEditorModal
          articleId={editingArticleId}
          onClose={() => setEditingArticleId(null)}
          onSaved={() => setEditingArticleId(null)}
          onToast={showToast}
        />
      ) : null}

      {showNewTask ? (
        <NewTaskModal
          categoryLocation={categoryPath}
          onClose={() => setShowNewTask(false)}
          onCreated={(taskId) => void onTaskCreated(taskId)}
          onToast={showToast}
        />
      ) : null}

      {/* TOAST */}
      {toast ? (
        <div className={`${styles.toast} ${styles[toast.type]} ${styles.show}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}
