import { CalendarDays, ListFilter, Orbit, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDateTime } from "../utils/date.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isWithinDays(date, start, days) {
  const end = addDays(start, days);
  return date >= start && date < end;
}

function bubbleTone(weight) {
  if (weight >= 80) return "hot";
  if (weight >= 55) return "warm";
  return "cool";
}

function personInitial(task) {
  return task.assigned_to_name?.slice(0, 1) || task.created_by_name?.slice(0, 1) || "雙";
}

export default function TaskBoard({ tasks, activeUser, onAddTask, onGoHome }) {
  const [mode, setMode] = useState("list");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("due");
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 3));

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (scope === "shared" && task.is_private) return false;
        if (scope === "private" && !task.is_private) return false;
        if (!keyword) return true;
        return `${task.title} ${task.description || ""} ${task.assigned_to_name || ""}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        if (sort === "weight") return b.priority_weight - a.priority_weight;
        return new Date(a.due_time) - new Date(b.due_time);
      });
  }, [tasks, query, scope, sort]);

  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  const todayTasks = filtered.filter((task) => new Date(task.due_time) <= endOfToday);
  const weekTasks = filtered.filter((task) => {
    const due = new Date(task.due_time);
    return due > endOfToday && isWithinDays(due, today, 7);
  });

  return (
    <section className="bubble-agenda-page">
      <div className="bubble-agenda-title">
        <h2>泡泡管理</h2>
        <button className="agenda-add-button" type="button" onClick={onAddTask} aria-label="新增泡泡">
          +
        </button>
      </div>

      <div className="agenda-date-strip" aria-label="一週泡泡日期">
        {weekDays.map((date) => {
          const dayTasks = tasks.filter((task) => isSameDay(new Date(task.due_time), date));
          return (
            <button key={date.toISOString()} className={isSameDay(date, today) ? "active" : ""} type="button">
              <strong>{date.getDate()}</strong>
              <span>週{WEEKDAYS[date.getDay()]}</span>
              <i>
                {dayTasks.slice(0, 3).map((task) => (
                  <em key={task.id} className={bubbleTone(task.priority_weight)}></em>
                ))}
              </i>
            </button>
          );
        })}
      </div>

      <div className="agenda-tools">
        <label className="agenda-search">
          <Search size={21} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋泡泡..." />
        </label>
        <div className="agenda-mode-switch" aria-label="泡泡檢視模式">
          <button type="button" className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>
            <ListFilter size={18} />
            清單
          </button>
          <button type="button" className={mode === "calendar" ? "active" : ""} onClick={() => setMode("calendar")}>
            <CalendarDays size={18} />
            日曆
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="agenda-filter-drawer">
          <label>
            範圍
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">全部</option>
              <option value="shared">共享</option>
              <option value="private">私人</option>
            </select>
          </label>
          <label>
            排序
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="due">時間優先</option>
              <option value="weight">壓力優先</option>
            </select>
          </label>
        </div>
      )}

      {mode === "calendar" ? (
        <AgendaCalendar tasks={filtered} />
      ) : (
        <div className="agenda-list">
          <div className="agenda-section-head">
            <h3>今天 <span>{todayTasks.length}</span></h3>
            <p>越大的泡泡，越需要先照顧。</p>
          </div>
          <AgendaGroup tasks={todayTasks} onGoHome={onGoHome} emptyText="今天沒有泡泡。" />

          <div className="agenda-divider"></div>

          <div className="agenda-section-head">
            <h3>本週 <span>{weekTasks.length}</span></h3>
          </div>
          <AgendaGroup tasks={weekTasks} onGoHome={onGoHome} emptyText="本週暫時很安靜。" />
        </div>
      )}

      <button className="agenda-filter-fab" type="button" onClick={() => setShowFilters((value) => !value)}>
        <SlidersHorizontal size={19} />
        篩選
      </button>

    </section>
  );
}

function AgendaGroup({ tasks, onGoHome, emptyText }) {
  if (tasks.length === 0) {
    return <p className="agenda-empty">{emptyText}</p>;
  }

  return (
    <div className="agenda-task-list">
      {tasks.map((task) => (
        <article className="agenda-task-row" key={task.id}>
          <span className={`agenda-bubble-dot ${bubbleTone(task.priority_weight)}`}></span>
          <div className="agenda-task-title">
            <strong>{task.title}</strong>
            <small>{formatDateTime(task.due_time)}</small>
          </div>
          <div className="agenda-people" aria-label="參與者">
            <span>{personInitial(task)}</span>
            {!task.is_private && <span>雙</span>}
          </div>
          <button className="agenda-orbit-link" type="button" onClick={onGoHome} aria-label={`到星域戳破 ${task.title}`}>
            <Orbit size={18} />
            <span>去星域</span>
          </button>
        </article>
      ))}
    </div>
  );
}

function AgendaCalendar({ tasks }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));

  return (
    <section className="agenda-calendar-panel">
      <strong>{year} / {month + 1}</strong>
      <div className="agenda-calendar-week">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="agenda-calendar-grid">
        {cells.map((date, index) => {
          const dayTasks = date ? tasks.filter((task) => isSameDay(new Date(task.due_time), date)) : [];
          return (
            <div key={date?.toISOString() || `blank-${index}`} className={date ? "agenda-calendar-cell" : "agenda-calendar-cell blank"}>
              {date && <span>{date.getDate()}</span>}
              <i>
                {dayTasks.slice(0, 3).map((task) => <em key={task.id} className={bubbleTone(task.priority_weight)}></em>)}
              </i>
            </div>
          );
        })}
      </div>
    </section>
  );
}
