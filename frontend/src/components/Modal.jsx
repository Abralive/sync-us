import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

let openModals = 0;

// Bottom sheet on phones, centred dialog on larger screens.
export default function Modal({ title, kicker, onClose, children, footer, size = "md", className = "" }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    openModals += 1;
    document.body.classList.add("has-modal");

    function handleKey(event) {
      if (event.key === "Escape") closeRef.current?.();
    }
    document.addEventListener("keydown", handleKey);
    const timer = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 20);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.classList.remove("has-modal");
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div className={`modal-root ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="modal-backdrop" aria-label="關閉" tabIndex={-1} onClick={onClose} />
      <section className={`modal-panel modal-${size}`} ref={panelRef} tabIndex={-1}>
        <span className="modal-grabber" aria-hidden="true" />
        <header className="modal-head">
          <div>
            {kicker && <span className="kicker">{kicker}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="關閉">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>,
    document.body
  );
}
