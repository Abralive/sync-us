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
        if (!user) throw new Error("找不到這個 Email，先註冊一個小星球。");
        onAuthenticated(user.id);
      } else {
        if (!username.trim()) throw new Error("請幫這顆小星球取個名字。");
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
            <p className="brand-subtitle">Bubble Growth App</p>
          </div>
        </div>

        <div className="auth-hero">
          <Sparkles size={20} />
          <h2>{mode === "login" ? "回到你們的小宇宙" : "建立你的第一顆星球"}</h2>
          <p>先進入自己的軌道，再選擇要和誰連成共享星域。不是開會，是讓彼此的努力比較不會失蹤。</p>
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
              你的名字
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
          測試帳號：<strong>mina@sync-us.local</strong> 或 <strong>kai@sync-us.local</strong>
        </div>
      </section>
    </main>
  );
}
