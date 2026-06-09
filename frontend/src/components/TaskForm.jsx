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
    <form onSubmit={submit} className="form-grid">
      <div className="field span-4">
        <label>任務標題</label>
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例：訂週末晚餐" />
      </div>
      <div className="field span-4">
        <label>任務描述</label>
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="簡短說明即可" />
      </div>
      <div className="field span-4">
        <label>截止時間</label>
        <input type="datetime-local" value={form.due_time} onChange={(event) => setForm({ ...form, due_time: event.target.value })} />
      </div>
      <div className="field span-3">
        <label>指派對象</label>
        <select value={form.assigned_to_id} onChange={(event) => setForm({ ...form, assigned_to_id: event.target.value })}>
          <option value="">未指定</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
        </select>
      </div>
      <div className="field span-3">
        <label>提醒</label>
        <select value={form.reminder_minutes} onChange={(event) => setForm({ ...form, reminder_minutes: event.target.value })}>
          <option value="15">15 分鐘前</option>
          <option value="60">1 小時前</option>
          <option value="180">3 小時前</option>
          <option value="1440">1 天前</option>
        </select>
      </div>
      <div className="field span-3">
        <label>權重 {form.priority_weight}</label>
        <div className="range-card">
          <input type="range" min="1" max="100" value={form.priority_weight} onChange={(event) => setForm({ ...form, priority_weight: event.target.value })} />
        </div>
      </div>
      <div className="field span-3">
        <label>模式</label>
        <label className="private-toggle">
          <input type="checkbox" checked={form.is_private} onChange={(event) => setForm({ ...form, is_private: event.target.checked })} />
          私人任務
        </label>
      </div>
      <div className="field span-7">
        <label>協作備註</label>
        <textarea value={form.collaboration_note} onChange={(event) => setForm({ ...form, collaboration_note: event.target.value })} placeholder="例：我先查餐廳，你決定時間。" />
      </div>
      <div className="field span-5">
        <label>建立</label>
        <button className="btn primary" disabled={submitting}>{submitting ? "建立中..." : "建立任務泡泡"}</button>
      </div>
    </form>
  );
}
