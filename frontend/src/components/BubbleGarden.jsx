import { useState } from "react";
import TaskCard from "./TaskCard.jsx";
import { countdownText, formatDateTime } from "../utils/date.js";

export default function BubbleGarden({ tasks, stats, activeName, onRefresh, onAddTask, onConnect, hasCouple }) {
  const [selectedTask, setSelectedTask] = useState(null);
  const completed = tasks.filter((task) => task.is_completed).length;
  const stardust = completed * 12;

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
        <div>
          <span>目前星球</span>
          <strong>{activeName}</strong>
        </div>
        <div>
          <span>泡泡</span>
          <strong>{stats?.total || 0}</strong>
        </div>
        <div>
          <span>星塵</span>
          <strong>{stardust}</strong>
        </div>
      </div>

      <div className="garden-stage">
        <div className="garden-orbit one"></div>
        <div className="garden-orbit two"></div>
        <div className="garden-orbit three"></div>
        {!hasCouple ? (
          <div className="garden-empty">
            <div>
              <strong>還沒有共享星域</strong>
              <p>先選一個想一起照顧生活的人。</p>
              <button className="btn primary" onClick={onConnect}>建立連結</button>
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="garden-empty">
            <div>
              <strong>現在沒有泡泡</strong>
              <p>新增一顆，把要一起面對的事放進星域。</p>
              <button className="btn primary" onClick={onAddTask}>新增泡泡</button>
            </div>
          </div>
        ) : (
          <div className="garden-bubbles">
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                onRefresh={onRefresh}
                variant="garden"
                index={index}
                onOpenDetails={() => setSelectedTask(task)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedTask && (
        <div className="detail-sheet" role="dialog" aria-modal="true">
          <button className="sheet-backdrop" onClick={() => setSelectedTask(null)} aria-label="關閉"></button>
          <div className="sheet-panel">
            <div className="sheet-handle"></div>
            <span className="garden-kicker">{selectedTask.is_private ? "私人軌道" : "共享星域"}</span>
            <h3>{selectedTask.title}</h3>
            <p>{formatDateTime(selectedTask.due_time)} · {countdownText(selectedTask.due_time)}</p>
            {selectedTask.description && <p>{selectedTask.description}</p>}
            {selectedTask.assigned_to_name && <p>交給 {selectedTask.assigned_to_name}</p>}
            <div className="sheet-meta">
              <span>重要度 {selectedTask.priority_weight}</span>
              <span>{selectedTask.is_completed ? "已完成" : "照顧中"}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
