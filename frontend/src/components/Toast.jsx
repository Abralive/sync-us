import { useEffect } from "react";

export default function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onDone, toast.tone === "error" ? 4800 : 3200);
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
