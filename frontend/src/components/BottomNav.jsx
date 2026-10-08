import { NAV_ITEMS } from "../constants.js";

export default function BottomNav({ activeTab, onTabChange, lockedTabs }) {
  return (
    <nav className="bottom-nav" aria-label="主要導覽">
      {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={`${activeTab === key ? "active" : ""}${lockedTabs.has(key) ? " is-locked" : ""}`}
          aria-current={activeTab === key ? "page" : undefined}
          onClick={() => onTabChange(key)}
        >
          <Icon size={21} strokeWidth={2.1} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
