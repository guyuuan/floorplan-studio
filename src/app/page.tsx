import Studio from "@/components/Studio";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { authEnabled, getRuntime } from "@/server/runtime";
import { RuleError } from "@/domain/engine";
export const dynamic = "force-dynamic";
export default async function Page() {
  const runtime = await getRuntime(),
    requestHeaders = await headers();
  const request = new Request(
    runtime.env.APP_ORIGIN ??
      `http://${requestHeaders.get("host") ?? "127.0.0.1:3000"}`,
    { headers: requestHeaders },
  );
  let user;
  try {
    user = await requireUser(request, runtime);
  } catch (e) {
    if (e instanceof RuleError && e.status === 401) redirect("/login");
    throw e;
  }
  return (
    <Studio
      storageMode={runtime.mode}
      loginEnabled={authEnabled(runtime)}
      currentUser={user ? { id: user.userId, username: user.username } : null}
    />
  );
}
