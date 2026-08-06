import { CalendarCheck, ChevronLeft, ChevronRight, Gift, HeartHandshake, Home, Settings, User } from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { key: "home", label: "星域", icon: Home },
  { key: "partner", label: "連結", icon: HeartHandshake },
  { key: "tasks", label: "泡泡", icon: CalendarCheck },
  { key: "shop", label: "商城", icon: Gift },
  { key: "profile", label: "我的", icon: User },
];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function formatJournalDate(date) {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日・星期${WEEKDAYS[date.getDay()]}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getInitial(name) {
  return name?.trim()?.slice(0, 1) || "?";
}

export default function Header({ users, activeUser, activeTab, onActiveUserChange, onTabChange, onLogout }) {
  const [viewDate, setViewDate] = useState(new Date());

  return (
    <header className="topbar journal-topbar">
      <div className="brand">
        <div className="brand-mark"></div>
        <div>
          <h1 className="brand-title">Sync-Us</h1>
          <p className="brand-subtitle">兩人的共享手帳</p>
        </div>
      </div>

      <nav className="desktop-nav" aria-label="桌面主要導覽">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "active" : ""}
            onClick={() => onTabChange(key)}
          >
            <Icon size={17} strokeWidth={2.1} />
            {label}
          </button>
        ))}
      </nav>

      <div className="date-switcher" aria-label="日期切換">
        <button type="button" onClick={() => setViewDate((date) => addDays(date, -1))} aria-label="前一天">
          <ChevronLeft size={21} />
        </button>
        <strong>{formatJournalDate(viewDate)}</strong>
        <button type="button" onClick={() => setViewDate((date) => addDays(date, 1))} aria-label="後一天">
          <ChevronRight size={21} />
        </button>
      </div>

      <div className="topbar-actions journal-actions">
        <div className="partner-avatars" aria-label="使用者切換">
          {users.slice(0, 2).map((user, index) => (
            <button
              key={user.id}
              type="button"
              className={`partner-avatar avatar-${index + 1} ${Number(activeUser) === user.id ? "active" : ""}`}
              onClick={() => onActiveUserChange(user.id)}
              aria-label={`切換為 ${user.username}`}
              title={user.username}
            >
              <span>{getInitial(user.username)}</span>
            </button>
          ))}
        </div>
        <select
          className="user-select mobile-user-select"
          value={activeUser}
          onChange={(event) => onActiveUserChange(Number(event.target.value))}
          aria-label="選擇使用者"
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.username}</option>
          ))}
        </select>
        <button className="icon-settings" type="button" onClick={() => onTabChange("profile")} aria-label="設定">
          <Settings size={24} strokeWidth={2.1} />
        </button>
        <button className="btn logout-btn" onClick={onLogout}>登出</button>
      </div>
    </header>
  );
}
