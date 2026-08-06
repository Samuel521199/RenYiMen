import { Suspense } from "react";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = {
  title: "重置密码",
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-neutral-100">
      <Suspense fallback={<div className="p-12 text-center text-sm text-neutral-500">加载重置表单…</div>}>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
