"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Leaf, LoaderCircle } from "lucide-react";
type Mode = "login" | "register" | "forgot" | "reset" | "verify" | "resend";
const copy: Record<
  Mode,
  { title: string; description: string; button: string; api: string }
> = {
  login: {
    title: "欢迎回到筑间",
    description: "登录你的私人空间，继续设计理想的家。",
    button: "登录",
    api: "login",
  },
  register: {
    title: "创建你的筑间账号",
    description: "注册后验证邮箱，开启属于你的设计空间。",
    button: "注册并发送验证邮件",
    api: "register",
  },
  forgot: {
    title: "找回你的密码",
    description: "输入注册邮箱，我们会发送重置密码的链接。",
    button: "发送重置链接",
    api: "forgot-password",
  },
  reset: {
    title: "设置新密码",
    description: "密码重置后，需要重新登录并更新 MCP 令牌。",
    button: "重置密码",
    api: "reset-password",
  },
  verify: {
    title: "验证你的邮箱",
    description: "确认后激活账号，即可登录你的设计空间。",
    button: "验证邮箱",
    api: "verify-email",
  },
  resend: {
    title: "重新发送验证邮件",
    description: "输入注册邮箱，获取新的邮箱验证链接。",
    button: "发送验证邮件",
    api: "resend-verification",
  },
};
export default function LoginForm({
  mode = "login",
  registrationEnabled = true,
}: {
  mode?: Mode;
  registrationEnabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [token, setToken] = useState("");
  const tokenRead = useRef(false);
  const text = copy[mode],
    requiresToken = mode === "verify" || mode === "reset";
  useEffect(() => {
    if (requiresToken && !tokenRead.current) {
      tokenRead.current = true;
      const value =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      setToken(value);
      window.history.replaceState(null, "", window.location.pathname);
      if (!value) setError("缺少邮件链接，请重新申请。");
    }
  }, [requiresToken]);
  const username = mode === "login" || mode === "register",
    email = ["register", "forgot", "resend"].includes(mode),
    password = ["login", "register", "reset"].includes(mode);
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-emblem">
          <Leaf size={26} />
        </span>
        <span className="eyebrow">FLOORPLAN STUDIO</span>
        <h1>{text.title}</h1>
        <p>{text.description}</p>
        {success ? (
          <div role="status" className="auth-success">
            {success}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const fields = new FormData(e.currentTarget);
              if (
                (mode === "register" || mode === "reset") &&
                fields.get("password") !== fields.get("confirm")
              ) {
                setError("两次输入的密码不一致。");
                setBusy(false);
                return;
              }
              try {
                const response = await fetch(`/api/auth/${text.api}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    username: fields.get("username"),
                    email: fields.get("email"),
                    password: fields.get("password"),
                    token,
                  }),
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.error ?? "操作失败，请重试。");
                if (mode === "login") window.location.assign("/");
                else
                  setSuccess(
                    mode === "verify"
                      ? "邮箱验证成功，请登录。"
                      : mode === "reset"
                        ? "密码重置成功，请使用新密码登录。"
                        : (result.message ?? "邮件已发送，请检查收件箱。"),
                  );
              } catch (e) {
                setError(e instanceof Error ? e.message : "操作失败，请重试。");
              } finally {
                setBusy(false);
              }
            }}
          >
            {username && (
              <label className="field">
                <span>{mode === "login" ? "用户名或邮箱" : "用户名"}</span>
                <input
                  name="username"
                  autoComplete="username"
                  maxLength={mode === "register" ? 40 : 254}
                  minLength={mode === "register" ? 3 : 1}
                  pattern={
                    mode === "register"
                      ? "[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}"
                      : undefined
                  }
                  required
                  autoFocus
                />
              </label>
            )}
            {email && (
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
            )}
            {password && (
              <label className="field">
                <span>{mode === "reset" ? "新密码" : "密码"}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "login" ? 1 : 8}
                  maxLength={mode === "login" ? 256 : 24}
                  required
                />
              </label>
            )}
            {(mode === "register" || mode === "reset") && (
              <>
                <p className="small muted">密码长度 8–24 位。</p>
                <label className="field">
                  <span>确认密码</span>
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={24}
                    required
                  />
                </label>
              </>
            )}
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="button primary full large"
              disabled={busy || (requiresToken && !token)}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <>
                  {text.button}
                  <ArrowUpRight size={17} />
                </>
              )}
            </button>
          </form>
        )}
        <nav className="auth-links" aria-label="账号操作">
          {mode !== "login" && <a href="/login">返回登录</a>}
          {mode === "login" && (
            <>
              <a href="/forgot-password">忘记密码？</a>
              {registrationEnabled && <a href="/register">注册新账号</a>}
              <a href="/resend-verification">重新发送验证邮件</a>
            </>
          )}
          {mode === "register" && (
            <a href="/resend-verification">未收到验证邮件？</a>
          )}
        </nav>
        <div className="login-footer">你的户型与设计，仅由你掌握。</div>
      </section>
    </main>
  );
}
