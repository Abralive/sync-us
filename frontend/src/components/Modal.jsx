import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

let openModals = 0;

// Bottom sheet on phones, centred dialog on larger screens.
export default function Modal({ title, kicker, onClose, children, footer, size = "md", className = "" }) {
  const titleId = useId();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  // Where focus goes back on close. Read while rendering (before a field's autoFocus moves
  // focus into this sheet) and again once mounted (by then a sheet that closed in the same
  // step, e.g. a detail sheet replaced by its edit form, has handed focus back).
  const [focusAtRender] = useState(() => document.activeElement);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const focusAtMount = document.activeElement;
    openModals += 1;
    document.body.classList.add("has-modal");

    function handleKey(event) {
      if (event.key === "Escape") closeRef.current?.();
    }
    document.addEventListener("keydown", handleKey);
    // Focus the sheet itself unless a field inside already took focus (quick add types at once).
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }, 20);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.classList.remove("has-modal");
      // Elements inside this sheet are already gone (not connected) at this point.
      const target = [focusAtRender, focusAtMount].find(
        (element) => element && element !== document.body && element.isConnected && typeof element.focus === "function"
      );
      target?.focus({ preventScroll: true });
    };
  }, [focusAtRender]);

  // Phones: the on-screen keyboard covers the bottom of the layout viewport, so a bottom
  // sheet is lifted by the keyboard's height (0 everywhere else).
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = rootRef.current;
    if (!viewport || !root) return undefined;
    function update() {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(covered)}px`);
    }
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return createPortal(
    <div ref={rootRef} className={`modal-root ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
