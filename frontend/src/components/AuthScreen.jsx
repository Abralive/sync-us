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
        if (!user) throw new Error("找不到這個 Email，請先註冊。");
        onAuthenticated(user.id);
      } else {
        if (!username.trim()) throw new Error("請輸入使用者名稱。");
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
            <p className="brand-subtitle">Shared Orbit Planner</p>
          </div>
        </div>

        <div className="auth-hero">
          <Sparkles size={20} />
          <h2>{mode === "login" ? "登入共享軌道" : "建立你的帳號"}</h2>
          <p>先用簡化帳號流程試用。正式上架前，這裡會接上密碼、驗證信與安全登入。</p>
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
              使用者名稱
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
            {loading ? "處理中..." : mode === "login" ? "登入" : "建立帳號"}
          </button>
        </form>

        <div className="auth-hint">
          測試帳號：<strong>mina@sync-us.local</strong> 或 <strong>kai@sync-us.local</strong>
        </div>
      </section>
    </main>
  );
}
