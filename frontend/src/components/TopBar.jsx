import { Settings } from "lucide-react";
import { AvatarPair } from "./Avatar.jsx";

// Compact header for phones and tablets. Desktop uses SideRail instead.
export default function TopBar({ members, onTabChange }) {
  return (
    <header className="top-bar">
      <button type="button" className="brand brand-compact" onClick={() => onTabChange("home")} aria-label="Sync-Us 首頁">
        <span className="brand-mark" aria-hidden="true"></span>
        <span className="brand-name">Sync-Us</span>
      </button>
      <div className="top-bar-actions">
        {members.length > 0 && (
          <button type="button" className="couple-chip" onClick={() => onTabChange("partner")} aria-label="查看我們的連結">
            <AvatarPair members={members} size="sm" />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => onTabChange("profile")} aria-label="我的設定">
          <Settings size={20} strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}
