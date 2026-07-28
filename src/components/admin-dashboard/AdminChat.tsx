'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ChatMessage, ChatResponse, PulseTask } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * "Jubilee Inspire" chat panel (right side). Ported from dashboard.html chat:
 *   POST /api/chat/message  (header x-session-id, body { message })
 * Messages persist to localStorage; if the backend returns a taskId, the panel
 * polls GET /api/pulse-tasks/:taskId every 3s and reports completion/failure,
 * also calling onTaskActivity() so the parent can refresh the Pulse Tasks table.
 */

const MESSAGES_KEY = 'jubileeChatMessages';
const SESSION_KEY = 'jubileeChatSessionId';
const LOGO = '/images/JubileeLogo.png';

const WELCOME: ChatMessage = {
  text: "Hello there! I'm Jubilee Inspire 😊 I'll keep you updated on all your task progress and help you stay organized with your content. What can I help you with today?",
  isUser: false,
  timeString: '',
  timestamp: 0,
};

interface AdminChatProps {
  onClose: () => void;
  /** Called whenever a monitored task changes so the parent can refresh tasks. */
  onTaskActivity: () => void;
}

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `session_${Date.now()}`;
  }
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AdminChat({ onClose, onTaskActivity }: AdminChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resizable panel width (drag the left edge); persists to localStorage.
  const [chatWidth, setChatWidth] = useState(400);
  const chatWidthRef = useRef(400);
  const resizing = useRef(false);

  useEffect(() => {
    try {
      const w = parseInt(localStorage.getItem('jubileeChatWidth') || '', 10);
      if (w >= 300 && w <= 600) {
        setChatWidth(w);
        chatWidthRef.current = w;
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      // Panel is anchored right — width grows as the cursor moves left.
      const w = Math.min(600, Math.max(300, window.innerWidth - ev.clientX));
      chatWidthRef.current = w;
      setChatWidth(w);
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem('jubileeChatWidth', String(Math.round(chatWidthRef.current)));
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Task-monitoring poller.
  const monitored = useRef<Set<number | string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate persisted messages (skip the always-rendered welcome bubble).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MESSAGES_KEY);
      if (raw) setMessages(JSON.parse(raw) as ChatMessage[]);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const appendMessage = useCallback((text: string, isUser: boolean) => {
    const msg: ChatMessage = { text, isUser, timeString: nowTime(), timestamp: Date.now() };
    setMessages((prev) => {
      const next = [...prev, msg].slice(-100); // keep last 100, like the original
      try {
        localStorage.setItem(MESSAGES_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

  const checkTasks = useCallback(async () => {
    if (monitored.current.size === 0) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    for (const taskId of [...monitored.current]) {
      try {
        const task = await apiFetch<PulseTask>(`/api/pulse-tasks/${taskId}`);
        if (task.status === 'completed') {
          monitored.current.delete(taskId);
          appendMessage(`✅ Task #${taskId} "${task.title}" has completed successfully!`, false);
          onTaskActivity();
        } else if (task.status === 'failed') {
          monitored.current.delete(taskId);
          appendMessage(
            `❌ Task #${taskId} "${task.title}" has failed. Error: ${task.error_message || 'Unknown error'}`,
            false,
          );
          onTaskActivity();
        }
      } catch {
        /* keep polling; transient error */
      }
    }
  }, [appendMessage, onTaskActivity]);

  const startMonitoring = useCallback(
    (taskId: number | string) => {
      monitored.current.add(taskId);
      appendMessage(`Task #${taskId} has been started. I'll keep you updated on its progress.`, false);
      if (!pollTimer.current) {
        pollTimer.current = setInterval(() => void checkTasks(), 3000);
      }
    },
    [appendMessage, checkTasks],
  );

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message) return;
    appendMessage(message, true);
    setInput('');
    setTyping(true);
    try {
      const data = await apiFetch<ChatResponse>('/api/chat/message', {
        method: 'POST',
        json: { message },
        headers: { 'x-session-id': getSessionId() },
      });
      appendMessage(data.response, false);
      if (data.taskId != null) {
        startMonitoring(data.taskId);
        onTaskActivity();
      }
    } catch {
      appendMessage('Sorry, I encountered an error. Please try again.', false);
    } finally {
      setTyping(false);
    }
  }, [input, appendMessage, startMonitoring, onTaskActivity]);

  // Expose a way for the parent to push a task to monitor (e.g. from NewTaskModal).
  // Done via a custom event so the page doesn't need a ref into this component.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: number | string }>).detail;
      if (detail?.taskId != null) startMonitoring(detail.taskId);
    };
    window.addEventListener('jv-monitor-task', handler);
    return () => window.removeEventListener('jv-monitor-task', handler);
  }, [startMonitoring]);

  const allMessages = [WELCOME, ...messages];

  return (
    <div className={styles.chatPanel} style={{ width: chatWidth }}>
      <div
        className={styles.chatResizeHandle}
        onMouseDown={startResize}
        title="Drag to resize"
        aria-hidden="true"
      />
      <div className={styles.chatPanelHeader}>
        <button className={styles.btnChatClose} onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className={styles.chatPanelBody}>
        <div className={styles.chatMessages} ref={scrollRef}>
          {allMessages.map((m, i) => (
            <div
              key={i}
              className={`${styles.chatMessage} ${m.isUser ? styles.userMessage : ''}`}
            >
              {m.isUser ? null : (
                <div className={styles.messageAvatar}>
                  <img
                    src={LOGO}
                    alt="Jubilee"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      (e.currentTarget.parentElement as HTMLElement).textContent = 'J';
                    }}
                  />
                </div>
              )}
              <div className={styles.messageContent}>
                {m.isUser ? null : (
                  <div className={styles.messageHeader}>
                    <span className={styles.messageSender}>Jubilee Inspire</span>
                    <span className={styles.messageTime}>{m.timeString || nowTime()}</span>
                  </div>
                )}
                <div className={styles.messageText}>{m.text}</div>
              </div>
            </div>
          ))}

          {typing ? (
            <div className={styles.chatMessage}>
              <div className={styles.messageAvatar}>J</div>
              <div className={styles.messageContent}>
                <div className={`${styles.messageText} ${styles.typingText}`}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.chatInputContainer}>
          <textarea
            className={styles.chatInput}
            placeholder="Type your message to Jubilee..."
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Original sends on Ctrl/Cmd+Enter.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className={styles.btnSendChat}
            disabled={typing || !input.trim()}
            onClick={() => void send()}
            title="Send message"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
