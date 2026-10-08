import { Gift, Sparkles, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../api/client.js";
import { formatDateTime } from "../utils/date.js";

export default function ShopPage({ couple, activeUser, onChanged, showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function load() {
    try {
      setData(await request(`/couples/${couple.id}/rewards?user_id=${activeUser}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couple.id, activeUser]);

  async function redeem(item) {
    setBusyKey(item.key);
    try {
      const next = await request(`/couples/${couple.id}/rewards`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser), item_key: item.key }),
      });
      setData(next);
      setConfirmKey("");
      showToast?.(`已兌換「${item.title}」，記得跟對方說喔！`);
      onChanged?.();
    } catch (err) {
      showToast?.(err.message, "error");
    } finally {
      setBusyKey("");
    }
  }

  const balance = data?.balance ?? 0;

  return (
    <div className="shop-page">
      <header className="page-head">
        <div className="page-title">
          <span className="kicker">商城</span>
          <h1>星塵補給站</h1>
          <p className="page-sub">把一起完成的事，換成真的會想兌換的小獎勵。</p>
        </div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="card balance-card" aria-label="星塵餘額">
        <Sparkles size={22} aria-hidden="true" />
        <div>
          <span>可以使用的星塵</span>
          <strong>{data ? balance : "—"}</strong>
        </div>
        {data && (
          <p>
            累積賺到 {data.earned}・已兌換 {data.spent}
          </p>
        )}
      </section>

      <div className="shop-grid">
        {(data?.items || []).map((item) => {
          const affordable = balance >= item.cost;
          const confirming = confirmKey === item.key;
          return (
            <article key={item.key} className={`card shop-item${affordable ? " is-ready" : ""}`}>
              <span className="shop-icon" aria-hidden="true"><Gift size={22} /></span>
              <span className="shop-price">{item.cost} 星塵</span>
              <h2>{item.title}</h2>
              <p>{item.copy}</p>
              {confirming ? (
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmKey("")} disabled={busyKey === item.key}>
                    取消
                  </button>
                  <button type="button" className="btn btn-coral btn-sm" onClick={() => redeem(item)} disabled={busyKey === item.key}>
                    {busyKey === item.key ? "兌換中..." : `確定用 ${item.cost} 星塵兌換`}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`btn ${affordable ? "btn-primary" : "btn-ghost"}`}
                  disabled={!affordable}
                  onClick={() => setConfirmKey(item.key)}
                >
                  {affordable ? "兌換" : `還差 ${item.cost - balance} 星塵`}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <section className="card redeem-history" aria-labelledby="history-title">
        <h2 id="history-title" className="card-title">
          <Ticket size={18} />
          兌換紀錄
        </h2>
        {data?.redemptions?.length ? (
          <ul>
            {data.redemptions.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.item_title}</strong>
                <span>{entry.user_name} 兌換・{formatDateTime(entry.created_at)}</span>
                <b>-{entry.cost}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">還沒有兌換過。完成共享泡泡就能累積星塵。</p>
        )}
      </section>
    </div>
  );
}
