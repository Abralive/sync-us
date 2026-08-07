import { request } from "../api/client.js";
import { useState } from "react";

const initialForm = {
  title: "",
  description: "",
  due_time: "",
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

export default function TaskForm({ users, activeUser, coupleId, onCreated }) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.title.trim() || !form.due_time) {
      setError("請填寫泡泡名稱與時間。");
      return;
    }
    if (new Date(form.due_time).getTime() <= Date.now()) {
      setError("時間需要晚於現在，星塵才有地方降落。");
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
          due_time: new Date(form.due_time).toISOString(),
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
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例：訂週末晚餐" />
      </label>
      <label>
        時間
        <input type="datetime-local" min={localMinNow()} value={form.due_time} onChange={(event) => setForm({ ...form, due_time: event.target.value })} />
      </label>
      <label>
        補充說明
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="只放真正需要記住的細節" />
      </label>
      <div className="growth-row">
        <label>
          交給誰
          <select value={form.assigned_to_id} onChange={(event) => setForm({ ...form, assigned_to_id: event.target.value })}>
            <option value="">一起照顧</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
          </select>
        </label>
        <label>
          重要度 {form.priority_weight}
          <input type="range" min="1" max="100" value={form.priority_weight} onChange={(event) => setForm({ ...form, priority_weight: event.target.value })} />
        </label>
      </div>
      <label className="quiet-toggle">
        <input type="checkbox" checked={form.is_private} onChange={(event) => setForm({ ...form, is_private: event.target.checked })} />
        放進私人軌道
      </label>
      {error && <div className="error">{error}</div>}
      <button className="btn primary" disabled={submitting}>{submitting ? "新增中..." : "長出泡泡"}</button>
    </form>
  );
}
