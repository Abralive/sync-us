import {
  BookOpen,
  CalendarHeart,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Link2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { request } from "../api/client.js";
import { formatDateTime } from "../utils/date.js";

const CATEGORY_ORDER = [
  ["basic", "基本資訊"],
  ["health", "飲食與健康"],
  ["likes", "喜好"],
  ["care", "相處提醒"],
  ["planning", "規劃偏好"],
  ["memo", "其他備忘"],
];

function initial(name) {
  return name?.trim()?.slice(0, 1) || "?";
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function daysTogether(couple) {
  const start = new Date(couple?.created_at || Date.now());
  const diff = Date.now() - start.getTime();
  return Math.max(1, Math.floor(diff / 86400000) + 1);
}

export default function CoupleConnect({
  users,
  activeUser,
  couple,
  completed = [],
  onConnected,
}) {
  const [selectedPartner, setSelectedPartner] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activePanel, setActivePanel] = useState("manual");
  const [manualData, setManualData] = useState({ entries: [], categories: {} });
  const [footprints, setFootprints] = useState([]);
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState(null);
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [footprintDetail, setFootprintDetail] = useState(null);
  const [loadState, setLoadState] = useState("idle");

  const activeUserData = useMemo(
    () => users.find((user) => user.id === Number(activeUser)),
    [users, activeUser]
  );
  const partnerOptions = users.filter((user) => user.id !== Number(activeUser));
  const partner = useMemo(() => {
    if (!couple) return null;
    const partnerId = couple.partner_a_id === Number(activeUser) ? couple.partner_b_id : couple.partner_a_id;
    const partnerName = couple.partner_a_id === Number(activeUser) ? couple.partner_b_name : couple.partner_a_name;
    return users.find((user) => user.id === partnerId) || { id: partnerId, username: partnerName };
  }, [couple, users, activeUser]);

  const totalManual = manualData.entries?.length || 0;
  const totalRecords = totalManual + footprints.length;

  useEffect(() => {
    if (!couple) return;
    loadConnectionData();
  }, [couple?.id, activeUser]);

  async function loadConnectionData() {
    setLoadState("loading");
    setError("");
    try {
      const [manual, timeline] = await Promise.all([
        request(`/couples/${couple.id}/manual?user_id=${activeUser}`),
        request(`/couples/${couple.id}/footprints?user_id=${activeUser}`),
      ]);
      setManualData(manual);
      setFootprints(timeline);
      setLoadState("ready");
    } catch (err) {
      setError(err.message);
      setLoadState("error");
    }
  }

  async function connectPartner(event) {
    event.preventDefault();
    if (!selectedPartner) {
      setError("請選擇要連結的使用者。");
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

  async function askSync(event) {
    event.preventDefault();
    if (!query.trim()) return;
    setQueryResult({ loading: true });
    try {
      const result = await request(`/couples/${couple.id}/manual/query`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser, query }),
      });
      setQueryResult(result);
    } catch (err) {
      setQueryResult({ answer: err.message, sources: [] });
    }
  }

  async function saveManualEntry(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/couples/${couple.id}/manual`, {
        method: "POST",
        body: JSON.stringify({
          user_id: activeUser,
          subject_user_id: Number(form.get("subject_user_id")),
          category: form.get("category"),
          label: form.get("label"),
          value: form.get("value"),
          source_type: "manual",
          status: "confirmed",
        }),
      });
      event.currentTarget.reset();
      setManualFormOpen(false);
      await loadConnectionData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmEntry(entryId) {
    try {
      await request(`/manual/${entryId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ user_id: activeUser }),
      });
      await loadConnectionData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!couple) {
    return (
      <section className="manual-page no-pair">
        <div className="manual-topline">
          <span className="sync-logo-mini" aria-hidden="true"></span>
          <strong>Sync-Us</strong>
        </div>
        <div className="manual-page-title">
          <span>連結</span>
          <h2>先選一個想一起照顧生活的人</h2>
          <p>連結後，共享泡泡與共同足跡會放在同一本手冊裡。</p>
        </div>
        <form className="pair-invite-panel" onSubmit={connectPartner}>
          <label>
            想跟誰綁定？
            <select value={selectedPartner} onChange={(event) => setSelectedPartner(event.target.value)}>
              <option value="">選擇使用者</option>
              {partnerOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.username} · {user.email}</option>
              ))}
            </select>
          </label>
          {error && <div className="manual-error">{error}</div>}
          <button className="btn primary" disabled={loading}>
            <Link2 size={18} />
            {loading ? "連結中..." : "建立連結"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="manual-page" aria-label="共同手冊">
      <div className="manual-topline">
        <span className="sync-logo-mini" aria-hidden="true"></span>
        <strong>Sync-Us</strong>
        <span className="manual-avatar">{initial(activeUserData?.username)}</span>
        <span className="manual-avatar partner">{initial(partner?.username)}</span>
      </div>

      <header className="manual-page-title">
        <span>連結</span>
        <h2>一本會慢慢長大的共同手冊</h2>
        <p>一起走過 {daysTogether(couple)} 天・累積 {totalRecords} 則</p>
      </header>

      <form className="ask-sync-bar" onSubmit={askSync}>
        <Search size={22} />
        <label>
          問問 Sync
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="對方對什麼過敏？"
          />
        </label>
        <button type="submit">
          <CircleHelp size={19} />
          查詢
        </button>
      </form>

      {queryResult && (
        <section className="sync-answer" aria-live="polite">
          <strong>{queryResult.loading ? "查詢中..." : queryResult.answer}</strong>
          {!queryResult.loading && (
            <div>
              {queryResult.sources?.length > 0 ? (
                queryResult.sources.map((source) => (
                  <span key={`${source.label}-${source.updated_at}`}>
                    來源：{source.source} · {source.label} · 更新於 {shortDate(source.updated_at)}
                  </span>
                ))
              ) : (
                <span>只查詢已確認資料；沒有資料時不推測。</span>
              )}
            </div>
          )}
        </section>
      )}

      <nav className="manual-tabs" aria-label="連結分頁">
        <button type="button" className={activePanel === "manual" ? "active" : ""} onClick={() => setActivePanel("manual")}>
          <BookOpen size={18} />
          對方的小手冊
        </button>
        <button type="button" className={activePanel === "timeline" ? "active" : ""} onClick={() => setActivePanel("timeline")}>
          <CalendarHeart size={18} />
          共同足跡
        </button>
      </nav>

      {error && <div className="manual-error">{error}</div>}
      {loadState === "loading" && <p className="manual-muted">正在翻開手冊...</p>}

      {activePanel === "manual" ? (
        <ManualPanel
          partner={partner}
          activeUserData={activeUserData}
          manualData={manualData}
          manualFormOpen={manualFormOpen}
          setManualFormOpen={setManualFormOpen}
          saveManualEntry={saveManualEntry}
          confirmEntry={confirmEntry}
        />
      ) : (
        <FootprintPanel
          footprints={footprints}
          completed={completed}
          onOpenOriginal={setFootprintDetail}
        />
      )}

      {footprintDetail && (
        <div className="detail-sheet" role="dialog" aria-modal="true">
          <button className="sheet-backdrop" type="button" onClick={() => setFootprintDetail(null)} aria-label="關閉"></button>
          <section className="sheet-panel original-bubble-panel">
            <button className="sheet-close" type="button" onClick={() => setFootprintDetail(null)} aria-label="關閉">×</button>
            <span className="manual-eyebrow">原泡泡 #{footprintDetail.bubble_id}</span>
            <h3>{footprintDetail.task_title}</h3>
            <p>{footprintDetail.original_task?.description || "沒有補充描述。"}</p>
            <div className="sheet-meta">
              <span>完成於 {formatDateTime(footprintDetail.completed_at)}</span>
              <span>建立者 {footprintDetail.created_by_name || "Sync"}</span>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function ManualPanel({
  partner,
  activeUserData,
  manualData,
  manualFormOpen,
  setManualFormOpen,
  saveManualEntry,
  confirmEntry,
}) {
  const grouped = CATEGORY_ORDER.map(([key, label]) => ({
    key,
    label,
    entries: (manualData.entries || []).filter((entry) => entry.category === key),
  }));

  return (
    <section className="manual-panel">
      <div className="manual-section-head">
        <div>
          <span className="manual-eyebrow">About {partner?.username || "Partner"}</span>
          <h3>對方的小手冊</h3>
        </div>
        <button type="button" onClick={() => setManualFormOpen((value) => !value)}>
          <Plus size={18} />
          新增資料
        </button>
      </div>

      {manualFormOpen && (
        <form className="manual-entry-form" onSubmit={saveManualEntry}>
          <input type="hidden" name="subject_user_id" value={partner?.id || ""} />
          <label>
            分類
            <select name="category" defaultValue="health">
              {CATEGORY_ORDER.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            標籤
            <input name="label" maxLength={40} placeholder="例如：過敏" required />
          </label>
          <label>
            內容
            <input name="value" maxLength={160} placeholder="例如：對花生過敏" required />
          </label>
          <button className="btn primary" type="submit">寫入手冊</button>
        </form>
      )}

      {manualData.entries?.length === 0 && (
        <div className="manual-empty">
          <ShieldCheck size={25} />
          <strong>還沒有確認過的手冊資料</strong>
          <p>先記一件重要資訊，例如過敏、提醒時間或喜歡的照顧方式。</p>
        </div>
      )}

      <div className="manual-category-list">
        {grouped.map((group) => (
          <section className="manual-category" key={group.key}>
            <h4>{group.label}</h4>
            {group.entries.length === 0 ? (
              <p className="manual-muted">暫無紀錄</p>
            ) : (
              group.entries.map((entry) => (
                <article className={entry.status === "pending" ? "pending" : ""} key={entry.id}>
                  <div>
                    <strong>{entry.label}</strong>
                    <span>{entry.value}</span>
                  </div>
                  <footer>
                    <small>來源：{entry.source_label} · {entry.status_label} · {shortDate(entry.updated_at)}</small>
                    {entry.status === "pending" && (
                      <button type="button" onClick={() => confirmEntry(entry.id)}>
                        <CheckCircle2 size={16} />
                        確認
                      </button>
                    )}
                  </footer>
                </article>
              ))
            )}
          </section>
        ))}
      </div>
      <p className="manual-footnote">敏感資料只會在 {activeUserData?.username || "你"} 和 {partner?.username || "對方"} 的連結中顯示。</p>
    </section>
  );
}

function FootprintPanel({ footprints, completed, onOpenOriginal }) {
  const timeline = footprints.length > 0 ? footprints : [];

  return (
    <section className="footprint-panel">
      <div className="manual-section-head">
        <div>
          <span className="manual-eyebrow">Our Journey</span>
          <h3>共同足跡</h3>
        </div>
        <span className="footprint-count">{timeline.length} 則</span>
      </div>

      {timeline.length === 0 && (
        <div className="manual-empty">
          <Sparkles size={25} />
          <strong>還沒有共同足跡</strong>
          <p>完成第一顆共享泡泡後，這裡會自動留下紀錄。</p>
          {completed.length > 0 && <small>目前完成紀錄會從新流程開始累積。</small>}
        </div>
      )}

      <div className="footprint-timeline">
        {timeline.map((item) => (
          <article className="footprint-item" key={item.id}>
            <div className="footprint-date">
              <strong>{shortDate(item.completed_at)}</strong>
              <span>完成泡泡</span>
            </div>
            <div className="footprint-pin" aria-hidden="true">✦</div>
            <section className="footprint-paper">
              <span className="paper-tape tape-top"></span>
              <h4>{item.task_title}</h4>
              {item.photo_data_url && <img src={item.photo_data_url} alt={`${item.task_title} 的共同足跡`} />}
              <p>{item.note || "沒有新增照片或文字，保留完成這件事的基本紀錄。"}</p>
              <div className="footprint-people">
                {(item.participants || []).slice(0, 2).map((person) => (
                  <span key={person.id}>{initial(person.name)}</span>
                ))}
              </div>
              <footer>
                <small>建立者 {item.created_by_name || "Sync"} · 更新於 {shortDate(item.updated_at)}</small>
                <button type="button" onClick={() => onOpenOriginal(item)}>
                  查看原泡泡
                  <ChevronRight size={16} />
                </button>
              </footer>
            </section>
          </article>
        ))}
      </div>
      <p className="manual-growth-note">持續累積，我們的手冊會越來越完整。</p>
    </section>
  );
}
