"use client";
import { useState } from "react";
import { Leaf, LoaderCircle } from "lucide-react";
export default function AccountForm({
  username,
  email,
}: {
  username: string;
  email: string | null;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-emblem">
          <Leaf size={26} />
        </span>
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>账号与安全</h1>
        <p>账号：{username}</p>
        {email ? (
          <>
            <p>已验证邮箱：{email}</p>
            <a href="/forgot-password">通过邮箱重置密码</a>
          </>
        ) : (
          <>
            <p>原账号尚未绑定邮箱。绑定后可使用邮箱找回密码。</p>
            {message ? (
              <div role="status" className="auth-success">
                {message}
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  const data = new FormData(e.currentTarget);
                  try {
                    const session = await fetch("/api/auth/session");
                    if (!session.ok)
                      throw new Error("登录已过期，请重新登录。");
                    const { csrf } = await session.json();
                    const response = await fetch("/api/auth/email", {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "x-floorplan-csrf": csrf,
                      },
                      body: JSON.stringify({
                        email: data.get("email"),
                        password: data.get("password"),
                      }),
                    });
                    const result = await response.json();
                    if (!response.ok)
                      throw new Error(result.error ?? "绑定失败，请重试。");
                    setMessage("验证邮件已发送，验证成功后即完成绑定。");
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "绑定失败，请重试。",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  <span>邮箱</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
                <label className="field">
                  <span>当前密码</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={256}
                    required
                  />
                </label>
                {error && (
                  <div role="alert" className="login-error">
                    {error}
                  </div>
                )}
                <button className="button primary full" disabled={busy}>
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    "发送绑定验证邮件"
                  )}
                </button>
              </form>
            )}
          </>
        )}
        <nav className="auth-links">
          <a href="/">返回设计空间</a>
        </nav>
      </section>
    </main>
  );
}
