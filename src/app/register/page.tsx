import LoginForm from "@/components/LoginForm";
import { getRuntime, authEnabled } from "@/server/runtime";
import { registrationEnabled } from "@/server/accounts";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };
export default async function AuthPage() {
  const runtime = await getRuntime();
  const enabled = authEnabled(runtime) && registrationEnabled(runtime);
  if (!enabled)
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>当前站点已关闭注册</h1>
          <a href="/login">返回登录</a>
        </section>
      </main>
    );
  return <LoginForm mode="register" registrationEnabled={enabled} />;
}
