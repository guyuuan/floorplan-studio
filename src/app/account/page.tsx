import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getRuntime } from "@/server/runtime";
import { accounts } from "@/server/accounts";
import { RuleError } from "@/domain/engine";
import AccountForm from "@/components/AccountForm";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const runtime = await getRuntime(),
    h = await headers();
  let identity;
  try {
    identity = await requireUser(
      new Request(
        runtime.env.APP_ORIGIN ?? `http://${h.get("host") ?? "127.0.0.1:3000"}`,
        { headers: h },
      ),
      runtime,
    );
  } catch (e) {
    if (e instanceof RuleError && e.status === 401) redirect("/login");
    throw e;
  }
  if (!identity) redirect("/");
  const user = await (await accounts(runtime)).repository.byId(identity.userId);
  if (!user) redirect("/login");
  return <AccountForm username={user.username} email={user.email} />;
}
