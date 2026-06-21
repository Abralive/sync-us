import { Copy, HeartHandshake, Link2, Mail, QrCode, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { request } from "../api/client.js";

export default function CoupleConnect({ users, activeUser, couple, onConnected }) {
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

  async function connectPartner(event) {
    event.preventDefault();
    if (!selectedPartner) {
      setError("先選一個要一起生活的人，不然星域會很孤單。");
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
        <span className="garden-kicker">Partner Link</span>
        <h2>你想和誰連成共享星域？</h2>
        <p>先決定要把泡泡共享給誰。前台只讓你看見彼此的方向，後端會記錄這是共享世界還是私人軌道。</p>
      </div>

      {couple ? (
        <article className="connect-card linked">
          <div className="connect-orbit">
            <span>{activeUserData?.username?.slice(0, 1) || "你"}</span>
            <i></i>
            <span>{partnerName?.slice(0, 1) || "他"}</span>
          </div>
          <div>
            <h3>已和 {partnerName} 綁定</h3>
            <p>你們的共享泡泡會出現在同一個星域；私人泡泡仍留在自己的軌道裡。</p>
          </div>
        </article>
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
              選擇要共享給誰
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
                <p>下一版會產生可分享連結。現在先用「直接選擇」完成本機配對。</p>
              </div>
              <button type="button" className="icon-pill" disabled><Copy size={17} /></button>
            </div>
          )}

          {method === "code" && (
            <div className="connect-preview">
              <Sparkles size={20} />
              <div>
                <strong>配對碼</strong>
                <p>適合 App Store 版本：一方產生配對碼，另一方輸入後建立共享星域。</p>
              </div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <button className="btn primary connect-submit" disabled={loading || method !== "direct"}>
            {loading ? "連線中..." : "建立共享星域"}
          </button>
        </form>
      )}

      <div className="connect-notes">
        <article>
          <h3>共享世界</h3>
          <p>兩個人都看得到，適合約會、家務、旅行、出國前準備。</p>
        </article>
        <article>
          <h3>私人軌道</h3>
          <p>只記錄在自己的空間，不把所有壓力都攤在對方面前。</p>
        </article>
      </div>
    </section>
  );
}
