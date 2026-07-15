import { useState } from "react";
import TaskCard from "./TaskCard.jsx";
import { countdownText, formatDateTime } from "../utils/date.js";

export default function BubbleGarden({
  tasks,
  stats,
  stardust,
  activeName,
  activeUser,
  onRefresh,
  onAddTask,
  onConnect,
  hasCouple,
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

  return (
    <section className="garden-screen">
      <div className="garden-header compact">
        <div>
          <span className="garden-kicker">Bubble Habitat</span>
          <h2>泡泡星域</h2>
        </div>
        <button className="btn primary" onClick={hasCouple ? onAddTask : onConnect}>
          {hasCouple ? "新增泡泡" : "連結伴侶"}
        </button>
      </div>

      <div className="garden-stats">
        <div><span>目前星球</span><strong>{activeName}</strong></div>
        <div><span>照顧中</span><strong>{tasks.length}</strong></div>
        <div><span>星塵</span><strong>{stardust}</strong></div>
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

      {!hasCouple ? (
        <div className="bubble-field">
          <div className="field-empty">
            <strong>還沒有共享星域</strong>
            <p>先選一個想一起照顧生活的人，泡泡才知道要飄去哪裡。</p>
            <button className="btn primary" onClick={onConnect}>建立連結</button>
          </div>
        </div>
      ) : (
        <>
          <div className="bubble-field">
            {list.length === 0 ? (
              <div className="field-empty">
                <p>{segment === "private" ? "私人軌道目前很安靜，只有你看得到。" : "還沒有共享泡泡，先長出第一顆吧。"}</p>
                <button className="btn primary" onClick={onAddTask}>新增泡泡</button>
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
            <p className="garden-tip">輕點看細節，長按戳破完成。完成紀錄放在連結頁，這裡只照顧還活著的泡泡。</p>
          )}
        </>
      )}

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
