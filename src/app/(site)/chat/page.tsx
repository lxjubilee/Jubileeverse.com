'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError } from '@/lib/api';
import styles from './chat.module.css';

/** A single turn in the conversation, matching the backend's expected shape. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** POST /api/chat request body (verified from the original /chat/index.html). */
interface ChatRequest {
  message: string;
  history: ChatMessage[];
}

/** POST /api/chat response body. */
interface ChatResponse {
  success: boolean;
  response: string;
  error?: string;
}

interface Suggestion {
  icon: string;
  title: string;
  subtitle: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: '🎵',
    title: 'Music Albums',
    subtitle: 'Learn about Party Giggles albums',
    prompt: 'Tell me about the Party Giggles music albums',
  },
  {
    icon: 'ℹ️',
    title: 'About JubileeVerse',
    subtitle: 'Discover our mission',
    prompt: 'What is JubileeVerse?',
  },
  {
    icon: '📖',
    title: 'Daily Devotional',
    subtitle: 'Get spiritual encouragement',
    prompt: 'Give me a daily devotional',
  },
  {
    icon: '🙏',
    title: 'Faith Growth',
    subtitle: 'Tips for spiritual development',
    prompt: 'How can I grow in my faith?',
  },
];

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the conversation pinned to the latest message (auto-scroll).
  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // Focus the input on mount (matches the original window.load behavior).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );

  const flashError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 5000);
  }, []);

  // Auto-resize the textarea up to its max height as the user types.
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending) return;

      const userMsg: ChatMessage = { role: 'user', content: message };
      // History sent to the backend is everything BEFORE this turn (matches
      // the original, which pushed the user message after capturing history).
      const history = messages;

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      // Reset the textarea height after clearing.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) ta.style.height = 'auto';
      });
      setSending(true);
      setError(null);

      try {
        const body: ChatRequest = { message, history };
        const data = await api.post<ChatResponse>('/api/chat', body, { auth: false });

        if (data.success) {
          setMessages((prev) => [...prev, { role: 'assistant', content: data.response }]);
        } else {
          throw new Error(data.error || 'Unknown error');
        }
      } catch (err) {
        const detail =
          err instanceof ApiError || err instanceof Error ? err.message : 'request failed';
        console.error('Chat error:', detail);
        flashError('Sorry, I encountered an error. Please try again.');
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    },
    [messages, sending, flashError],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setMessages([]);
      setError(null);
      textareaRef.current?.focus();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <main className={styles.chatPage}>
      <div className={styles.chatBar}>
        <div className={styles.barLeft}>
          <div className={styles.barTitle}>
            <img src="/brand/jubilee-logo.png" alt="JubileeVerse" />
            Jubilee<span className={styles.verse}>Verse</span> AI
          </div>
          <div className={styles.statusIndicator}>
            <span className={`${styles.statusDot} ${sending ? styles.busy : ''}`} />
            <span>{sending ? 'Thinking…' : 'Ready'}</span>
          </div>
        </div>
        <div className={styles.barRight}>
          <button type="button" className={styles.barButton} onClick={clearChat}>
            Clear Chat
          </button>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => router.push('/')}
          >
            Home
          </button>
        </div>
      </div>

      {error ? <div className={styles.errorMessage}>{error}</div> : null}

      <div className={styles.chatBody}>
        <div className={styles.messagesArea} ref={messagesRef}>
          {!hasMessages ? (
            <div className={styles.welcomeMessage}>
              <h2>Welcome to JubileeVerse AI Assistant</h2>
              <p>
                I&apos;m here to help you explore faith, answer questions about the Bible, and
                provide spiritual guidance.
              </p>
              <p>How can I assist you today?</p>

              <div className={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    className={styles.suggestionCard}
                    onClick={() => void send(s.prompt)}
                  >
                    <h3>
                      {s.icon} {s.title}
                    </h3>
                    <p>{s.subtitle}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`${styles.message} ${styles[m.role]}`}>
                <div className={styles.messageAvatar}>{m.role === 'user' ? 'You' : 'AI'}</div>
                <div className={styles.messageContent}>
                  {m.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))
          )}

          {sending ? (
            <div className={`${styles.message} ${styles.assistant}`}>
              <div className={styles.messageAvatar}>AI</div>
              <div className={styles.messageContent}>
                <div className={styles.typingIndicator}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.inputArea}>
          <div className={styles.inputWrapper}>
            <textarea
              ref={textareaRef}
              className={styles.messageInput}
              placeholder="Type your message here..."
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => void send(input)}
            disabled={sending || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
