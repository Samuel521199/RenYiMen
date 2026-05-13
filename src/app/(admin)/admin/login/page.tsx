import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminAccess } from "@/lib/admin-access";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const metadata = {
  title: "管理端登录",
};

export default async function AdminLoginPage() {
  const access = await getAdminAccess();
  if (access.ok) {
    redirect("/admin");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <AdminLoginForm />
      <p className="mt-8 text-center text-xs text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          返回站点首页
        </Link>
      </p>
    </main>
  );
}
