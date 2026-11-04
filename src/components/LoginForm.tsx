"use client";
import { useState } from "react";
import { ArrowUpRight, Leaf, LoaderCircle } from "lucide-react";
export default function LoginForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-emblem">
          <Leaf size={26} />
        </span>
        <span className="eyebrow">FLOORPLAN STUDIO</span>
        <h1>欢迎回到筑间</h1>
        <p>登录你的私人空间，继续设计理想的家。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget);
            try {
              const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  username: data.get("username"),
                  password: data.get("password"),
                }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error ?? "登录失败");
              window.location.assign("/");
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败，请重试。");
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>账号</span>
            <input
              name="username"
              autoComplete="username"
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={1000}
              required
            />
          </label>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full large" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <>
                登录
                <ArrowUpRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="login-footer">你的户型与设计，仅由你掌握。</div>
      </section>
    </main>
  );
}
