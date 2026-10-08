import { CalendarClock, CheckCircle2, Gauge, Sparkles, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { bubbleTone, weightLabel } from "../constants.js";
import { countdownText, formatFullDate, isOverdue } from "../utils/date.js";
import Modal from "./Modal.jsx";

export default function TaskDetail({ task, members, activeUser, onClose, onComplete, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const overdue = isOverdue(task.due_time);
  const assignee = members.find((member) => member.id === task.assigned_to_id);
  const ownerText = task.is_private
    ? "只在你的私人軌道"
    : assignee
      ? `交給 ${assignee.id === Number(activeUser) ? "我" : assignee.username}`
      : "兩個人一起照顧";

  async function run(kind, action) {
    setBusy(kind);
    try {
      await action(task);
    } finally {
      setBusy("");
    }
  }

  const footer = confirmDelete ? (
    <div className="confirm-row">
      <p>確定要刪除「{task.title}」嗎？刪除後無法復原。</p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={Boolean(busy)}>
          取消
        </button>
        <button type="button" className="btn btn-danger" onClick={() => run("delete", onDelete)} disabled={Boolean(busy)}>
          {busy === "delete" ? "刪除中..." : "確定刪除"}
        </button>
      </div>
    </div>
  ) : (
    <div className="btn-row btn-row-split">
      <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)}>
        <Trash2 size={17} />
        刪除
      </button>
      <button type="button" className="btn btn-primary" onClick={() => run("complete", onComplete)} disabled={Boolean(busy)}>
        <CheckCircle2 size={18} />
        {busy === "complete" ? "完成中..." : "完成這顆泡泡"}
      </button>
    </div>
  );

  return (
    <Modal kicker={task.is_private ? "私人軌道" : "共享星域"} title={task.title} onClose={onClose} footer={footer}>
      <dl className="detail-list">
        <div className="detail-row">
          <dt><CalendarClock size={18} aria-label="時間" /></dt>
          <dd>
            <strong>{formatFullDate(task.due_time)}</strong>
            <span className={overdue ? "is-overdue" : ""}>{countdownText(task.due_time)}</span>
          </dd>
        </div>
        <div className="detail-row">
          <dt><Users size={18} aria-label="負責" /></dt>
          <dd>
            <strong>{ownerText}</strong>
            <span>建立者 {task.created_by_name || "Sync"}</span>
          </dd>
        </div>
        <div className="detail-row">
          <dt><Gauge size={18} aria-label="重要度" /></dt>
          <dd>
            <strong>重要度 {task.priority_weight}・{weightLabel(task.priority_weight)}</strong>
            <span className="meter" aria-hidden="true">
              <i className={`meter-fill tone-${bubbleTone(task.priority_weight)}`} style={{ width: `${task.priority_weight}%` }}></i>
            </span>
          </dd>
        </div>
      </dl>
      {task.description && <p className="detail-note">{task.description}</p>}
      {task.collaboration_note && <p className="detail-note">{task.collaboration_note}</p>}
      {task.matched_task_title && (
        <p className="detail-match">
          <Sparkles size={16} />
          另一顆泡泡「{task.matched_task_title}」看起來是同一件事，可以一起處理。
        </p>
      )}
      <p className="detail-hint">在星域長按泡泡，也可以直接戳破完成。</p>
    </Modal>
  );
}
