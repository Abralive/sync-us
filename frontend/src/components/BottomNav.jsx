import { CalendarCheck, Gift, HeartHandshake, Home, User } from "lucide-react";

const NAV_ITEMS = [
  { key: "home", label: "星域", icon: Home },
  { key: "partner", label: "連結", icon: HeartHandshake },
  { key: "tasks", label: "泡泡", icon: CalendarCheck },
  { key: "shop", label: "商城", icon: Gift },
  { key: "profile", label: "我的", icon: User },
];

export default function BottomNav({ activeTab, onTabChange, pendingConfirm = 0 }) {
  return (
    <nav className="bottom-nav" aria-label="主要導覽">
      {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
        <button key={key} className={activeTab === key ? "active" : ""} onClick={() => onTabChange(key)}>
          <span className="nav-icon-wrap">
            <Icon size={20} strokeWidth={2.2} />
            {key === "partner" && pendingConfirm > 0 && <span className="nav-badge">{pendingConfirm}</span>}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
