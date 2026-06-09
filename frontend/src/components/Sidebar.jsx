import { STORE_ITEMS } from "../constants.js";
import { countdownText, formatDateTime } from "../utils/date.js";

export default function Sidebar({ tasks }) {
  const timeline = [...tasks].sort((a, b) => new Date(a.due_time) - new Date(b.due_time)).slice(0, 4);
  return (
    <aside className="side-stack">
      <section className="panel">
        <h2 className="section-title">近期節點</h2>
        <div className="list">
          {timeline.length === 0 ? (
            <div className="list-item">
              <div className="item-title">還沒有任務</div>
              <div className="item-copy">建立第一個任務後，這裡會顯示最近截止項目。</div>
            </div>
          ) : timeline.map((task) => (
            <div className="list-item" key={task.id}>
              <div className="item-kicker">{task.is_private ? "私人軌道" : "共享世界"}</div>
              <div className="item-title">{task.title}</div>
              <div className="item-copy">{formatDateTime(task.due_time)} · {countdownText(task.due_time)}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2 className="section-title">星塵補給站</h2>
        <div className="list">
          {STORE_ITEMS.map(([title, price, copy]) => (
            <div className="list-item" key={title}>
              <div className="item-kicker">{price}</div>
              <div className="item-title">{title}</div>
              <div className="item-copy">{copy}</div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
