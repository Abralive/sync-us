export default function Header({ users, activeUser, onActiveUserChange, onLogout }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"></div>
        <div>
          <h1 className="brand-title">Sync-Us</h1>
          <p className="brand-subtitle">兩個人的泡泡星域</p>
        </div>
      </div>
      <div className="topbar-actions">
        <select
          className="user-select"
          value={activeUser}
          onChange={(event) => onActiveUserChange(Number(event.target.value))}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.username}</option>
          ))}
        </select>
        <button className="btn logout-btn" onClick={onLogout}>登出</button>
      </div>
    </header>
  );
}
