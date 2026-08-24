import { useMemo, useState } from "react";
import { request } from "../api/client.js";

const initialForm = {
  title: "",
  description: "",
  due_date: "",
  due_time_text: "",
  priority_weight: 55,
  assigned_to_id: "",
  is_private: false,
  reminder_minutes: 60,
  collaboration_note: "",
};

function localMinNow() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return now.toISOString().slice(0, 16);
}

function localDate(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseLocalDue(dateText, timeText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!match || !timeMatch) return null;
  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  const due = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (Number.isNaN(due.getTime())) return null;
  return due;
}

export default function TaskForm({ users, activeUser, coupleId, onCreated }) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const assigneeLabel = useMemo(() => {
    if (!form.assigned_to_id) return "一起照顧";
    return users.find((user) => user.id === Number(form.assigned_to_id))?.username || "一起照顧";
  }, [form.assigned_to_id, users]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const due = parseLocalDue(form.due_date, form.due_time_text);
    if (!form.title.trim() || !due) {
      setError("請填寫泡泡名稱與時間。");
      return;
    }
    if (due.getTime() <= Date.now()) {
      setError("時間需要晚於現在。");
      return;
    }
    setSubmitting(true);
    try {
      await request("/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          description: form.description.trim(),
          collaboration_note: form.collaboration_note.trim(),
          due_time: due.toISOString(),
          created_by_id: activeUser,
          assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
          priority_weight: Number(form.priority_weight),
          reminder_minutes: Number(form.reminder_minutes),
          couple_id: coupleId,
        }),
      });
      setForm(initialForm);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="growth-form bubble-sheet-form">
      <label>
        泡泡名稱
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="例如：一起確認住宿"
        />
      </label>

      <fieldset className="due-picker">
        <legend>時間</legend>
        <div className="due-chip-row">
          {[
            ["今天", 0],
            ["明天", 1],
            ["週末", 5],
          ].map(([label, offset]) => (
            <button
              key={label}
              type="button"
              className={form.due_date === localDate(offset) ? "active" : ""}
              onClick={() => setForm({ ...form, due_date: localDate(offset), due_time_text: form.due_time_text || "20:00" })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="due-input-grid">
          <label>
            日期
            <input
              value={form.due_date}
              onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              placeholder={localDate()}
              inputMode="numeric"
            />
          </label>
          <label>
            時間
            <input
              value={form.due_time_text}
              onChange={(event) => setForm({ ...form, due_time_text: event.target.value })}
              placeholder="20:00"
              inputMode="numeric"
            />
          </label>
        </div>
      </fieldset>

      <label>
        簡短備註
        <input
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="補一句對方需要知道的事"
        />
      </label>

      <div className="growth-row">
        <fieldset className="assignee-picker">
          <legend>交給誰</legend>
          <div>
            <button
              type="button"
              className={!form.assigned_to_id ? "active" : ""}
              onClick={() => setForm({ ...form, assigned_to_id: "" })}
              aria-pressed={!form.assigned_to_id}
            >
              一起照顧
            </button>
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className={Number(form.assigned_to_id) === user.id ? "active" : ""}
                onClick={() => setForm({ ...form, assigned_to_id: String(user.id) })}
                aria-pressed={Number(form.assigned_to_id) === user.id}
              >
                {user.username}
              </button>
            ))}
          </div>
          <span>目前：{assigneeLabel}</span>
        </fieldset>

        <label>
          重要度 {form.priority_weight}
          <input
            type="range"
            min="1"
            max="100"
            value={form.priority_weight}
            onChange={(event) => setForm({ ...form, priority_weight: event.target.value })}
          />
        </label>
      </div>

      <label className="quiet-toggle">
        <input
          type="checkbox"
          checked={form.is_private}
          onChange={(event) => setForm({ ...form, is_private: event.target.checked })}
        />
        只放在我的私人軌道
      </label>

      {error && <div className="error">{error}</div>}
      <button className="btn primary" disabled={submitting}>
        {submitting ? "長出泡泡中..." : "長出泡泡"}
      </button>
    </form>
  );
}
