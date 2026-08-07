import { Copy, Eye, HandHeart, HeartHandshake, Link2, Mail, MessageCircleHeart, QrCode, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { request } from "../api/client.js";

function initial(name) {
  return name?.trim()?.slice(0, 1) || "?";
}

function shortDate(value) {
  if (!value) return "今天";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "今天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function CoupleConnect({
  users,
  activeUser,
  couple,
  completed = [],
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

  const fragments = completed.slice(0, 3);

  async function connectPartner(event) {
    event.preventDefault();
    if (!selectedPartner) {
      setError("請先選擇一位想連結的使用者。");
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

  if (!couple) {
    return (
      <section className="connect-page connection-journal">
        <div className="connection-page-title">
          <span>我們的連結</span>
          <h2>先把彼此放進同一個星域</h2>
        </div>

        <form className="connect-card connection-invite-card" onSubmit={connectPartner}>
          <div className="connect-methods" role="tablist" aria-label="連結方式">
            <button type="button" className={method === "direct" ? "active" : ""} onClick={() => setMethod("direct")}>
              <HeartHandshake size={18} />
              本機帳號
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
              選擇伴侶
              <select value={selectedPartner} onChange={(event) => setSelectedPartner(event.target.value)}>
                <option value="">選一位使用者</option>
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
                <p>之後可以直接分享連結。現在先用本機帳號完成配對。</p>
              </div>
              <button type="button" className="icon-pill" disabled><Copy size={17} /></button>
            </div>
          )}

          {method === "code" && (
            <div className="connect-preview">
              <Sparkles size={20} />
              <div>
                <strong>配對碼</strong>
                <p>適合面對面輸入短碼，避免連錯人。</p>
              </div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <button className="btn primary connect-submit" disabled={loading || method !== "direct"}>
            {loading ? "連結中..." : "建立共享星域"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="connect-page connection-journal">
      <div className="connection-page-title">
        <span>我們的連結</span>
        <h2>今天也有好好看見彼此</h2>
      </div>

      <article className="connection-paper today">
        <span className="paper-tape tape-top"></span>
        <h3>今天的我們</h3>
        <div className="connection-mood-line">
          <div className="journal-person">
            <span className="journal-avatar avatar-1">{initial(activeUserData?.username)}</span>
            <strong>{activeUserData?.username || "我"}</strong>
            <em>7/10</em>
          </div>
          <i className="heart-line" aria-hidden="true"></i>
          <div className="journal-person">
            <span className="journal-avatar avatar-2">{initial(partnerName)}</span>
            <strong>{partnerName || "伴侶"}</strong>
            <em>6/10</em>
          </div>
        </div>
      </article>

      <article className="connection-paper message">
        <span className="paper-tape tape-middle"></span>
        <h3>今天想留給你</h3>
        <p>謝謝你昨天幫我處理那麼多事。今晚散步後一起看電影吧 :)</p>
        <div className="response-row" aria-label="情感回應">
          <button type="button">
            <Eye size={24} />
            我看見你
          </button>
          <button type="button">
            <HandHeart size={24} />
            抱一下
          </button>
          <button type="button">
            <MessageCircleHeart size={24} />
            今晚聊聊
          </button>
        </div>
      </article>

      <section className="memory-strip-section">
        <h3>最近一起留下的片段</h3>
        <div className="memory-strips">
          {(fragments.length ? fragments : [
            { id: "fallback-1", title: "一起完成旅行清單", completed_at: new Date() },
            { id: "fallback-2", title: "新增共同目標", completed_at: new Date(Date.now() - 86400000 * 2) },
            { id: "fallback-3", title: "留了一句晚安", completed_at: new Date(Date.now() - 86400000 * 5) },
          ]).map((item, index) => (
            <article className={`memory-strip strip-${index + 1}`} key={item.id || item.title}>
              <span>{shortDate(item.completed_at || item.created_at || item.due_time)}</span>
              <strong>{item.title}</strong>
            </article>
          ))}
        </div>
      </section>

      <article className="weekly-promise-paper">
        <span>這週的小約定</span>
        <strong>星期五一起散步 20 分鐘</strong>
      </article>
    </section>
  );
}
