import { Heart, LogIn, Sparkles, UserPlus } from "lucide-react";
import { useState } from "react";
import { request } from "../api/client.js";

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const user = await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
        });
        onAuthenticated(user);
      } else {
        if (!username.trim()) throw new Error("請先替你的小星球取一個名字。");
        const created = await request("/users", {
          method: "POST",
          body: JSON.stringify({ username: username.trim(), email: email.trim() }),
        });
        onAuthenticated(created);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"></span>
          <div>
            <strong className="brand-name">Sync-Us</strong>
            <span className="brand-sub">一起照顧生活裡的泡泡</span>
          </div>
        </div>

        <div className="auth-hero">
          <Sparkles size={20} aria-hidden="true" />
          <h1>{mode === "login" ? "回到你們的星域" : "建立你的小星球"}</h1>
          <p>把要一起面對的事放進泡泡裡，看見彼此的壓力、承諾，還有完成後掉落的星塵。</p>
        </div>

        <div className="segmented segmented-wide" role="tablist" aria-label="登入或註冊">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>
            <LogIn size={17} />
            登入
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>
            <UserPlus size={17} />
            註冊
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label className="field">
              <span>名字</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Mina"
                autoComplete="nickname"
                maxLength={30}
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={loading} type="submit">
            <Heart size={18} />
            {loading ? "處理中..." : mode === "login" ? "進入星域" : "建立星球"}
          </button>
        </form>

        <p className="auth-hint">
          {mode === "login"
            ? "第一次使用？先切到「註冊」建立帳號，再請伴侶也註冊並建立連結。"
            : "已經有帳號了？切到「登入」輸入註冊時的 Email 就能回到星域。"}
        </p>
      </section>
    </main>
  );
}
