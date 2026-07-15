import { useRef, useState } from "react";
import { request } from "../api/client.js";
import { countdownText, formatDateTime } from "../utils/date.js";
import { playPop, unlockAudio } from "../utils/sound.js";

const POP_HOLD_MS = 1100;

export default function TaskCard({ task, onRefresh, variant = "card", index = 0, onOpenDetails, activeUser }) {
  const [holding, setHolding] = useState(false);
  const [popping, setPopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimer = useRef(null);
  const poppedRef = useRef(false);

  const isUrgent = !task.is_completed && new Date(task.due_time) - new Date() < task.reminder_minutes * 60000;
  const weightTone = task.priority_weight >= 80 ? "heavy" : task.priority_weight >= 55 ? "medium" : "light";

  async function popComplete() {
    setBusy(true);
    try {
      await request(`/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser }),
      });
    } catch {
      // 已完成或競態：忽略，交給 refresh 同步狀態
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

  if (variant === "garden") {
    return (
      <button
        className={`garden-bubble-orb ${weightTone} ${task.is_completed ? "completed" : ""} ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}
        style={{ "--float-delay": `${index * -0.85}s`, "--hold-ms": `${POP_HOLD_MS}ms` }}
        onClick={handleClick}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="bubble-ring"></span>
        <span className="bubble-glass"></span>
        <span className="bubble-sheen"></span>
        <span className="task-bubble-core"></span>
        <span className="garden-title">{task.title}</span>
        <span className="garden-date">{formatDateTime(task.due_time)}</span>
        {holding && <span className="garden-hold-hint">快破了…</span>}
        {burst}
      </button>
    );
  }

  return (
    <article className={`task-card ${weightTone} ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}>
      <div className="task-card-top">
        <div className="task-meta">
          <span className={`pill ${task.is_private ? "pill-private" : "pill-shared"}`}>
            {task.is_private ? "私人軌道" : "共享星域"}
          </span>
          <span className={`pill weight-${weightTone}`}>重要度 {task.priority_weight}</span>
          {isUrgent && <span className="pill urgent">⏰ 快到期</span>}
        </div>
        <h3 className="task-title">{task.title}</h3>
        <p className="task-detail">{formatDateTime(task.due_time)} · {countdownText(task.due_time)}</p>
        {task.assigned_to_name && <p className="task-detail">交給 {task.assigned_to_name}</p>}
        {task.description && <p className="task-detail dim">{task.description}</p>}
        {task.collaboration_note && <p className="task-detail dim">📝 {task.collaboration_note}</p>}
      </div>

      <button
        type="button"
        className={`pop-btn ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}
        style={{ "--hold-ms": `${POP_HOLD_MS}ms` }}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => event.preventDefault()}
        disabled={busy}
      >
        {holding ? "再撐一下…快破了！" : popping ? "啵！" : "🫧 長按戳破完成"}
        {burst}
      </button>
    </article>
  );
}
