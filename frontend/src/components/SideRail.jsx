import { Lock, LogOut } from "lucide-react";
import { NAV_ITEMS } from "../constants.js";
import { daysSince } from "../utils/date.js";
import { AvatarPair } from "./Avatar.jsx";

// Desktop navigation (≥1024px). Phones and tablets use TopBar + BottomNav.
export default function SideRail({ activeTab, onTabChange, members, couple, lockedTabs, onLogout }) {
  return (
    <aside className="side-rail" aria-label="側邊導覽">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"></span>
        <div>
          <strong className="brand-name">Sync-Us</strong>
          <span className="brand-sub">兩個人的泡泡星域</span>
        </div>
      </div>

      <nav className="rail-nav" aria-label="主要導覽">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "active" : ""}
            aria-current={activeTab === key ? "page" : undefined}
            onClick={() => onTabChange(key)}
          >
            <Icon size={19} strokeWidth={2.1} />
            <span>{label}</span>
            {lockedTabs.has(key) && <Lock size={14} className="rail-lock" aria-label="尚未開放" />}
          </button>
        ))}
      </nav>

      <div className="rail-foot">
        {couple ? (
          <div className="rail-couple">
            <AvatarPair members={members} size="md" />
            <div>
              <strong>{members.map((member) => member.username).join(" & ")}</strong>
              <span>一起第 {daysSince(couple.created_at)} 天</span>
            </div>
          </div>
        ) : (
          <p className="rail-hint">還沒有連結伴侶</p>
        )}
        <button type="button" className="btn btn-ghost btn-sm rail-logout" onClick={onLogout}>
          <LogOut size={16} />
          登出
        </button>
      </div>
    </aside>
  );
}
