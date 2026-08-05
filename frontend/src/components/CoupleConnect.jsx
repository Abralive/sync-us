import { Copy, HeartHandshake, Link2, Mail, QrCode, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { request } from "../api/client.js";
import CompletedPage from "./CompletedPage.jsx";

export default function CoupleConnect({
  users,
  activeUser,
  couple,
  stats,
  completed = [],
  stardust = 0,
  onRefresh,
  onConnected,
}) {
  const [selectedPartner, setSelectedPartner] = useState("");
  const [method, setMethod] = useState("direct");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeUserData = useMemo(
    () => users.find((user) => user.id === Number(activeUser)),
    [users, activeUser]
  );

  const partnerOptions = users.filter((user) => user.id !== Number(activeUser));
  const partnerName = couple
    ? couple.partner_a_id === Number(activeUser)
      ? couple.partner_b_name
      : couple.partner_a_name
    : "";

  const daysTogether = couple
    ? Math.max(1, Math.floor((Date.now() - new Date(couple.created_at).getTime()) / 86400000) + 1)
    : 0;
  const total = stats?.total || 0;
  const completedCount = stats?.completed || 0;
  const pendingConfirm = stats?.pending_confirm || 0;

  async function connectPartner(event) {
    event.preventDefault();
    if (!selectedPartner) {
      setError("先選一個人，才能建立共享星域。");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const created = await request("/couples", {
        method: "POST",
        body: JSON.stringify({
          partner_a_id: Number(activeUser),
          partner_b_id: Number(selectedPartner),
        }),
      });
      await onConnected(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="connect-page">
      <div className="connect-hero">
        <span className="garden-kicker">連結</span>
        <h2>把兩個人的生活接起來</h2>
        <p>不用每件事都攤開，但重要的事要有人看見。</p>
      </div>

      {couple ? (
        <>
          <article className="connect-card linked">
            <div className="connect-orbit">
              <span>{activeUserData?.username?.slice(0, 1) || "你"}</span>
              <i></i>
              <span>{partnerName?.slice(0, 1) || "他"}</span>
            </div>
            <div>
              <h3>你和 {partnerName} 已連線</h3>
              <p>共享泡泡放一起，私人泡泡留在自己的小軌道。</p>
            </div>
          </article>

          <div className="relationship-board quiet">
            <div className="relationship-headline">
              <span className="garden-kicker">足跡</span>
              <h3>最近一起接住的事</h3>
            </div>

            <div className="relationship-grid compact">
              <div className="relationship-stat">
                <strong>{daysTogether}</strong>
                <span>連線天數</span>
              </div>
              <div className="relationship-stat">
                <strong>{total}</strong>
                <span>照顧中的事</span>
              </div>
              <div className="relationship-stat">
                <strong>{completedCount}</strong>
                <span>已完成</span>
              </div>
              <div className="relationship-stat">
                <strong>{pendingConfirm}</strong>
                <span>待確認</span>
              </div>
            </div>
          </div>

          <CompletedPage
            completed={completed}
            activeUser={activeUser}
            stardust={stardust}
            stats={stats}
            onRefresh={onRefresh}
            embedded
          />
        </>
      ) : (
        <form className="connect-card" onSubmit={connectPartner}>
          <div className="connect-methods" role="tablist" aria-label="連結方式">
            <button type="button" className={method === "direct" ? "active" : ""} onClick={() => setMethod("direct")}>
              <HeartHandshake size={18} />
              直接選擇
            </button>
            <button type="button" className={method === "link" ? "active" : ""} onClick={() => setMethod("link")}>
              <Link2 size={18} />
              邀請連結
            </button>
            <button type="button" className={method === "code" ? "active" : ""} onClick={() => setMethod("code")}>
              <QrCode size={18} />
              配對碼
            </button>
          </div>

          {method === "direct" && (
            <label className="connect-field">
              選擇對象
              <select value={selectedPartner} onChange={(event) => setSelectedPartner(event.target.value)}>
                <option value="">選一個人</option>
                {partnerOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.username} · {user.email}</option>
                ))}
              </select>
            </label>
          )}

          {method === "link" && (
            <div className="connect-preview">
              <Mail size={20} />
              <div>
                <strong>邀請連結</strong>
                <p>下一版會支援直接分享連結。現在先用本機帳號配對。</p>
              </div>
              <button type="button" className="icon-pill" disabled><Copy size={17} /></button>
            </div>
          )}

          {method === "code" && (
            <div className="connect-preview">
              <Sparkles size={20} />
              <div>
                <strong>配對碼</strong>
                <p>適合手機正式版，一方產生配對碼，另一方輸入後連線。</p>
              </div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <button className="btn primary connect-submit" disabled={loading || method !== "direct"}>
            {loading ? "連線中..." : "建立共享星域"}
          </button>
        </form>
      )}
    </section>
  );
}
