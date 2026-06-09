import { useState } from "react";
import { request } from "../api/client.js";

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

export default function TaskForm({ users, activeUser, onCreated }) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.due_time) return;
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
          couple_id: 1,
        }),
      });
      setForm(initialForm);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="growth-form">
      <label>
        要一起照顧什麼？
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例：訂週末晚餐" />
      </label>
      <label>
        什麼時候前？
        <input type="datetime-local" value={form.due_time} onChange={(event) => setForm({ ...form, due_time: event.target.value })} />
      </label>
      <label>
        補充一句話
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="例：確認餐廳與時間" />
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
        這是自己的小軌道
      </label>
      <button className="btn primary" disabled={submitting}>{submitting ? "建立中..." : "長出一顆泡泡"}</button>
    </form>
  );
}
