import { NAV_ITEMS } from "../constants.js";

export default function BottomNav({ activeTab, onTabChange, lockedTabs, badges = {} }) {
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
          <span className="nav-icon">
            <Icon size={21} strokeWidth={2.1} />
            {badges[key] > 0 && <span className="nav-badge" aria-hidden="true"></span>}
          </span>
          <span>{label}</span>
          {badges[key] > 0 && <span className="sr-only">，有 {badges[key]} 個邀請等你回覆</span>}
        </button>
      ))}
    </nav>
  );
}
