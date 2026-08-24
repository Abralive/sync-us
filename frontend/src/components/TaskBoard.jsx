import { CalendarDays, ListFilter, Orbit, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDateTime } from "../utils/date.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function bubbleTone(weight) {
  if (weight >= 80) return "hot";
  if (weight >= 55) return "warm";
  return "cool";
}

function personInitial(task) {
  return task.assigned_to_name?.slice(0, 1) || task.created_by_name?.slice(0, 1) || "?";
}

export default function TaskBoard({
  tasks,
  selectedDate,
  onSelectedDateChange,
  onAddTask,
  onGoHome,
}) {
  const [mode, setMode] = useState("list");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("due");

  const anchorDate = startOfDay(selectedDate || new Date());
  const weekStart = startOfWeek(anchorDate);
  const weekEnd = addDays(weekStart, 6);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

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

  const selectedTasks = filtered.filter((task) => isSameDay(new Date(task.due_time), anchorDate));
  const upcomingTasks = filtered.filter((task) => {
    const due = startOfDay(new Date(task.due_time));
    return due >= weekStart && due <= weekEnd && !isSameDay(due, anchorDate);
  });

  return (
    <section className="bubble-agenda-page">
      <div className="bubble-agenda-title">
        <div>
          <span>泡泡</span>
          <h2>泡泡管理</h2>
        </div>
        <button className="agenda-add-button" type="button" onClick={onAddTask} aria-label="新增泡泡">
          +
        </button>
      </div>

      <div className="agenda-date-strip" aria-label="一週日期">
        {weekDays.map((date) => {
          const dayTasks = tasks.filter((task) => isSameDay(new Date(task.due_time), date));
          return (
            <button
              key={date.toISOString()}
              className={isSameDay(date, anchorDate) ? "active" : ""}
              type="button"
              onClick={() => onSelectedDateChange(date)}
            >
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
        <div className="agenda-mode-switch" aria-label="顯示模式">
          <button type="button" className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>
            <ListFilter size={18} />
            清單
          </button>
          <button type="button" className={mode === "calendar" ? "active" : ""} onClick={() => setMode("calendar")}>
            <CalendarDays size={18} />
            月曆
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="agenda-filter-drawer">
          <fieldset>
            <legend>範圍</legend>
            <div className="filter-pill-row">
              {[
                ["all", "全部"],
                ["shared", "共享"],
                ["private", "私人"],
              ].map(([value, label]) => (
                <button key={value} type="button" className={scope === value ? "active" : ""} onClick={() => setScope(value)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>排序</legend>
            <div className="filter-pill-row">
              {[
                ["due", "時間"],
                ["weight", "重要度"],
              ].map(([value, label]) => (
                <button key={value} type="button" className={sort === value ? "active" : ""} onClick={() => setSort(value)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {mode === "calendar" ? (
        <AgendaCalendar tasks={filtered} selectedDate={anchorDate} onSelectedDateChange={onSelectedDateChange} />
      ) : (
        <div className="agenda-list">
          <div className="agenda-section-head">
            <h3>選定日期 <span>{selectedTasks.length}</span></h3>
            <p>這天需要被看見與安排的泡泡。</p>
          </div>
          <AgendaGroup tasks={selectedTasks} onGoHome={onGoHome} emptyText="這一天目前沒有泡泡。" />

          <div className="agenda-divider"></div>

          <div className="agenda-section-head">
            <h3>接下來 <span>{upcomingTasks.length}</span></h3>
          </div>
          <AgendaGroup tasks={upcomingTasks} onGoHome={onGoHome} emptyText="接下來一週沒有其他泡泡。" />
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
            {!task.is_private && <span>共</span>}
          </div>
          <button className="agenda-orbit-link" type="button" onClick={onGoHome} aria-label={`回星域查看 ${task.title}`}>
            <Orbit size={18} />
            <span>去星域</span>
          </button>
        </article>
      ))}
    </div>
  );
}

function AgendaCalendar({ tasks, selectedDate, onSelectedDateChange }) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
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
          const active = date && isSameDay(date, selectedDate);
          return (
            <button
              key={date?.toISOString() || `blank-${index}`}
              className={date ? `agenda-calendar-cell ${active ? "active" : ""}` : "agenda-calendar-cell blank"}
              type="button"
              disabled={!date}
              onClick={() => date && onSelectedDateChange(date)}
            >
              {date && <span>{date.getDate()}</span>}
              <i>
                {dayTasks.slice(0, 3).map((task) => <em key={task.id} className={bubbleTone(task.priority_weight)}></em>)}
              </i>
            </button>
          );
        })}
      </div>
    </section>
  );
}
