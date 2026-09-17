import { useEffect, useRef, type CSSProperties } from "react";
import "./runtimeConsole.css";

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  id: number;
  ts: number;
  level: ConsoleLevel;
  message: string;
}

export interface RuntimeConsoleProps {
  entries: ReadonlyArray<ConsoleEntry>;
  title?: string;
  emptyText?: string;
  clearLabel?: string;
  clearTitle?: string;
  onClear?: () => void;
  height?: CSSProperties["height"];
  className?: string;
  ariaLabel?: string;
}

export function RuntimeConsole({
  entries,
  title = "CONSOLE",
  emptyText = "No log output yet.",
  clearLabel = "Clear",
  clearTitle,
  onClear,
  height,
  className = "",
  ariaLabel,
}: RuntimeConsoleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  useEffect(() => {
    const body = bodyRef.current;
    if (body && followLatestRef.current) body.scrollTop = body.scrollHeight;
  }, [entries]);

  return (
    <section
      aria-label={ariaLabel ?? title}
      className={`anf-console ${className}`.trim()}
      style={height === undefined ? undefined : { height }}
    >
      <div className="anf-console-header">
        <div className="anf-console-tabs">
          <span className="anf-console-tab is-active">{title}</span>
          <span className="anf-console-counter">{entries.length}</span>
        </div>
        <span className="anf-console-spacer" />
        {onClear ? (
          <button
            type="button"
            className="anf-console-action"
            title={clearTitle ?? clearLabel}
            onClick={onClear}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
      <div
        className="anf-console-body"
        ref={bodyRef}
        onScroll={(event) => {
          const body = event.currentTarget;
          followLatestRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <div className="anf-console-empty">{emptyText}</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`anf-console-line anf-console-line--${entry.level}`}>
              <span className="anf-console-time">{formatTs(entry.ts)}</span>
              <span className={`anf-console-level anf-console-level--${entry.level}`}>{entry.level}</span>
              <span className="anf-console-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatTs(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
