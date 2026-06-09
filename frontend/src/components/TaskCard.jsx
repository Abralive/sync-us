import { useRef, useState } from "react";
import { request } from "../api/client.js";
import { REWARD_DROPS } from "../constants.js";
import { countdownText, formatDateTime } from "../utils/date.js";

const HOLD_MS = 900;

export default function TaskCard({ task, onRefresh, variant = "card", index = 0, onOpenDetails }) {
  const [drop, setDrop] = useState(null);
  const [holding, setHolding] = useState(false);
  const [popping, setPopping] = useState(false);
  const holdTimer = useRef(null);
  const isUrgent = !task.is_completed && new Date(task.due_time) - new Date() < task.reminder_minutes * 60000;
  const weightTone = task.priority_weight >= 80 ? "heavy" : task.priority_weight >= 55 ? "medium" : "light";

  async function toggleDone(event) {
    event?.stopPropagation();
    await request(`/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_completed: !task.is_completed }),
    });
    onRefresh();
  }

  function startHold(event) {
    event.stopPropagation();
    if (!task.is_completed || drop || popping) return;
    setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      const nextDrop = REWARD_DROPS[Math.floor(Math.random() * REWARD_DROPS.length)];
      setPopping(true);
      setDrop(nextDrop);
      setHolding(false);
      window.setTimeout(() => setPopping(false), 420);
      window.setTimeout(() => setDrop(null), 1800);
    }, HOLD_MS);
  }

  function cancelHold(event) {
    event?.stopPropagation();
    window.clearTimeout(holdTimer.current);
    setHolding(false);
  }

  if (variant === "garden") {
    return (
      <button
        className={`garden-bubble-orb ${weightTone} ${task.is_completed ? "completed" : ""} ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}
        style={{ "--float-delay": `${index * -0.85}s` }}
        onClick={onOpenDetails}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
      >
        <span className="bubble-ring"></span>
        <span className="bubble-glass"></span>
        <span className="bubble-sheen"></span>
        <span className="task-bubble-core"></span>
        <span className="garden-title">{task.title}</span>
        <span className="garden-date">{formatDateTime(task.due_time)}</span>
        {drop && <RewardFall drop={drop} />}
      </button>
    );
  }

  return (
    <article className={`task-card ${weightTone} ${task.is_completed ? "completed" : ""} ${holding ? "holding" : ""} ${popping ? "popping" : ""}`}>
      <div className="bubble-orb" aria-hidden="true">
        <span className="bubble-ring"></span>
        <span className="bubble-glass"></span>
        <span className="bubble-sheen"></span>
        <span className="task-bubble-core"></span>
      </div>
      {drop && <RewardFall drop={drop} />}

      <div className="task-content">
        <div className="task-meta">
          <span className="pill">{task.is_private ? "私人軌道" : "共享世界"}</span>
          <span className="pill">權重 {task.priority_weight}</span>
          {isUrgent && <span className="pill urgent">提醒中</span>}
        </div>
        <h3 className={`task-title ${task.is_completed ? "done" : ""}`}>{task.title}</h3>
        <p className="task-detail">{formatDateTime(task.due_time)} · {countdownText(task.due_time)}</p>
        {task.description && <p className="task-detail">{task.description}</p>}
        {task.assigned_to_name && <p className="task-detail">指派給 {task.assigned_to_name}</p>}
        {task.collaboration_note && <p className="task-detail">{task.collaboration_note}</p>}
        <div className="bubble-actions">
          <button className="btn primary" onClick={toggleDone}>{task.is_completed ? "恢復任務" : "標記完成"}</button>
          <button className="btn reward-btn" onPointerDown={startHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} disabled={!task.is_completed}>
            {holding ? "蓄力中..." : "長按戳破"}
          </button>
        </div>
      </div>
    </article>
  );
}

function RewardFall({ drop }) {
  return (
    <div className="reward-fall">
      <span className={`drop-object ${drop.icon}`}></span>
      <span className="drop-label">{drop.label}</span>
      <span className="dust-result">轉成 {drop.dust} 星塵</span>
    </div>
  );
}
