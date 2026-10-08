import {
  BookOpen,
  CalendarHeart,
  CheckCircle2,
  ChevronRight,
  Copy,
  Link2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../api/client.js";
import { daysSince, formatDateTime, shortDate } from "../utils/date.js";
import Avatar, { AvatarPair } from "./Avatar.jsx";
import Modal from "./Modal.jsx";

const CATEGORY_ORDER = [
  ["basic", "基本資訊"],
  ["health", "飲食與健康"],
  ["likes", "喜好"],
  ["care", "相處提醒"],
  ["planning", "規劃偏好"],
  ["memo", "其他備忘"],
];

function PairingPage({ activeUser, onConnected }) {
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const me = Number(activeUser);

  async function loadInvites() {
    try {
      const result = await request(`/couple-invites/user/${me}`);
      setInvites(result.sent_or_received || []);
    } catch {
      setInvites([]);
    }
  }

  useEffect(() => {
    loadInvites();
    const timer = window.setInterval(loadInvites, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  async function run(action) {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const sentInvites = invites.filter((invite) => invite.inviter_id === me && invite.status === "pending");
  const receivedInvites = invites.filter((invite) => invite.inviter_id !== me && invite.status === "pending");
  const visibleCode = inviteCode || sentInvites[0]?.invite_code || "";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(visibleCode);
      setStatus("邀請碼已複製，傳給對方吧。");
    } catch {
      setStatus("無法自動複製，請長按邀請碼手動複製。");
    }
  }

  return (
    <div className="partner-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">連結</span>
          <h1>先把兩個人放進同一個星域</h1>
          <p className="page-sub">完成連結後，才會打開共享星域、共同泡泡、共同足跡與對方的小手冊。</p>
        </div>
      </header>

      <div className="pair-grid">
        <section className="card pair-card">
          <span className="step-badge">方法一</span>
          <h2>產生邀請碼給對方</h2>
          <p>不用填對方 Email，把邀請碼傳給對方輸入就好，7 天內有效。</p>
          {visibleCode ? (
            <div className="invite-code">
              <span>你的邀請碼</span>
              <strong>{visibleCode}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}>
                <Copy size={16} />
                複製
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={() => run(async () => {
                const invite = await request("/couple-invites", {
                  method: "POST",
                  body: JSON.stringify({ inviter_id: me, invitee_email: "" }),
                });
                setInviteCode(invite.invite_code);
                setStatus("邀請碼已建立，請把它傳給對方。");
                await loadInvites();
              })}
            >
              <Link2 size={18} />
              產生邀請碼
            </button>
          )}
        </section>

        <form
          className="card pair-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!joinCode.trim()) {
              setError("請輸入對方給你的邀請碼。");
              return;
            }
            run(async () => {
              await request(`/couple-invites/${encodeURIComponent(joinCode.trim().toUpperCase())}/accept`, {
                method: "POST",
                body: JSON.stringify({ user_id: me }),
              });
              await onConnected();
            });
          }}
        >
          <span className="step-badge">方法二</span>
          <h2>輸入對方給你的邀請碼</h2>
          <p>對方已經建立邀請的話，貼上代碼就能正式成為一組。</p>
          <label className="field">
            <span>邀請碼</span>
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="SYNC-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="btn btn-primary" disabled={loading} type="submit">
            <ShieldCheck size={18} />
            接受連結
          </button>
        </form>
      </div>

      {receivedInvites.length > 0 && (
        <section className="card invite-list">
          <h2 className="card-title">收到的邀請</h2>
          {receivedInvites.map((invite) => (
            <article key={invite.id}>
              <div>
                <strong>{invite.inviter_name || "對方"} 想和你建立連結</strong>
                <span>{invite.invite_code}</span>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loading}
                  onClick={() => run(async () => {
                    await request(`/couple-invites/${invite.invite_code}/decline`, { method: "POST", body: JSON.stringify({ user_id: me }) });
                    await loadInvites();
                  })}
                >
                  拒絕
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={loading}
                  onClick={() => run(async () => {
                    await request(`/couple-invites/${invite.invite_code}/accept`, { method: "POST", body: JSON.stringify({ user_id: me }) });
                    await onConnected();
                  })}
                >
                  接受
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {sentInvites.length > 0 && (
        <section className="card invite-list is-muted">
          <h2 className="card-title">等待對方接受</h2>
          {sentInvites.map((invite) => (
            <article key={invite.id}>
              <div>
                <strong>{invite.invite_code}</strong>
                <span>{invite.invitee_email ? `已指定 ${invite.invitee_email}` : "對方輸入這組代碼後就會完成連結"}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loading}
                onClick={() => run(async () => {
                  await request(`/couple-invites/${invite.invite_code}/decline`, { method: "POST", body: JSON.stringify({ user_id: me }) });
                  setInviteCode("");
                  await loadInvites();
                })}
              >
                取消邀請
              </button>
            </article>
          ))}
        </section>
      )}

      <p className="privacy-note">
        <ShieldCheck size={16} />
        連結完成前不會共享任何泡泡、手冊或足跡；私人泡泡在連結後也只有你看得到。
      </p>

      {(error || status) && (
        <div className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{error || status}</div>
      )}
    </div>
  );
}

function ManualPanel({ partner, me, couple, activeUser, manualData, manualRequired, onSaved, onError }) {
  const [formCategory, setFormCategory] = useState(manualRequired ? "likes" : "");
  const [saving, setSaving] = useState(false);
  const entries = manualData.entries || [];
  const filled = CATEGORY_ORDER
    .map(([key, label]) => ({ key, label, entries: entries.filter((entry) => entry.category === key) }))
    .filter((group) => group.entries.length > 0);
  const missing = CATEGORY_ORDER.filter(([key]) => !entries.some((entry) => entry.category === key));

  useEffect(() => {
    if (manualRequired) setFormCategory((value) => value || "likes");
  }, [manualRequired]);

  async function saveEntry(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    try {
      await request(`/couples/${couple.id}/manual`, {
        method: "POST",
        body: JSON.stringify({
          user_id: Number(activeUser),
          subject_user_id: partner.id,
          category: formCategory,
          label: form.get("label"),
          value: form.get("value"),
          source_type: "manual",
          status: "confirmed",
        }),
      });
      formElement.reset();
      setFormCategory("");
      await onSaved("已寫進小手冊");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmEntry(entryId) {
    try {
      await request(`/manual/${entryId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser) }),
      });
      await onSaved("已確認這筆資料");
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <section className="manual-panel" aria-labelledby="manual-title">
      <div className="section-head">
        <div>
          <span className="kicker">About {partner?.username}</span>
          <h2 id="manual-title">{partner?.username} 的小手冊</h2>
        </div>
        {!formCategory && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFormCategory("likes")}>
            <Plus size={17} />
            新增資料
          </button>
        )}
      </div>

      {manualRequired && (
        <div className="callout">
          <Sparkles size={18} />
          <p>
            <strong>先替 {partner?.username} 寫下一件事</strong>
            寫完第一則小手冊，就會打開星域、泡泡和商城。可以從喜歡的飲料、過敏或相處提醒開始。
          </p>
        </div>
      )}

      {formCategory && (
        <form className="card manual-form" onSubmit={saveEntry}>
          <fieldset className="field">
            <legend>分類</legend>
            <div className="chip-row">
              {CATEGORY_ORDER.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${formCategory === key ? " active" : ""}`}
                  aria-pressed={formCategory === key}
                  onClick={() => setFormCategory(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="field-pair">
            <label className="field">
              <span>標籤</span>
              <input name="label" maxLength={40} placeholder="例如：喜歡的飲料" required />
            </label>
            <label className="field">
              <span>內容</span>
              <input name="value" maxLength={160} placeholder="例如：無糖綠茶、少冰" required />
            </label>
          </div>
          <div className="btn-row btn-row-end">
            {!manualRequired && (
              <button type="button" className="btn btn-ghost" onClick={() => setFormCategory("")}>
                取消
              </button>
            )}
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "寫入中..." : "寫入手冊"}
            </button>
          </div>
        </form>
      )}

      {filled.length > 0 ? (
        <div className="manual-grid">
          {filled.map((group) => (
            <section key={group.key} className="card manual-card">
              <h3>{group.label}</h3>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.id} className={entry.status === "pending" ? "is-pending" : ""}>
                    <strong>{entry.label}</strong>
                    <span>{entry.value}</span>
                    <small>
                      {entry.status_label}・{entry.created_by_name || "共同手冊"}・{shortDate(entry.updated_at)}
                    </small>
                    {entry.status === "pending" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirmEntry(entry.id)}>
                        <CheckCircle2 size={16} />
                        確認
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        !manualRequired && (
          <div className="empty-card">
            <ShieldCheck size={24} />
            <strong>還沒有手冊資料</strong>
            <p>記下過敏、喜歡的東西或相處提醒，之後可以直接問 Sync。</p>
          </div>
        )
      )}

      {missing.length > 0 && filled.length > 0 && (
        <div className="missing-row">
          <span>還沒寫：</span>
          {missing.map(([key, label]) => (
            <button key={key} type="button" className="chip chip-quiet" onClick={() => setFormCategory(key)}>
              <Plus size={14} />
              {label}
            </button>
          ))}
        </div>
      )}

      <p className="footnote">這本手冊只會在 {me?.username || "你"} 和 {partner?.username || "對方"} 的連結中顯示。</p>
    </section>
  );
}

function FootprintPanel({ footprints, onOpen }) {
  return (
    <section className="footprint-panel" aria-labelledby="footprint-title">
      <div className="section-head">
        <div>
          <span className="kicker">Our Journey</span>
          <h2 id="footprint-title">共同足跡</h2>
        </div>
        <span className="count-pill">{footprints.length} 則</span>
      </div>

      {footprints.length === 0 ? (
        <div className="empty-card">
          <Sparkles size={24} />
          <strong>還沒有共同足跡</strong>
          <p>完成第一顆共享泡泡後，這裡會自動留下紀錄。</p>
        </div>
      ) : (
        <ol className="footprint-grid">
          {footprints.map((item) => (
            <li key={item.id} className="card footprint-card">
              <span className="paper-tape" aria-hidden="true"></span>
              <div className="footprint-date">
                <strong>{shortDate(item.completed_at)}</strong>
                <span>完成泡泡</span>
              </div>
              <h3>{item.task_title}</h3>
              {item.photo_data_url && <img src={item.photo_data_url} alt={`${item.task_title} 的共同足跡`} loading="lazy" />}
              <p>{item.note || "沒有留下文字，保留完成這件事的紀錄。"}</p>
              <footer>
                <span className="avatar-pair">
                  {(item.participants || []).slice(0, 2).map((person, index) => (
                    <Avatar key={person.id} name={person.name} tone={index + 1} size="xs" />
                  ))}
                </span>
                <button type="button" className="link-btn" onClick={() => onOpen(item)}>
                  原泡泡
                  <ChevronRight size={16} />
                </button>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function CoupleConnect({
  me,
  partner,
  members,
  couple,
  activeUser,
  manualRequired,
  onRefresh,
  onConnected,
  showToast,
}) {
  const [activePanel, setActivePanel] = useState("manual");
  const [manualData, setManualData] = useState({ entries: [] });
  const [footprints, setFootprints] = useState([]);
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState(null);
  const [footprintDetail, setFootprintDetail] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [error, setError] = useState("");

  async function loadConnectionData() {
    if (!couple) return;
    setLoadState((state) => (state === "ready" ? state : "loading"));
    try {
      const [manual, timeline] = await Promise.all([
        request(`/couples/${couple.id}/manual?user_id=${activeUser}`),
        request(`/couples/${couple.id}/footprints?user_id=${activeUser}`),
      ]);
      setManualData(manual);
      setFootprints(timeline);
      setLoadState("ready");
      setError("");
    } catch (err) {
      setError(err.message);
      setLoadState("error");
    }
  }

  useEffect(() => {
    loadConnectionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couple?.id, activeUser]);

  if (!couple) {
    return <PairingPage activeUser={activeUser} onConnected={onConnected} />;
  }

  async function askSync(event) {
    event.preventDefault();
    if (!query.trim()) return;
    setQueryResult({ loading: true });
    try {
      const result = await request(`/couples/${couple.id}/manual/query`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser), query }),
      });
      setQueryResult(result);
    } catch (err) {
      setQueryResult({ answer: err.message, sources: [] });
    }
  }

  async function handleSaved(message) {
    await loadConnectionData();
    onRefresh?.();
    showToast?.(message);
  }

  const totalRecords = (manualData.entries?.length || 0) + footprints.length;

  return (
    <div className="partner-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">連結</span>
          <h1>一本會慢慢長大的共同手冊</h1>
          <p className="page-sub">一起走過 {daysSince(couple.created_at)} 天・累積 {totalRecords} 則</p>
        </div>
        <div className="page-actions">
          <AvatarPair members={members} size="lg" />
        </div>
      </header>

      <div className="partner-layout">
        <div className="partner-main">
          <form className="card ask-bar" onSubmit={askSync} role="search">
            <Search size={20} aria-hidden="true" />
            <label className="ask-field">
              <span>問問 Sync</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${partner?.username || "對方"} 對什麼過敏？`}
                enterKeyHint="search"
              />
            </label>
            <button type="submit" className="btn btn-primary btn-sm">查詢</button>
          </form>

          {queryResult && (
            <section className="card sync-answer" aria-live="polite">
              <strong>{queryResult.loading ? "查詢中..." : queryResult.answer}</strong>
              {!queryResult.loading && (
                <small>
                  {queryResult.sources?.length > 0
                    ? queryResult.sources.map((source) => `${source.label}（更新於 ${shortDate(source.updated_at)}）`).join("、")
                    : "只查詢已確認的手冊資料，沒有資料時不推測。"}
                </small>
              )}
            </section>
          )}

          <div className="segmented segmented-wide tab-switch" role="tablist" aria-label="連結分頁">
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "manual"}
              className={activePanel === "manual" ? "active" : ""}
              onClick={() => setActivePanel("manual")}
            >
              <BookOpen size={17} />
              對方的小手冊
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "timeline"}
              className={activePanel === "timeline" ? "active" : ""}
              onClick={() => setActivePanel("timeline")}
            >
              <CalendarHeart size={17} />
              共同足跡
            </button>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}
          {loadState === "loading" && <p className="quiet">正在翻開手冊...</p>}

          {activePanel === "manual" ? (
            <ManualPanel
              partner={partner}
              me={me}
              couple={couple}
              activeUser={activeUser}
              manualData={manualData}
              manualRequired={manualRequired}
              onSaved={handleSaved}
              onError={setError}
            />
          ) : (
            <FootprintPanel footprints={footprints} onOpen={setFootprintDetail} />
          )}
        </div>
      </div>

      {footprintDetail && (
        <Modal kicker={`原泡泡 #${footprintDetail.bubble_id}`} title={footprintDetail.task_title} onClose={() => setFootprintDetail(null)} size="sm">
          <p className="modal-lead">{footprintDetail.original_task?.description || "沒有補充描述。"}</p>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>完成</dt>
              <dd><strong>{formatDateTime(footprintDetail.completed_at)}</strong></dd>
            </div>
            <div className="detail-row">
              <dt>紀錄</dt>
              <dd><strong>{footprintDetail.created_by_name || "Sync"}</strong></dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  );
}
