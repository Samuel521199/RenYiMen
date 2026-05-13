import { Suspense } from "react";
import { SignInForm } from "./SignInForm";

export const metadata = {
  title: "登录 · Workflow",
};

export default function SignInPage() {
  const showGitHub = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

  return (
    <main className="min-h-screen bg-neutral-100">
      <Suspense
        fallback={<div className="p-12 text-center text-sm text-neutral-500">加载登录表单…</div>}
      >
        <SignInForm showGitHub={showGitHub} />
      </Suspense>
    </main>
  );
}
