import { useMemo, useState } from "react";
import { request } from "../api/client.js";
import { countdownText, formatDateTime } from "../utils/date.js";

export default function TaskBoard({ tasks, activeUser, onRefresh }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [sort, setSort] = useState("due");
  const [busyId, setBusyId] = useState(null);

  const assignees = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      if (task.assigned_to_id && task.assigned_to_name) {
        map.set(String(task.assigned_to_id), task.assigned_to_name);
      }
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (scope === "shared" && task.is_private) return false;
        if (scope === "private" && !task.is_private) return false;
        if (assignee === "me" && task.assigned_to_id !== Number(activeUser)) return false;
        if (assignee !== "all" && assignee !== "me" && String(task.assigned_to_id || "") !== assignee) return false;
        if (!keyword) return true;
        return `${task.title} ${task.description || ""} ${task.assigned_to_name || ""}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        if (sort === "weight") return b.priority_weight - a.priority_weight;
        if (sort === "scope") return Number(a.is_private) - Number(b.is_private);
        return new Date(a.due_time) - new Date(b.due_time);
      });
  }, [tasks, query, scope, assignee, sort, activeUser]);

  async function complete(taskId) {
    setBusyId(taskId);
    try {
      await request(`/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser }),
      });
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="task-filter-panel">
      <form className="task-filter-form">
        <label className="filter-search">
          找泡泡
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入關鍵字、對象或備註"
          />
        </label>

        <div className="filter-grid">
          <label>
            範圍
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">全部</option>
              <option value="shared">共享</option>
              <option value="private">私人</option>
            </select>
          </label>

          <label>
            對象
            <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="all">所有人</option>
              <option value="me">交給我</option>
              {assignees.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>

          <label>
            排序
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="due">最接近到期</option>
              <option value="weight">重要度高到低</option>
              <option value="scope">共享優先</option>
            </select>
          </label>
        </div>
      </form>

      <div className="task-table-head">
        <span>{filtered.length} 顆泡泡</span>
        <button type="button" className="text-btn" onClick={() => { setQuery(""); setScope("all"); setAssignee("all"); setSort("due"); }}>
          清除篩選
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">沒有符合條件的泡泡。</div>
      ) : (
        <div className="task-table">
          {filtered.map((task) => (
            <article className="task-row" key={task.id}>
              <div className="task-row-main">
                <div className="task-row-meta">
                  <span className={task.is_private ? "mini-tag private" : "mini-tag shared"}>
                    {task.is_private ? "私人" : "共享"}
                  </span>
                  <span className="mini-tag">重要度 {task.priority_weight}</span>
                  {task.assigned_to_name && <span className="mini-tag">交給 {task.assigned_to_name}</span>}
                </div>
                <h3>{task.title}</h3>
                <p>{formatDateTime(task.due_time)} · {countdownText(task.due_time)}</p>
                {task.description && <p className="task-row-note">{task.description}</p>}
              </div>
              <button className="btn primary row-action" disabled={busyId === task.id} onClick={() => complete(task.id)}>
                {busyId === task.id ? "處理中" : "完成"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
