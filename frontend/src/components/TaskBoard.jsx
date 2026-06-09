import { countdownText, formatDateTime } from "../utils/date.js";

export default function TaskBoard({ tasks }) {
  if (!tasks.length) {
    return <div className="empty">目前沒有需要照顧的泡泡。</div>;
  }

  return (
    <div className="care-list">
      {tasks.map((task) => (
        <article className="care-item" key={task.id}>
          <div>
            <h3>{task.title}</h3>
            <p>{formatDateTime(task.due_time)} · {countdownText(task.due_time)}</p>
          </div>
          <span>{task.is_completed ? "可領星塵" : "照顧中"}</span>
        </article>
      ))}
    </div>
  );
}
