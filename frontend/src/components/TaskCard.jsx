import { useRef, useState } from "react";
import { request } from "../api/client.js";
import { formatDateTime } from "../utils/date.js";
import { playPop, unlockAudio } from "../utils/sound.js";

const POP_HOLD_MS = 1100;

export default function TaskCard({ task, onRefresh, variant = "garden", index = 0, onOpenDetails, activeUser }) {
  const [holding, setHolding] = useState(false);
  const [popping, setPopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimer = useRef(null);
  const poppedRef = useRef(false);
  const weightTone = task.priority_weight >= 80 ? "heavy" : task.priority_weight >= 55 ? "medium" : "light";

  async function popComplete() {
    setBusy(true);
    try {
      await request(`/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser }),
      });
    } finally {
      setBusy(false);
      onRefresh();
    }
  }

  function startHold(event) {
    event.preventDefault();
    if (task.is_completed || busy || popping) return;
    unlockAudio();
    poppedRef.current = false;
    setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      setHolding(false);
      setPopping(true);
      poppedRef.current = true;
      playPop();
      if (navigator.vibrate) navigator.vibrate([40, 30, 80]);
      popComplete();
      window.setTimeout(() => setPopping(false), 850);
    }, POP_HOLD_MS);
  }

  function cancelHold() {
    window.clearTimeout(holdTimer.current);
    setHolding(false);
  }

  function handleClick() {
    if (poppedRef.current) {
      poppedRef.current = false;
      return;
    }
    if (onOpenDetails) onOpenDetails();
  }

  const burst = popping && (
    <span className="pop-burst" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className="pop-shard" style={{ "--i": i }}></span>
      ))}
    </span>
  );

  return (
    <button
      className={`garden-bubble-orb ${weightTone} ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}
      style={{ "--float-delay": `${index * -0.85}s`, "--hold-ms": `${POP_HOLD_MS}ms` }}
      onClick={handleClick}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${task.title}，輕點看細節，長按完成`}
    >
      <span className="bubble-ring"></span>
      <span className="bubble-glass"></span>
      <span className="bubble-sheen"></span>
      <span className="task-bubble-core"></span>
      <span className="garden-title">{task.title}</span>
      <span className="garden-date">{formatDateTime(task.due_time)}</span>
      {holding && <span className="garden-hold-hint">快破了</span>}
      {burst}
    </button>
  );
}
