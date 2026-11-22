import { useEffect, useRef } from "react";
import styles from "../App.module.scss";

export interface ChatBubble {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  runId?: string;
}

export function OperatorChat({
  messages,
  queued,
  draft,
  setDraft,
  busy,
  disabled,
  onSend,
}: {
  messages: ChatBubble[];
  queued: string[];
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, queued.length]);

  return (
    <div className={styles.chatHost} data-testid="operator-chat">
      <div className={styles.chatTranscript} data-testid="chat-transcript">
        {!messages.length && (
          <p className={styles.muted}>
            Send a goal to start a Solo or Swarm run. Follow-ups queue while a run is active.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.chatBubble} ${
              m.role === "user" ? styles.chatUser : m.role === "assistant" ? styles.chatAssistant : styles.chatSystem
            }`}
          >
            <div className={styles.chatMeta}>
              {m.role}
              {m.runId ? ` · ${m.runId.slice(0, 8)}` : ""}
            </div>
            <pre className={styles.chatText}>{m.text}</pre>
          </div>
        ))}
        {queued.length > 0 && (
          <div className={styles.chatQueue} data-testid="chat-queue">
            <span className={styles.muted}>Queued</span>
            {queued.map((q, i) => (
              <span key={`${i}-${q.slice(0, 12)}`} className={styles.badge}>
                {q.length > 48 ? `${q.slice(0, 48)}…` : q}
              </span>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className={styles.chatComposer}>
        <textarea
          data-testid="chat-composer"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? "Open a project first" : "Message the operator agent…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && !disabled && draft.trim()) onSend();
            }
          }}
        />
        <button
          type="button"
          data-testid="chat-send"
          disabled={busy || disabled || !draft.trim()}
          onClick={onSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}
