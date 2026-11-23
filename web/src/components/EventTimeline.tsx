import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../App.module.scss";

export interface TimelineEvent {
  id: string;
  type: string;
  message?: string;
  data?: Record<string, unknown>;
  ts: number;
  keyId?: string;
  agentId?: string;
  role?: string;
}

type KindFilter = "all" | "llm" | "tools" | "verify" | "queue" | "error";

function kindOf(type: string): KindFilter {
  if (type === "llm" || type === "stats") return "llm";
  if (type === "tool_request" || type === "tool_result") return "tools";
  if (type === "verify" || type === "report" || type === "done") return "verify";
  if (type === "queue") return "queue";
  if (type === "error") return "error";
  return "all";
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function summarizeData(ev: TimelineEvent): string | null {
  if (!ev.data || typeof ev.data !== "object") return null;
  if (ev.type === "tool_request") {
    const args = ev.data.arguments ?? ev.data;
    const path = (args as { path?: string })?.path;
    const name = (ev.data as { name?: string }).name;
    if (path) return `path: ${path}`;
    if (name) return String(name);
    return JSON.stringify(args).slice(0, 120);
  }
  if (ev.type === "tool_result") {
    const content = ev.data.content ?? ev.data.result ?? ev.data;
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return text.slice(0, 160) + (text.length > 160 ? "…" : "");
  }
  if (ev.type === "queue") {
    return JSON.stringify(ev.data).slice(0, 140);
  }
  return null;
}

function shortModel(message?: string): string | undefined {
  if (!message) return undefined;
  // "step 3 via cloud/nvidia/…:free" → keep readable tail
  const via = message.match(/via\s+(\S+)/i);
  if (via?.[1]) {
    const parts = via[1].split("/");
    return parts[parts.length - 1];
  }
  return message.length > 90 ? `${message.slice(0, 90)}…` : message;
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const agents = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) if (e.agentId) ids.add(e.agentId);
    return [...ids];
  }, [events]);

  const shown = useMemo(() => {
    return events.filter((e) => {
      if (agentFilter !== "all" && e.agentId !== agentFilter && e.role !== agentFilter) return false;
      if (kindFilter !== "all" && kindOf(e.type) !== kindFilter) return false;
      // stats-only rows are noise in the feed
      if (e.type === "stats" && !e.message) return false;
      return true;
    });
  }, [events, agentFilter, kindFilter]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = nearBottom;
  };

  return (
    <div className={styles.timelinePanel} data-testid="timeline-panel">
      <div className={styles.timelineHeader}>
        <div>
          <h2>Timeline</h2>
          <p className={styles.muted}>
            {events.length ? `${shown.length} shown · ${events.length} total` : "No events yet"}
          </p>
        </div>
        <label className={styles.timelineFilter}>
          Agent
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter timeline by agent"
          >
            <option value="all">All</option>
            {agents.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            <option value="worker">Workers</option>
            <option value="orchestrator">Orchestrator</option>
            <option value="verifier">Verifier</option>
          </select>
        </label>
      </div>

      <div className={styles.kindChips} role="toolbar" aria-label="Filter by event kind">
        {(
          [
            ["all", "All"],
            ["llm", "LLM"],
            ["tools", "Tools"],
            ["verify", "Verify"],
            ["queue", "Queue"],
            ["error", "Errors"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.kindChip} ${kindFilter === id ? styles.kindChipActive : ""}`}
            onClick={() => setKindFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={styles.timeline}
        data-testid="timeline"
        ref={scrollerRef}
        onScroll={onScroll}
      >
        {shown.map((ev) => {
          const preview = summarizeData(ev);
          const msg =
            ev.type === "llm" ? shortModel(ev.message) : ev.message?.length
              ? ev.message.length > 140
                ? `${ev.message.slice(0, 140)}…`
                : ev.message
              : undefined;
          return (
            <article
              key={ev.id}
              className={`${styles.event} ${ev.type === "error" ? styles.eventError : ""} ${
                ev.type === "verify" || ev.type === "report" || ev.type === "done"
                  ? styles.eventVerify
                  : ""
              }`}
            >
              <header className={styles.eventHead}>
                <span className={styles.eventType}>{ev.type}</span>
                {ev.agentId ? <span className={styles.eventMeta}>{ev.agentId}</span> : null}
                <span className={styles.eventTime}>{formatTime(ev.ts)}</span>
              </header>
              {msg ? <p className={styles.eventMsg}>{msg}</p> : null}
              {preview ? (
                <details className={styles.eventDetails}>
                  <summary>{preview}</summary>
                  <pre className={styles.diff}>
                    {JSON.stringify(ev.data, null, 2).slice(0, 1200)}
                  </pre>
                </details>
              ) : null}
            </article>
          );
        })}
        {!shown.length && <p className={styles.muted}>Events stream here when a run starts.</p>}
      </div>
    </div>
  );
}
