import { ChevronRight, Gift, HeartHandshake, LogOut, Mail, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../api/client.js";
import { daysSince } from "../utils/date.js";
import { isSoundEnabled, playPop, setSoundEnabled } from "../utils/sound.js";
import Avatar from "./Avatar.jsx";

export default function ProfilePage({
  me,
  meMember,
  partner,
  couple,
  tasks,
  completedSummary,
  stardust,
  reviewMode,
  onSwitchUser,
  onGoPartner,
  onOpenShop,
  onLogout,
}) {
  const [allUsers, setAllUsers] = useState([]);
  const [sound, setSound] = useState(() => isSoundEnabled());
  const myId = me?.id;

  useEffect(() => {
    if (!reviewMode) return;
    request("/users").then(setAllUsers).catch(() => setAllUsers([]));
  }, [reviewMode]);

  const carrying = tasks.filter((task) => task.is_private || task.assigned_to_id === myId).length;
  const doneByMe = Number(completedSummary?.by_user?.[String(myId)] || 0);

  function toggleSound(enabled) {
    setSoundEnabled(enabled);
    setSound(enabled);
    if (enabled) playPop();
  }

  return (
    <div className="profile-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">我的</span>
          <h1>我的同步狀態</h1>
        </div>
      </header>

      <div className="profile-grid">
        <section className="card profile-card">
          <Avatar name={me?.username} tone={meMember?.tone || 1} size="xl" />
          <div>
            <h2>{me?.username}</h2>
            <p>
              <Mail size={15} aria-hidden="true" />
              {me?.email}
            </p>
          </div>
        </section>

        <section className="card profile-card">
          {partner ? (
            <>
              <Avatar name={partner.username} tone={partner.tone} size="xl" />
              <div>
                <h2>{partner.username}</h2>
                <p>
                  <HeartHandshake size={15} aria-hidden="true" />
                  一起第 {daysSince(couple?.created_at)} 天
                </p>
              </div>
            </>
          ) : (
            <div className="profile-empty">
              <h2>還沒有連結伴侶</h2>
              <p>產生邀請碼或輸入對方的代碼，就能開始共享星域。</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={onGoPartner}>
                去連結
              </button>
            </div>
          )}
        </section>

        <section className="card stat-card" aria-label="我的統計">
          <div>
            <strong>{tasks.length}</strong>
            <span>進行中的泡泡</span>
          </div>
          <div>
            <strong>{carrying}</strong>
            <span>交給我的</span>
          </div>
          <div>
            <strong>{doneByMe}</strong>
            <span>我完成的</span>
          </div>
          <div>
            <strong>{stardust}</strong>
            <span>可用星塵</span>
          </div>
        </section>

        {onOpenShop && (
          <button type="button" className="card shop-link" onClick={onOpenShop}>
            <span className="shop-icon" aria-hidden="true"><Gift size={20} /></span>
            <span>
              <strong>星塵商城</strong>
              <small>用一起完成泡泡累積的星塵，兌換小獎勵。</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <section className="card settings-card" aria-labelledby="settings-title">
        <h2 id="settings-title" className="card-title">偏好設定</h2>
        <label className="switch-field">
          <input type="checkbox" checked={sound} onChange={(event) => toggleSound(event.target.checked)} />
          <span className="switch" aria-hidden="true"></span>
          <span>
            <strong><Volume2 size={14} /> 戳破音效與震動</strong>
            <small>在教室、圖書館或深夜，可以先關掉。只影響這台裝置。</small>
          </span>
        </label>
      </section>

      {reviewMode && allUsers.length > 0 && (
        <section className="card review-card">
          <h2 className="card-title">本機檢視模式：切換使用者</h2>
          <p className="quiet">只在 localhost 加上 ?review=1 時出現，正式網域不會顯示。</p>
          <div className="chip-row">
            {allUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`chip${user.id === myId ? " active" : ""}`}
                onClick={() => onSwitchUser(user.id)}
              >
                {user.username}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="profile-actions">
        <button type="button" className="btn btn-ghost" onClick={onLogout}>
          <LogOut size={17} />
          登出
        </button>
      </div>
    </div>
  );
}
