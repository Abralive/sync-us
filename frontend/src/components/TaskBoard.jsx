import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bubbleTone } from "../constants.js";
import {
  WEEKDAYS,
  addDays,
  countdownText,
  formatDayLabel,
  formatTime,
  isSameDay,
  parseServerDate,
  startOfDay,
  startOfWeek,
} from "../utils/date.js";
import Avatar, { AvatarPair } from "./Avatar.jsx";

function dueOf(task) {
  return parseServerDate(task.due_time);
}

function tasksOn(tasks, date) {
  return tasks.filter((task) => isSameDay(dueOf(task), date));
}

function DayDots({ tasks }) {
  return (
    <i className="day-dots" aria-hidden="true">
      {tasks.slice(0, 3).map((task) => (
        <em key={task.id} className={`tone-${bubbleTone(task.priority_weight)}`}></em>
      ))}
    </i>
  );
}

function WeekStrip({ tasks, selected, onSelect }) {
  const weekStart = startOfWeek(selected);
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  return (
    <div className="week-strip">
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => onSelect(addDays(selected, -7))} aria-label="上一週">
        <ChevronLeft size={18} />
      </button>
      <div className="week-days">
        {days.map((date) => (
          <button
            key={date.toISOString()}
            type="button"
            className={`${isSameDay(date, selected) ? "active" : ""} ${isSameDay(date, today) ? "is-today" : ""}`}
            aria-pressed={isSameDay(date, selected)}
            aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日`}
            onClick={() => onSelect(date)}
          >
            <span>{WEEKDAYS[date.getDay()]}</span>
            <strong>{date.getDate()}</strong>
            <DayDots tasks={tasksOn(tasks, date)} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => onSelect(addDays(selected, 7))} aria-label="下一週">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function MonthCalendar({ tasks, selected, onSelect }) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  const selectedYear = selected.getFullYear();
  const selectedMonth = selected.getMonth();
  useEffect(() => {
    setMonth(new Date(selectedYear, selectedMonth, 1));
  }, [selectedYear, selectedMonth]);

  const today = new Date();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let blank = 0; blank < first.getDay(); blank += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="month-calendar">
      <div className="month-head">
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="上個月">
          <ChevronLeft size={18} />
        </button>
        <strong>{month.getFullYear()} 年 {month.getMonth() + 1} 月</strong>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="下個月">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="month-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="month-grid">
        {cells.map((date, index) => (
          date ? (
            <button
              key={date.toISOString()}
              type="button"
              className={`month-cell ${isSameDay(date, selected) ? "active" : ""} ${isSameDay(date, today) ? "is-today" : ""}`}
              aria-pressed={isSameDay(date, selected)}
              aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日`}
              onClick={() => onSelect(date)}
            >
              <span>{date.getDate()}</span>
              <DayDots tasks={tasksOn(tasks, date)} />
            </button>
          ) : (
            <span key={`blank-${index}`} className="month-cell is-blank" aria-hidden="true"></span>
          )
        ))}
      </div>
      {!isSameDay(selected, today) && (
        <button type="button" className="link-btn month-today" onClick={() => onSelect(new Date())}>
          回到今天
        </button>
      )}
    </div>
  );
}

