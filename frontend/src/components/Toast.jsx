import { useEffect, useState } from "react";

// A short message at the bottom (top while a sheet is open). Messages with an action
// ("復原") stay longer, and the timer pauses while the pointer or keyboard focus is on it.
export default function Toast({ toast, onDone }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setPaused(false);
  }, [toast?.id]);

  useEffect(() => {
    if (!toast || paused) return undefined;
    const delay = toast.duration || (toast.action ? 7000 : toast.tone === "error" ? 4800 : 3200);
    const timer = window.setTimeout(onDone, delay);
    return () => window.clearTimeout(timer);
  }, [toast, onDone, paused]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone}${toast.action ? " has-action" : ""}`}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className="toast-text">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const { onClick } = toast.action;
                onDone();
                onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
