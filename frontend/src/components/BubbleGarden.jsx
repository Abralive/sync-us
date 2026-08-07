import { CalendarDays, Heart, MessageCircle, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import TaskCard from "./TaskCard.jsx";
import { countdownText, formatDateTime } from "../utils/date.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getInitial(name) {
  return name?.trim()?.slice(0, 1) || "?";
}

function sortByDueTime(tasks) {
  return [...tasks].sort((a, b) => new Date(a.due_time) - new Date(b.due_time));
}

function GalaxyOrbits() {
  return (
    <svg className="galaxy-orbits" viewBox="0 0 420 520" aria-hidden="true" focusable="false">
      <ellipse cx="210" cy="260" rx="186" ry="116" className="orbit orbit-outer" />
      <ellipse cx="210" cy="260" rx="142" ry="82" className="orbit orbit-middle" />
      <ellipse cx="210" cy="260" rx="92" ry="52" className="orbit orbit-inner" />
      <path className="orbit-pencil" d="M70 282 C130 198, 258 186, 350 248" />
    </svg>
  );
}

export default function BubbleGarden({
  tasks,
  stardust,
  activeName,
  users,
  activeUser,
  onRefresh,
  onAddTask,
  onConnect,
  hasCouple,
}) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [scope, setScope] = useState("shared");
  const visibleTasks = tasks.filter((task) => !task.is_completed);
  const sharedTasks = visibleTasks.filter((task) => !task.is_private);
  const personalTasks = visibleTasks.filter(
    (task) =>
      task.is_private ||
      task.assigned_to_id === Number(activeUser) ||
      task.created_by_id === Number(activeUser)
  );
  const starfieldTasks = scope === "personal" ? personalTasks : sharedTasks;
  const fallbackStarfieldTasks = starfieldTasks.length > 0 ? starfieldTasks : visibleTasks;
  const upcomingTasks = useMemo(() => sortByDueTime(visibleTasks).slice(0, 4), [visibleTasks]);
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 3));
  const firstUser = users[0] || { username: "Mina", id: 1 };
  const secondUser = users[1] || { username: "Kai", id: 2 };
  const stardustGoal = 50;
  const stardustProgress = Math.min(100, Math.round((stardust / stardustGoal) * 100));
  const relationText = `${firstUser.username} 7/10 ♡ ${secondUser.username} 6/10`;

  return (
    <section className="journal-home" aria-label="Sync-Us 首頁">
      <aside className="today-us-panel" aria-label="今天的我們">
        <span className="tape tape-teal"></span>
        <div className="handwritten-title">
          <h2>今天的我們</h2>
          <span>快速打個氣吧</span>
        </div>

        <div className="mood-pair">
          {[firstUser, secondUser].map((user, index) => (
            <div className="mood-person" key={user.id}>
              <button
                type="button"
                className={`large-avatar avatar-${index + 1} ${Number(activeUser) === user.id ? "active" : ""}`}
                aria-label={`${user.username} 的今日狀態`}
              >
                <span>{getInitial(user.username)}</span>
              </button>
              <strong>{user.username}</strong>
              <span className="mood-score">
                <Heart size={15} />
                {index === 0 ? "7/10" : "6/10"}
              </span>
            </div>
          ))}
        </div>

        <div className="care-message">
          <MessageCircle size={17} />
          <p>謝謝你昨天幫我處理那麼多事，今晚散步後一起看電影吧 :)</p>
        </div>

        <div className="week-strip" aria-label="一週日期">
          {weekDays.map((date, index) => (
            <button
              key={date.toISOString()}
              type="button"
              className={index === 3 ? "active" : ""}
              aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日，星期${WEEKDAYS[date.getDay()]}`}
            >
              <span>{WEEKDAYS[date.getDay()]}</span>
              <strong>{date.getDate()}</strong>
            </button>
          ))}
        </div>

        <div className="weekly-note">
          <span>本週小目標</span>
          <p>一起規劃一次小旅行</p>
        </div>
      </aside>

      <main className="shared-starfield-panel" aria-label="共享星域">
        <div className="starfield-head">
          <div>
            <span>共享星域</span>
            <h2>看見彼此正在扛的事</h2>
          </div>
          <div className="mobile-scope-tabs" role="tablist" aria-label="星域範圍">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "shared"}
              className={scope === "shared" ? "active" : ""}
              onClick={() => setScope("shared")}
            >
              共享
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "personal"}
              className={scope === "personal" ? "active" : ""}
              onClick={() => setScope("personal")}
            >
              個人
            </button>
          </div>
          <div className="starfield-hint">
            <Sparkles size={18} />
            長按泡泡完成，讓壓力變成星塵
          </div>
        </div>

        <div className="mobile-starfield-controls" aria-label="手機星域控制">
          <button className="mobile-relation-strip" type="button" onClick={onConnect}>
            {relationText}
          </button>
        </div>

        {!hasCouple ? (
          <div className="bubble-field journal-starfield empty-starfield">
            <GalaxyOrbits />
            <div className="field-empty">
              <strong>還沒有共享星域</strong>
              <p>先選一個想一起照顧生活的人。</p>
              <button className="btn primary" onClick={onConnect}>建立連結</button>
            </div>
          </div>
        ) : (
          <div className="bubble-field journal-starfield">
            <GalaxyOrbits />
            <span className="tiny-star star-a">✦</span>
            <span className="tiny-star star-b">✧</span>
            <span className="tiny-star star-c">✦</span>
            {fallbackStarfieldTasks.length === 0 ? (
              <div className="field-empty">
                <p>今天的星域很安靜。</p>
                <button className="btn primary" onClick={onAddTask}>＋ 新泡泡</button>
              </div>
            ) : (
              <div className="bubble-layer">
                {fallbackStarfieldTasks.map((task, index) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    activeUser={activeUser}
                    onRefresh={onRefresh}
                    variant="garden"
                    index={index}
                    onOpenDetails={() => setSelectedTask(task)}
                  />
                ))}
              </div>
            )}
            <p className="mobile-galaxy-tip">點一下看細節，長按戳破完成。</p>
          </div>
        )}

        <button className="new-bubble-cta" type="button" onClick={hasCouple ? onAddTask : onConnect}>
          <Plus size={22} />
          新泡泡
        </button>
      </main>

      <aside className="life-side-panel" aria-label="生活資訊">
        <section className="mini-schedule">
          <span className="paper-clip"></span>
          <div className="side-title">
            <CalendarDays size={18} />
            <h3>近期行程</h3>
          </div>
          <div className="mini-week">
            {weekDays.slice(2, 7).map((date, index) => (
              <span key={date.toISOString()} className={index === 1 ? "active" : ""}>
                {date.getDate()}
              </span>
            ))}
          </div>
          <div className="schedule-list">
            {upcomingTasks.map((task) => (
              <button key={task.id} type="button" onClick={() => setSelectedTask(task)}>
                <i className={task.priority_weight >= 80 ? "hot" : task.priority_weight >= 55 ? "warm" : "cool"}></i>
                <span>
                  <strong>{task.title}</strong>
                  <small>{formatDateTime(task.due_time)}</small>
                </span>
                <em>{task.assigned_to_name ? getInitial(task.assigned_to_name) : "雙"}</em>
              </button>
            ))}
            {upcomingTasks.length === 0 && <p className="quiet-empty">沒有近期行程。</p>}
          </div>
        </section>

        <section className="stardust-bottle">
          <div className="side-title">
            <Sparkles size={18} />
            <h3>我們的星塵瓶</h3>
          </div>
          <div className="bottle-illustration" aria-hidden="true">
            <span className="bottle-cap"></span>
            <span className="bottle-glass"></span>
            <span className="bottle-star s1">★</span>
            <span className="bottle-star s2">✦</span>
            <span className="bottle-star s3">★</span>
          </div>
          <div className="stardust-copy">
            <strong>{stardust} 顆</strong>
            <p>再完成幾顆，就能收集星塵。</p>
            <div className="progress-track">
              <span style={{ width: `${stardustProgress}%` }}></span>
            </div>
            <small>{stardust} / {stardustGoal}</small>
          </div>
        </section>
      </aside>

      {selectedTask && (
        <div className="detail-sheet" role="dialog" aria-modal="true">
          <button className="sheet-backdrop" onClick={() => setSelectedTask(null)} aria-label="關閉"></button>
          <div className="sheet-panel">
            <button className="sheet-handle" onClick={() => setSelectedTask(null)} aria-label="關閉"></button>
            <button className="sheet-close" onClick={() => setSelectedTask(null)} aria-label="關閉">×</button>
            <span className="garden-kicker">{selectedTask.is_private ? "私人軌道" : "共享星域"}</span>
            <h3>{selectedTask.title}</h3>
            <p>{formatDateTime(selectedTask.due_time)} · {countdownText(selectedTask.due_time)}</p>
            {selectedTask.description && <p>{selectedTask.description}</p>}
            {selectedTask.collaboration_note && <p>{selectedTask.collaboration_note}</p>}
            {selectedTask.assigned_to_name && <p>交給 {selectedTask.assigned_to_name}</p>}
            <div className="sheet-meta">
              <span>重要度 {selectedTask.priority_weight}</span>
              <span>{selectedTask.created_by_name ? `建立者 ${selectedTask.created_by_name}` : "照顧中"}</span>
            </div>
            <p className="pop-hint">回到星域長按這顆泡泡，就能戳破完成。</p>
          </div>
        </div>
      )}
    </section>
  );
}
