import { Suspense } from "react";
import { RegisterForm } from "./RegisterForm";

export const metadata = {
  title: "注册 · Workflow",
};

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-neutral-100">
      <Suspense
        fallback={<div className="p-12 text-center text-sm text-neutral-500">加载注册表单…</div>}
      >
        <RegisterForm />
      </Suspense>
    </main>
  );
}
