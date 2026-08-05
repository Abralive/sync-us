import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import TaskCard from "./TaskCard.jsx";
import { countdownText, formatDateTime } from "../utils/date.js";

export default function BubbleGarden({
  tasks,
  stardust,
  activeName,
  activeUser,
  onRefresh,
  onAddTask,
  onConnect,
  hasCouple,
  visualStyle,
  onVisualStyleChange,
}) {
  const [segment, setSegment] = useState("shared");
  const [selectedTask, setSelectedTask] = useState(null);

  const shared = tasks.filter((task) => !task.is_private);
  const privates = tasks.filter((task) => task.is_private);
  const list = segment === "private" ? privates : shared;

  const segments = [
    { key: "shared", label: "共享", count: shared.length },
    { key: "private", label: "私人", count: privates.length },
  ];
  const styleOptions = [
    { key: "fresh", label: "清新" },
    { key: "playful", label: "活潑" },
    { key: "tech", label: "科技" },
  ];

  return (
    <section className="garden-screen notebook-home">
      <div className="notebook-hero">
        <div className="notebook-copy">
          <div className="hero-meta-row">
            <span className="garden-kicker">Daily bubble note</span>
            <div className="style-switcher" aria-label="主視覺版本">
              {styleOptions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={visualStyle === item.key ? "active" : ""}
                  onClick={() => onVisualStyleChange(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <h2>今天先照顧哪幾顆？</h2>
          <p>把壓力放進泡泡裡。你們不用猜誰比較累，只要一起看見今天正在被照顧的事。</p>

          <div className="hero-flow">
            <button className="btn primary add-bubble-btn" onClick={hasCouple ? onAddTask : onConnect}>
              {hasCouple ? <Plus size={18} /> : <Sparkles size={18} />}
              {hasCouple ? "長一顆泡泡" : "先連結伴侶"}
            </button>
            <span>長按泡泡完成，星塵會掉進補給罐。</span>
          </div>
        </div>

        <div className="couple-note" aria-hidden="true">
          <div className="care-mascot">
            <span className="mascot-face one"></span>
            <span className="mascot-face two"></span>
            <span className="mascot-bubble"></span>
          </div>
          <p>不是催促，是一起照顧。</p>
        </div>

        <dl className="garden-stats">
          <div><dt>今天由</dt><dd>{activeName}</dd></div>
          <div><dt>待照顧</dt><dd>{tasks.length}</dd></div>
          <div><dt>星塵</dt><dd>{stardust}</dd></div>
        </dl>
      </div>

      <div className="garden-workspace">
        <div className="workspace-head">
          <div>
            <span className="workspace-label">泡泡棲地</span>
            <strong>{segment === "private" ? "自己的軌道" : "共享的今天"}</strong>
          </div>

          {hasCouple && (
            <div className="seg-control" role="tablist" aria-label="泡泡範圍">
              {segments.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  className={segment === item.key ? "seg active" : "seg"}
                  onClick={() => setSegment(item.key)}
                >
                  {item.label}
                  <span className="seg-count">{item.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!hasCouple ? (
          <div className="bubble-field">
            <div className="field-empty">
              <strong>還沒有共享星域</strong>
              <p>先選一個想一起照顧生活的人。</p>
              <button className="btn primary" onClick={onConnect}>建立連結</button>
            </div>
          </div>
        ) : (
          <>
            <div className="bubble-field">
              {list.length === 0 ? (
                <div className="field-empty">
                  <p>{segment === "private" ? "私人軌道目前很安靜。" : "還沒有共享泡泡，先長出第一顆吧。"}</p>
                  <button className="btn primary" onClick={onAddTask}>長一顆泡泡</button>
                </div>
              ) : (
                list.map((task, index) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    activeUser={activeUser}
                    onRefresh={onRefresh}
                    variant="garden"
                    index={index}
                    onOpenDetails={() => setSelectedTask(task)}
                  />
                ))
              )}
            </div>
            {list.length > 0 && (
              <p className="garden-tip">輕點看細節，長按完成。</p>
            )}
          </>
        )}
      </div>

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
              <span>照顧中</span>
            </div>
            <p className="pop-hint">回到星域長按這顆泡泡，就能戳破完成。</p>
          </div>
        </div>
      )}
    </section>
  );
}
