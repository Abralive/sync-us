import { CalendarDays, ChevronRight, Lock, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { REWARD_PREVIEW, bubbleTone } from "../constants.js";
import { bubbleCapacity, layoutBubbles } from "../utils/bubbleLayout.js";
import {
  WEEKDAYS,
  addDays,
  formatDateTime,
  isOverdue,
  isSameDay,
  parseServerDate,
  startOfDay,
} from "../utils/date.js";
import Avatar from "./Avatar.jsx";
import TaskCard from "./TaskCard.jsx";

function hoursUntil(task, now) {
  const due = parseServerDate(task.due_time);
  return due ? (due - now) / 36e5 : 9999;
}

function bubbleDiameter(task, now) {
  const hours = hoursUntil(task, now);
  const urgency = hours < 0 ? 22 : hours < 24 ? 20 : hours < 72 ? 10 : 0;
  return 120 + (Number(task.priority_weight) || 0) * 0.95 + urgency;
}

function importance(task, now) {
  const hours = hoursUntil(task, now);
  const urgency = hours < 0 ? 60 : hours < 24 ? 40 : hours < 72 ? 15 : 0;
  return (Number(task.priority_weight) || 0) + urgency;
}

function byDueTime(a, b) {
  return (parseServerDate(a.due_time) || 0) - (parseServerDate(b.due_time) || 0);
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) => (
        Math.abs(previous.width - rect.width) < 1 && Math.abs(previous.height - rect.height) < 1
          ? previous
          : { width: rect.width, height: rect.height }
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const TOUR_STEPS = [
  {
    title: "泡泡越大，越要先處理",
    body: "重要度越高、離期限越近，泡泡就越大。一眼就看得出現在該先顧哪一件。",
  },
  {
    title: "點一下看細節，長按戳破完成",
    body: "按住泡泡，外圈繞滿一圈就會戳破、掉下星塵。不小心戳破了，可以馬上按「復原」。",
  },
  {
    title: "一起看見彼此扛了多少",
    body: "「今天的我們」會算出兩個人各扛著幾顆泡泡。按「新泡泡」或右下角的＋，就能放進新的事。",
  },
];

function tourKey(userId) {
  return `sync-us-tour-v1:${userId}`;
}

function readTourDone(userId) {
  try {
    return localStorage.getItem(tourKey(userId)) === "done";
  } catch {
    return true; // without storage the tour would reappear on every visit
  }
}

// First visit to the starfield: three short tips. Never shown again once finished or skipped.
function CoachCard({ userId }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(() => !readTourDone(userId));
  if (!visible) return null;

  function finish() {
    try {
      localStorage.setItem(tourKey(userId), "done");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  const last = step === TOUR_STEPS.length - 1;
  const current = TOUR_STEPS[step];
  return (
    <section className="card coach-card" aria-labelledby="coach-title" aria-live="polite">
      <span className="coach-step">
        <Sparkles size={15} aria-hidden="true" />
        第 {step + 1} 步，共 {TOUR_STEPS.length} 步
      </span>
      <button type="button" className="icon-btn coach-close" onClick={finish} aria-label="關閉導覽">
        <X size={18} />
      </button>
      <h2 id="coach-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="coach-foot">
        <span className="coach-dots" aria-hidden="true">
          {TOUR_STEPS.map((item, index) => (
            <i key={item.title} className={index === step ? "is-active" : ""}></i>
          ))}
        </span>
        <div className="btn-row">
          {!last && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
              略過
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? "開始使用" : "下一步"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Orbits() {
  return (
    <svg className="starfield-orbits" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <ellipse cx="200" cy="150" rx="188" ry="128" className="orbit orbit-outer" vectorEffect="non-scaling-stroke" />
      <ellipse cx="200" cy="150" rx="132" ry="88" className="orbit orbit-middle" vectorEffect="non-scaling-stroke" />
      <ellipse cx="200" cy="150" rx="76" ry="50" className="orbit orbit-inner" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function BubbleGarden({
  tasks,
  members,
  activeUser,
  stats,
  stardust,
  onAddTask,
  onOpenTask,
  onPopTask,
  onOpenDate,
  onSeeAll,
}) {
  const [scope, setScope] = useState("shared");
  const fieldRef = useRef(null);
  const size = useElementSize(fieldRef);
  const me = Number(activeUser);
  const now = new Date();

  const scopedTasks = useMemo(() => {
    const list = scope === "personal"
      ? tasks.filter((task) => task.is_private || task.assigned_to_id === me)
      : tasks.filter((task) => !task.is_private);
    const reference = new Date();
    return [...list].sort((a, b) => importance(b, reference) - importance(a, reference));
  }, [tasks, scope, me]);

  const isNarrow = size.width < 520;
  const minBubble = isNarrow ? 98 : 116;
  const capacity = Math.min(isNarrow ? 9 : 14, bubbleCapacity(size.width, size.height, minBubble));
  const visibleTasks = scopedTasks.slice(0, capacity);
  const hiddenCount = scopedTasks.length - visibleTasks.length;
  const layoutKey = visibleTasks.map((task) => `${task.id}:${task.priority_weight}:${task.due_time}`).join("|");

  const positions = useMemo(() => {
    const reference = new Date();
    const placed = layoutBubbles(
      visibleTasks.map((task) => ({ id: task.id, size: bubbleDiameter(task, reference) })),
      size.width,
      size.height,
      { minSize: minBubble, maxSize: isNarrow ? 188 : 236 }
    );
    return new Map(placed.map((spot) => [spot.id, spot]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, size.width, size.height]);

  // Each person's load: bubbles assigned to them, plus shared ones nobody claimed.
  const loads = members.map((member) => {
    const carried = tasks.filter((task) => {
      if (task.is_private) return task.created_by_id === member.id;
      return task.assigned_to_id ? task.assigned_to_id === member.id : true;
    });
    const privateHidden = member.id === me ? 0 : Number(stats?.private_active?.[String(member.id)] || 0);
    const weight = carried.reduce((sum, task) => sum + (Number(task.priority_weight) || 0), 0) + privateHidden * 50;
    return {
      member,
      count: carried.length,
      heavy: carried.filter((task) => task.priority_weight >= 80).length,
      soon: carried.filter((task) => hoursUntil(task, now) < 24).length,
      privateHidden,
      percent: Math.min(100, Math.round(weight / 4)),
    };
  });

  const upcoming = [...tasks].sort(byDueTime).slice(0, 5);
  const today = startOfDay(now);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const nextReward = REWARD_PREVIEW.find((item) => item.cost > stardust) || REWARD_PREVIEW[REWARD_PREVIEW.length - 1];
  const rewardProgress = Math.min(100, Math.round((stardust / nextReward.cost) * 100));

  return (
    <div className="home-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">共享星域</span>
          <h1>看見彼此正在扛的事</h1>
        </div>
        <div className="page-actions">
          <div className="segmented" role="tablist" aria-label="星域範圍">
            {[
              ["shared", "共享"],
              ["personal", "我的"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                className={scope === value ? "active" : ""}
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-coral hide-on-mobile" onClick={() => onAddTask()}>
            <Plus size={19} />
            新泡泡
          </button>
        </div>
      </header>

      <CoachCard key={me} userId={me} />

      <div className="home-grid">
        <section className="card starfield-card" aria-label="泡泡星域">
          <div className="starfield" ref={fieldRef}>
            <Orbits />
            <span className="tiny-star star-a" aria-hidden="true">✦</span>
            <span className="tiny-star star-b" aria-hidden="true">✧</span>
            <span className="tiny-star star-c" aria-hidden="true">✦</span>

            {scopedTasks.length === 0 ? (
              <div className="starfield-empty">
                <strong>{scope === "personal" ? "你的軌道很安靜" : "今天的星域很安靜"}</strong>
                <p>{scope === "personal" ? "交給你或私人的泡泡會出現在這裡。" : "放一顆兩個人都要記得的事進來吧。"}</p>
                <button type="button" className="btn btn-primary" onClick={() => onAddTask()}>
                  <Plus size={18} />
                  新泡泡
                </button>
              </div>
            ) : (
              visibleTasks.map((task, index) => {
                const position = positions.get(task.id);
                if (!position) return null;
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    index={index}
                    position={position}
                    members={members}
                    onOpenDetails={onOpenTask}
                    onPop={onPopTask}
                  />
                );
              })
            )}
          </div>
          <footer className="starfield-foot">
            <p>
              <Sparkles size={16} />
              點泡泡看細節，長按戳破完成
            </p>
            {hiddenCount > 0 && (
              <button type="button" className="link-btn" onClick={onSeeAll}>
                還有 {hiddenCount} 顆
                <ChevronRight size={16} />
              </button>
            )}
          </footer>
        </section>

        <aside className="home-side">
          <section className="card us-card" aria-labelledby="us-title">
            <span className="tape" aria-hidden="true"></span>
            <h2 id="us-title" className="card-title hand">今天的我們</h2>
            <ul className="load-list">
              {loads.map(({ member, count, heavy, soon, privateHidden, percent }) => (
                <li key={member.id} className="load-row">
                  <Avatar name={member.username} tone={member.tone} size="lg" active={member.id === me} />
                  <div className="load-body">
                    <div className="load-head">
                      <strong>{member.username}{member.id === me ? "（我）" : ""}</strong>
                      <span>{count > 0 ? `扛著 ${count} 顆` : "目前很輕鬆"}</span>
                    </div>
                    <span className="meter" aria-hidden="true">
                      <i className={`meter-fill tone-${member.tone}`} style={{ width: `${Math.max(count || privateHidden ? 6 : 0, percent)}%` }}></i>
                    </span>
                    <div className="load-tags">
                      {heavy > 0 && <span className="tag tag-hot">{heavy} 顆很重要</span>}
                      {soon > 0 && <span className="tag tag-warm">{soon} 顆 24 小時內</span>}
                      {privateHidden > 0 && (
                        <span className="tag">
                          <Lock size={11} />
                          {privateHidden} 顆私人
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card schedule-card" aria-labelledby="schedule-title">
            <div className="card-head">
              <h2 id="schedule-title" className="card-title hand">
                <CalendarDays size={18} />
                近期行程
              </h2>
              <button type="button" className="link-btn" onClick={onSeeAll}>
                全部
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="week-dots" aria-label="接下來七天">
              {weekDays.map((date) => {
                const count = tasks.filter((task) => isSameDay(parseServerDate(task.due_time), date)).length;
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    className={isSameDay(date, today) ? "is-today" : ""}
                    onClick={() => onOpenDate(date)}
                    aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日，${count} 顆泡泡`}
                  >
                    <span>{WEEKDAYS[date.getDay()]}</span>
                    <strong>{date.getDate()}</strong>
                    <i data-count={Math.min(count, 3)}></i>
                  </button>
                );
              })}
            </div>
            <ul className="mini-list">
              {upcoming.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onOpenTask(task)}>
                    <i className={`dot tone-${bubbleTone(task.priority_weight)}`} aria-hidden="true"></i>
                    <span>
                      <strong>{task.title}</strong>
                      <small className={isOverdue(task.due_time) ? "is-overdue" : ""}>{formatDateTime(task.due_time)}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
              {upcoming.length === 0 && <li className="quiet">接下來沒有行程。</li>}
            </ul>
          </section>

          <section className="card dust-card" aria-labelledby="dust-title">
            <h2 id="dust-title" className="card-title hand">
              <Sparkles size={18} />
              我們的星塵瓶
            </h2>
            <div className="dust-body">
              <div className="jar" aria-hidden="true">
                <span className="jar-cap"></span>
                <span className="jar-glass">
                  <span className="jar-fill" style={{ height: `${Math.max(8, rewardProgress)}%` }}></span>
                </span>
              </div>
              <div className="dust-copy">
                <strong>{stardust} <small>顆星塵</small></strong>
                <p>
                  {stardust >= nextReward.cost
                    ? "已經可以去商城兌換了！"
                    : `再 ${nextReward.cost - stardust} 顆就能換「${nextReward.title}」`}
                </p>
                <span className="meter" aria-hidden="true">
                  <i className="meter-fill tone-gold" style={{ width: `${rewardProgress}%` }}></i>
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <button type="button" className="fab" onClick={() => onAddTask()} aria-label="新增泡泡">
        <Plus size={26} />
      </button>
    </div>
  );
}
