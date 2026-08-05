import { Heart, LogIn, Sparkles, UserPlus } from "lucide-react";
import { useState } from "react";
import { request } from "../api/client.js";

export default function AuthScreen({ users, onAuthenticated, onUsersChanged }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("mina@sync-us.local");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const user = users.find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
        if (!user) throw new Error("找不到這個 Email，請先註冊或換一個帳號。");
        onAuthenticated(user.id);
      } else {
        if (!username.trim()) throw new Error("請先替你的小星球取一個名字。");
        const created = await request("/users", {
          method: "POST",
          body: JSON.stringify({ username: username.trim(), email: email.trim() }),
        });
        await onUsersChanged();
        onAuthenticated(created.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"></div>
          <div>
            <h1 className="brand-title">Sync-Us</h1>
            <p className="brand-subtitle">一起照顧生活裡的泡泡</p>
          </div>
        </div>

        <div className="auth-hero">
          <Sparkles size={20} />
          <h2>{mode === "login" ? "回到你們的星域" : "建立你的小星球"}</h2>
          <p>把要一起面對的事放進泡泡裡，看見彼此的壓力、承諾與完成後掉落的星塵。</p>
        </div>

        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            <LogIn size={17} />
            登入
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            <UserPlus size={17} />
            註冊
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label>
              名字
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Mina" />
            </label>
          )}
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="mina@sync-us.local" required />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn primary auth-submit" disabled={loading}>
            <Heart size={18} />
            {loading ? "處理中..." : mode === "login" ? "進入星域" : "建立星球"}
          </button>
        </form>

        <div className="auth-hint">
          測試帳號可用 <strong>mina@sync-us.local</strong> 或 <strong>kai@sync-us.local</strong>
        </div>
      </section>
    </main>
  );
}