function TaskRow({ task, members, onOpen }) {
  const due = dueOf(task);
  const overdue = due && due < new Date();
  const owner = task.assigned_to_id
    ? members.find((member) => member.id === task.assigned_to_id)
    : task.is_private
      ? members.find((member) => member.id === task.created_by_id)
      : null;
  return (
    <li>
      <button type="button" className={`task-row tone-${bubbleTone(task.priority_weight)}`} onClick={() => onOpen(task)}>
        <span className="task-dot" aria-hidden="true"></span>
        <span className="task-main">
          <strong>
            {task.title}
            {task.is_private && <Lock size={13} aria-label="私人泡泡" />}
          </strong>
          <small className={overdue ? "is-overdue" : ""}>
            {due ? `${formatDayLabel(due)} ${formatTime(due)}` : "未設定"}・{countdownText(task.due_time)}
          </small>
        </span>
        <span className="task-people">
          {owner ? (
            <Avatar name={owner.username} tone={owner.tone} size="sm" />
          ) : (
            <AvatarPair members={members} size="sm" />
          )}
        </span>
        <ChevronRight size={18} className="task-chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function TaskBoard({ tasks, members, selectedDate, onSelectedDateChange, onAddTask, onOpenTask }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("due");
  const [showFilters, setShowFilters] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const now = new Date();
  const anchor = startOfDay(selectedDate || now);
  const isToday = isSameDay(anchor, now);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (scope === "shared" && task.is_private) return false;
        if (scope === "private" && !task.is_private) return false;
        if (!keyword) return true;
        return `${task.title} ${task.description || ""} ${task.assigned_to_name || ""}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => (
        sort === "weight"
          ? b.priority_weight - a.priority_weight || (dueOf(a) - dueOf(b))
          : (dueOf(a) - dueOf(b))
      ));
  }, [tasks, query, scope, sort]);

  // Every bubble lands in exactly one group, so nothing is hidden.
  const groups = useMemo(() => {
    const used = new Set();
    const result = [];
    const reference = new Date();
    const take = (key, title, predicate, empty) => {
      const items = filtered.filter((task) => !used.has(task.id) && predicate(task));
      items.forEach((task) => used.add(task.id));
      if (items.length || empty) result.push({ key, title, items, empty });
    };
    take("overdue", "已逾期", (task) => dueOf(task) < reference);
    take(
      "day",
      isToday ? "今天" : `${anchor.getMonth() + 1} 月 ${anchor.getDate()} 日（${WEEKDAYS[anchor.getDay()]}）`,
      (task) => isSameDay(dueOf(task), anchor),
      isToday ? "今天沒有其他泡泡，可以好好休息。" : "這一天還沒有泡泡。"
    );
    take("week", "接下來 7 天", (task) => {
      const day = startOfDay(dueOf(task));
      return day > anchor && day <= addDays(anchor, 7);
    });
    take("later", "其他日期", () => true);
    return result;
  }, [filtered, anchor.getTime(), isToday]);

  const overdueCount = tasks.filter((task) => dueOf(task) < now).length;

  return (
    <div className="tasks-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">泡泡</span>
          <h1>泡泡清單</h1>
          <p className="page-sub">
            {tasks.length} 顆進行中{overdueCount > 0 ? `・${overdueCount} 顆已逾期` : ""}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-coral" onClick={() => onAddTask(anchor)}>
            <Plus size={19} />
            新泡泡
          </button>
        </div>
      </header>

      <div className="tasks-layout">
        <aside className="tasks-aside">
          <WeekStrip tasks={tasks} selected={anchor} onSelect={onSelectedDateChange} />

          <div className="task-tools">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋泡泡"
                aria-label="搜尋泡泡"
              />
            </label>
            <button
              type="button"
              className={`icon-btn mobile-only${showFilters ? " is-on" : ""}`}
              aria-pressed={showFilters}
              aria-label="篩選與排序"
              onClick={() => setShowFilters((value) => !value)}
            >
              <SlidersHorizontal size={19} />
            </button>
            <button
              type="button"
              className={`icon-btn mobile-only${showCalendar ? " is-on" : ""}`}
              aria-pressed={showCalendar}
              aria-label="顯示月曆"
              onClick={() => setShowCalendar((value) => !value)}
            >
              <CalendarDays size={19} />
            </button>
          </div>

          <div className={`card task-filters${showFilters ? " is-open" : ""}`}>
            <div className="filter-group">
              <span className="filter-label">範圍</span>
              <div className="segmented segmented-sm">
                {[
                  ["all", "全部"],
                  ["shared", "共享"],
                  ["private", "私人"],
                ].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={scope === value} className={scope === value ? "active" : ""} onClick={() => setScope(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-label">排序</span>
              <div className="segmented segmented-sm">
                {[
                  ["due", "時間"],
                  ["weight", "重要度"],
                ].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={sort === value} className={sort === value ? "active" : ""} onClick={() => setSort(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className={`card calendar-card${showCalendar ? " is-open" : ""}`} aria-label="月曆">
            <MonthCalendar tasks={tasks} selected={anchor} onSelect={onSelectedDateChange} />
          </section>
        </aside>

        <div className="tasks-main">
          {groups.map((group) => (
            <section key={group.key} className={`task-group group-${group.key}`} aria-labelledby={`group-${group.key}`}>
              <h2 id={`group-${group.key}`} className="group-title">
                {group.title}
                <span className="count-pill">{group.items.length}</span>
              </h2>
              {group.items.length === 0 ? (
                <p className="empty-line">{group.empty}</p>
              ) : (
                <ul className="task-list">
                  {group.items.map((task) => (
                    <TaskRow key={task.id} task={task} members={members} onOpen={onOpenTask} />
                  ))}
                </ul>
              )}
            </section>
          ))}
          {tasks.length > 0 && filtered.length === 0 && (
            <p className="empty-line">{query.trim() ? `沒有符合「${query.trim()}」的泡泡。` : "這個範圍目前沒有泡泡。"}</p>
          )}
        </div>
      </div>
    </div>
  );
}
