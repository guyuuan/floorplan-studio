import LoginForm from "@/components/LoginForm";
import { getRuntime, authEnabled } from "@/server/runtime";
import { registrationEnabled } from "@/server/accounts";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };
export default async function AuthPage() {
  const runtime = await getRuntime();
  const enabled = authEnabled(runtime) && registrationEnabled(runtime);
  return <LoginForm mode="forgot" registrationEnabled={enabled} />;
}
