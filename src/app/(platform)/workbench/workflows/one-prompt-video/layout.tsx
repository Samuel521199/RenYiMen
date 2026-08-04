import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { isOnePromptVideoWorkbenchEnabled } from "@/lib/one-prompt-video-feature";

export const dynamic = "force-dynamic";

export default function OnePromptVideoWorkflowLayout({ children }: { children: ReactNode }) {
  if (!isOnePromptVideoWorkbenchEnabled()) notFound();
  return children;
}
