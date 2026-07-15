import { useMemo, useState } from "react";
import { request } from "../api/client.js";
import { formatDateTime } from "../utils/date.js";

const DOMAIN_FILTERS = [
  { key: "all", label: "全部" },
  { key: "shared", label: "共享" },
  { key: "private", label: "私人" },
];

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "awarded", label: "已入帳" },
  { key: "pending", label: "待確認" },
];

export default function CompletedPage({ completed, activeUser, stardust, stats, onRefresh, embedded = false }) {
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const [busyId, setBusyId] = useState(null);

  const list = useMemo(() => {
    return completed.filter((task) => {
      if (domain === "shared" && task.is_private) return false;
      if (domain === "private" && !task.is_private) return false;
      if (status === "awarded" && task.stardust_awarded <= 0) return false;
      if (status === "pending" && !(task.is_completed && !task.confirmed && !task.is_private)) return false;
      return true;
    });
  }, [completed, domain, status]);

  async function confirm(taskId) {
    setBusyId(taskId);
    try {
      await request(`/tasks/${taskId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser }),
      });
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function statusBadge(task) {
    if (task.stardust_awarded > 0) {
      return <span className="done-badge ok">已獲得 {task.stardust_awarded} 星塵</span>;
    }
    if (!task.is_private && !task.confirmed) {
      if (task.completed_by_id === Number(activeUser)) {
        return <span className="done-badge wait">等待伴侶確認</span>;
      }
      return (
        <button className="btn primary done-confirm" disabled={busyId === task.id} onClick={() => confirm(task.id)}>
          {busyId === task.id ? "確認中..." : "確認這顆泡泡"}
        </button>
      );
    }
    return <span className="done-badge none">未達星塵資格</span>;
  }

  return (
    <section className="done-page">
      {!embedded && (
        <div className="growth-intro">
          <span className="garden-kicker">Completed</span>
          <h2>完成回顧</h2>
          <p>戳破後的泡泡會留在這裡。共享泡泡需要另一半確認後，才會依規則發放星塵。</p>
        </div>
      )}

      <div className="done-summary">
        <div><strong>{completed.length}</strong><span>完成總數</span></div>
        <div><strong>{stardust}</strong><span>累積星塵</span></div>
        <div><strong>{stats?.pending_confirm || 0}</strong><span>待確認</span></div>
      </div>

      <div className="done-filters">
        <div className="filter-row">
          <span className="filter-label">範圍</span>
          <div className="filter-chips">
            {DOMAIN_FILTERS.map((filter) => (
              <button key={filter.key} className={domain === filter.key ? "chip active" : "chip"} onClick={() => setDomain(filter.key)}>
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <span className="filter-label">狀態</span>
          <div className="filter-chips">
            {STATUS_FILTERS.map((filter) => (
              <button key={filter.key} className={status === filter.key ? "chip active" : "chip"} onClick={() => setStatus(filter.key)}>
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty">目前沒有符合條件的完成泡泡。</div>
      ) : (
        <div className="done-list">
          {list.map((task) => (
            <article className="done-item" key={task.id}>
              <div className="done-item-main">
                <div className="task-meta">
                  <span className={`pill ${task.is_private ? "pill-private" : "pill-shared"}`}>
                    {task.is_private ? "私人軌道" : "共享星域"}
                  </span>
                  <span className="pill">重要度 {task.priority_weight}</span>
                </div>
                <h3>{task.title}</h3>
                <p className="task-detail dim">
                  {task.completed_by_name || "有人"} 於 {formatDateTime(task.completed_at)} 戳破
                  {task.confirmed_by_name ? ` · ${task.confirmed_by_name} 已確認` : ""}
                </p>
              </div>
              <div className="done-item-side">{statusBadge(task)}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
