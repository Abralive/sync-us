export default function Stats({ stats, activeName, tasks }) {
  const completed = tasks.filter((task) => task.is_completed).length;
  const points = completed * 12;
  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-label">目前使用者</div>
        <div className="stat-value">{activeName}</div>
      </div>
      <div className="stat">
        <div className="stat-label">軌道任務</div>
        <div className="stat-value">{stats?.total || 0}</div>
      </div>
      <div className="stat">
        <div className="stat-label">完成率</div>
        <div className="stat-value">{stats?.completion_rate || 0}%</div>
      </div>
      <div className="stat">
        <div className="stat-label">星塵幣</div>
        <div className="stat-value">{points}</div>
      </div>
    </div>
  );
}
