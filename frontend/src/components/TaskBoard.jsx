import { useMemo, useState } from "react";
import { CalendarDays, ListFilter } from "lucide-react";
import { request } from "../api/client.js";
import { countdownText, formatDateTime } from "../utils/date.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export default function TaskBoard({ tasks, activeUser, onRefresh }) {
  const [mode, setMode] = useState("list");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [sort, setSort] = useState("due");
  const [busyId, setBusyId] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);

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

  function resetFilters() {
    setQuery("");
    setScope("all");
    setAssignee("all");
    setSort("due");
  }

  return (
    <section className="task-filter-panel">
      <div className="view-switch" aria-label="顯示方式">
        <button type="button" className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>
          <ListFilter size={17} />
          清單
        </button>
        <button type="button" className={mode === "calendar" ? "active" : ""} onClick={() => setMode("calendar")}>
          <CalendarDays size={17} />
          日曆
        </button>
      </div>

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
        <button type="button" className="text-btn" onClick={resetFilters}>清除篩選</button>
      </div>

      {mode === "calendar" ? (
        <CalendarBoard tasks={filtered} monthOffset={monthOffset} onMonthOffsetChange={setMonthOffset} />
      ) : (
        <TaskList tasks={filtered} busyId={busyId} onComplete={complete} />
      )}
    </section>
  );
}

function TaskList({ tasks, busyId, onComplete }) {
  if (tasks.length === 0) {
    return <div className="empty">沒有符合條件的泡泡。</div>;
  }

  return (
    <div className="task-table">
      {tasks.map((task) => (
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
          <button className="btn primary row-action" disabled={busyId === task.id} onClick={() => onComplete(task.id)}>
            {busyId === task.id ? "處理中" : "完成"}
          </button>
        </article>
      ))}
    </div>
  );
}

function CalendarBoard({ tasks, monthOffset, onMonthOffsetChange }) {
  const cursor = new Date();
  cursor.setMonth(cursor.getMonth() + monthOffset);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();
  const cells = [];

  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));

  const grouped = tasks.reduce((acc, task) => {
    const date = new Date(task.due_time);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    acc[key] = acc[key] || [];
    acc[key].push(task);
    return acc;
  }, {});

  return (
    <section className="calendar-panel">
      <div className="calendar-head">
        <button type="button" className="text-btn" onClick={() => onMonthOffsetChange(monthOffset - 1)}>上個月</button>
        <strong>{year} 年 {month + 1} 月</strong>
        <button type="button" className="text-btn" onClick={() => onMonthOffsetChange(monthOffset + 1)}>下個月</button>
      </div>

      <div className="calendar-week">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className="calendar-grid">
        {cells.map((date, index) => {
          const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : `blank-${index}`;
          const items = date ? grouped[key] || [] : [];
          return (
            <div className={date ? "calendar-cell" : "calendar-cell blank"} key={key}>
              {date && <span className="calendar-day">{date.getDate()}</span>}
              {items.slice(0, 3).map((task) => (
                <span className={task.is_private ? "calendar-dot private" : "calendar-dot shared"} key={task.id}>
                  {task.title}
                </span>
              ))}
              {items.length > 3 && <span className="calendar-more">+{items.length - 3}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
