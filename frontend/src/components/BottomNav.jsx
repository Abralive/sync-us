import { CalendarCheck, Gift, Home, Orbit, User } from "lucide-react";

const NAV_ITEMS = [
  { key: "home", label: "首頁", icon: Home },
  { key: "shared", label: "共享", icon: Orbit },
  { key: "tasks", label: "任務", icon: CalendarCheck },
  { key: "shop", label: "商城", icon: Gift },
  { key: "profile", label: "我的", icon: User },
];

export default function BottomNav({ activeTab, onTabChange }) {
  return (
    <nav className="bottom-nav" aria-label="手機主要導覽">
      {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
        <button key={key} className={activeTab === key ? "active" : ""} onClick={() => onTabChange(key)}>
          <Icon size={20} strokeWidth={2.2} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
