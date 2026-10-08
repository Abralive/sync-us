import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { request } from "../api/client.js";
import { initialOf } from "../constants.js";
import { formatDateTime, formatShortDateTime, isOverdue } from "../utils/date.js";
import { playPop, unlockAudio } from "../utils/sound.js";

const POP_HOLD_MS = 1100;
const REWARD_ANIMATION_MS = 1450;

function shortTitle(title) {
  return title?.replace(/^一起/, "").trim() || "新的泡泡";
}

function weightClass(weight) {
  if (weight >= 80) return "heavy";
  if (weight >= 55) return "medium";
  return "light";
}

// A single bubble in the starfield. Tap opens the details, press and hold pops it.
export default function TaskCard({
  task,
  activeUser,
  members,
  position,
  index = 0,
  onOpenDetails,
  onCompleted,
  onError,
}) {
  const [holding, setHolding] = useState(false);
  const [popping, setPopping] = useState(false);
  const holdTimer = useRef(null);
  const poppedRef = useRef(false);
  const busyRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  // Only the hold timer is cancelled on unmount. The completion callback must still
  // run if a background refresh removes this bubble while it is popping.
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const size = position.size;
  const compact = size < 128;
  const tiny = size < 104;
  const overdue = isOverdue(task.due_time);
  const people = task.assigned_to_id
    ? members.filter((member) => member.id === task.assigned_to_id)
    : task.is_private
      ? members.filter((member) => member.id === task.created_by_id)
      : members;

  async function popComplete() {
    busyRef.current = true;
    try {
      const completedTask = await request(`/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser) }),
      });
      // Leave the bubble popped; the refresh triggered by onCompleted removes it.
      window.setTimeout(() => {
        onCompletedRef.current?.(completedTask || task);
      }, REWARD_ANIMATION_MS);
    } catch (err) {
      setPopping(false);
      onError?.(err.message || "完成失敗，請再試一次。");
    } finally {
      busyRef.current = false;
    }
  }

  function startHold(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (task.is_completed || busyRef.current || popping) return;
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
    onOpenDetails?.(task);
  }

  return (
    <button
      type="button"
      className={[
        "bubble",
        weightClass(task.priority_weight),
        compact ? "is-compact" : "",
        tiny ? "is-tiny" : "",
        overdue ? "is-overdue" : "",
        holding ? "holding" : "",
        popping ? "popping" : "",
      ].join(" ")}
      style={{
        left: `${position.x - size / 2}px`,
        top: `${position.y - size / 2}px`,
        "--bubble-size": `${size}px`,
        "--float-delay": `${index * -0.85}s`,
        "--hold-ms": `${POP_HOLD_MS}ms`,
      }}
      onClick={handleClick}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${task.title}，${formatDateTime(task.due_time)}。點一下看細節，長按完成`}
    >
      <span className="bubble-ring" aria-hidden="true"></span>
      <span className="bubble-sheen" aria-hidden="true"></span>
      <span className="bubble-core" aria-hidden="true"></span>
      <span className="bubble-content" aria-hidden="true">
        <span className="bubble-title">
          {task.is_private && <Lock size={12} strokeWidth={2.6} />}
          {shortTitle(task.title)}
        </span>
        {!tiny && (
          <span className="bubble-people">
            {people.slice(0, 2).map((member) => (
              <span key={member.id} className={`mini-avatar avatar-tone-${member.tone}`}>
                {initialOf(member.username)}
              </span>
            ))}
          </span>
        )}
        {!compact && <span className="bubble-date">{formatShortDateTime(task.due_time)}</span>}
      </span>
      {holding && <span className="bubble-hold-hint">快破了</span>}
      {popping && (
        <span className="pop-burst" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="pop-shard" style={{ "--i": i }}></span>
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={`dust-${i}`} className="stardust-drop" style={{ "--i": i }}>
              {i % 5 === 0 ? "✦" : i % 4 === 0 ? "✧" : "•"}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
