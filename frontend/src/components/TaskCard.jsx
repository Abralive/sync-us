import { useRef, useState } from "react";
import { request } from "../api/client.js";
import { formatDateTime } from "../utils/date.js";
import { playPop, unlockAudio } from "../utils/sound.js";

const POP_HOLD_MS = 1100;

function getInitial(name) {
  return name?.trim()?.slice(0, 1) || "?";
}

function getParticipants(task) {
  if (!task.is_private && !task.assigned_to_name) {
    return [task.created_by_name || "Mina", "Kai"];
  }
  return [task.assigned_to_name || task.created_by_name || "Sync"];
}

function getBubbleSize(task) {
  const due = new Date(task.due_time);
  const hoursLeft = (due - new Date()) / 36e5;
  const urgencyBoost = hoursLeft < 0 ? 18 : hoursLeft < 24 ? 20 : hoursLeft < 72 ? 12 : 0;
  const size = 118 + (Number(task.priority_weight) || 0) * 0.92 + urgencyBoost;
  return Math.max(132, Math.min(232, Math.round(size)));
}

function getBubbleTitle(title) {
  return title?.replace(/^一起/, "").trim() || "新的泡泡";
}

export default function TaskCard({ task, onRefresh, index = 0, onOpenDetails, activeUser }) {
  const [holding, setHolding] = useState(false);
  const [popping, setPopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimer = useRef(null);
  const poppedRef = useRef(false);
  const weightTone = task.priority_weight >= 80 ? "heavy" : task.priority_weight >= 55 ? "medium" : "light";
  const participants = getParticipants(task);
  const bubbleSize = getBubbleSize(task);
  const bubbleTitle = getBubbleTitle(task.title);

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
      style={{
        "--float-delay": `${index * -0.85}s`,
        "--hold-ms": `${POP_HOLD_MS}ms`,
        "--bubble-size": `${bubbleSize}px`,
      }}
      onClick={handleClick}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${task.title}，點擊查看細節，長按完成`}
    >
      <span className="bubble-ring"></span>
      <span className="bubble-glass"></span>
      <span className="bubble-sheen"></span>
      <span className="task-bubble-core"></span>
      <span className="garden-title">{bubbleTitle}</span>
      <span className="bubble-people" aria-hidden="true">
        {participants.slice(0, 2).map((name, personIndex) => (
          <span key={`${name}-${personIndex}`} className={`mini-person avatar-${personIndex + 1}`}>
            {getInitial(name)}
          </span>
        ))}
      </span>
      <span className="garden-date">{formatDateTime(task.due_time)}</span>
      <span className="bubble-tooltip" role="tooltip">
        <strong>{task.title}</strong>
        <small>{formatDateTime(task.due_time)}</small>
        <small>{task.created_by_name ? `建立者 ${task.created_by_name}` : "共享泡泡"}</small>
        {task.description && <span>{task.description}</span>}
      </span>
      {holding && <span className="garden-hold-hint">快破了</span>}
      {burst}
    </button>
  );
}
