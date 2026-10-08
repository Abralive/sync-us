import { Lock } from "lucide-react";
import { useState } from "react";
import { request } from "../api/client.js";
import { bubbleTone, weightLabel } from "../constants.js";
import { addDays, formatTime, isSameDay, startOfDay, toDateInputValue, upcomingWeekend } from "../utils/date.js";

function defaultTime(dateText) {
  const now = new Date();
  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0);
  if (dateText !== toDateInputValue(now) || evening - now > 30 * 60000) return "20:00";
  const soon = new Date(now);
  soon.setMinutes(0, 0, 0);
  soon.setHours(soon.getHours() + 2);
  return isSameDay(soon, now) ? formatTime(soon) : "23:55";
}

function initialForm(defaultDate) {
  const now = new Date();
  const today = startOfDay(now);
  let base = defaultDate && startOfDay(defaultDate) >= today ? defaultDate : now;
  // Late at night, "today" is almost over — suggest tomorrow evening instead.
  if (isSameDay(base, now) && now.getHours() >= 22) base = addDays(now, 1);
  const dueDate = toDateInputValue(base);
  return {
    title: "",
    description: "",
    due_date: dueDate,
    due_time: defaultTime(dueDate),
    priority_weight: 55,
    assigned_to_id: "",
    is_private: false,
  };
}

function parseLocalDue(dateText, timeText) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateText || "").trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((timeText || "").trim());
  if (!dateMatch || !timeMatch) return null;
  const due = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2])
  );
  return Number.isNaN(due.getTime()) ? null : due;
}

export default function TaskForm({ members, activeUser, coupleId, defaultDate, onCreated, onCancel }) {
  const [form, setForm] = useState(() => initialForm(defaultDate));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const me = Number(activeUser);
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const weekend = upcomingWeekend(today);
  const quickDates = [
    ["今天", today],
    ["明天", tomorrow],
    // On Fridays/weekends "這週末" would repeat 今天/明天, so offer next week instead.
    startOfDay(weekend) > startOfDay(tomorrow) ? ["這週末", weekend] : ["下週", addDays(today, 7)],
  ];

  function update(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const due = parseLocalDue(form.due_date, form.due_time);
    if (!form.title.trim()) {
      setError("請幫泡泡取個名字。");
      return;
    }
    if (!due) {
      setError("請選擇日期和時間。");
      return;
    }
    if (due.getTime() <= Date.now()) {
      setError("時間需要晚於現在。");
      return;
    }
    setSubmitting(true);
    try {
      const created = await request("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          due_time: due.toISOString(),
          created_by_id: me,
          assigned_to_id: form.is_private ? me : form.assigned_to_id ? Number(form.assigned_to_id) : null,
          is_private: form.is_private,
          priority_weight: Number(form.priority_weight),
          reminder_minutes: 60,
          couple_id: coupleId,
        }),
      });
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const tone = bubbleTone(Number(form.priority_weight));

  return (
    <form onSubmit={submit} className="task-form" noValidate>
      <label className="field">
        <span>泡泡名稱</span>
        <input
          value={form.title}
          onChange={(event) => update({ title: event.target.value })}
          placeholder="例如：一起確認住宿"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="next"
        />
      </label>

      <fieldset className="field">
        <legend>什麼時候</legend>
        <div className="chip-row">
          {quickDates.map(([label, date]) => {
            const value = toDateInputValue(date);
            return (
              <button
                key={label}
                type="button"
                className={`chip${form.due_date === value ? " active" : ""}`}
                aria-pressed={form.due_date === value}
                onClick={() => update({ due_date: value, due_time: defaultTime(value) })}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="field-pair">
          <label className="field">
            <span>日期</span>
            <input
              type="date"
              value={form.due_date}
              min={toDateInputValue(today)}
              onChange={(event) => update({ due_date: event.target.value })}
            />
          </label>
          <label className="field">
            <span>時間</span>
            <input
              type="time"
              value={form.due_time}
              step={300}
              onChange={(event) => update({ due_time: event.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <label className="field">
        <span>簡短備註（選填）</span>
        <input
          value={form.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="補一句對方需要知道的事"
          maxLength={120}
        />
      </label>

      <label className="switch-field">
        <input
          type="checkbox"
          checked={form.is_private}
          onChange={(event) => update({ is_private: event.target.checked })}
        />
        <span className="switch" aria-hidden="true"></span>
        <span>
          <strong><Lock size={14} /> 只放在我的私人軌道</strong>
          <small>對方看不到內容，只會知道你有幾顆私人泡泡。</small>
        </span>
      </label>

      {!form.is_private && (
        <fieldset className="field">
          <legend>交給誰</legend>
          <div className="segmented segmented-wide">
            <button
              type="button"
              className={!form.assigned_to_id ? "active" : ""}
              aria-pressed={!form.assigned_to_id}
              onClick={() => update({ assigned_to_id: "" })}
            >
              <span className="truncate">一起照顧</span>
            </button>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                className={Number(form.assigned_to_id) === member.id ? "active" : ""}
                aria-pressed={Number(form.assigned_to_id) === member.id}
                onClick={() => update({ assigned_to_id: String(member.id) })}
              >
                <span className="truncate">{member.id === me ? `${member.username}（我）` : member.username}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label className="field">
        <span className="range-label">
          重要度
          <b className={`tag tag-${tone}`}>{form.priority_weight}・{weightLabel(Number(form.priority_weight))}</b>
        </span>
        <input
          type="range"
          min="1"
          max="100"
          value={form.priority_weight}
          className={`range tone-${tone}`}
          onChange={(event) => update({ priority_weight: event.target.value })}
        />
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="btn-row btn-row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "長出泡泡中..." : "長出泡泡"}
        </button>
      </div>
    </form>
  );
}
