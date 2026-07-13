'use client';

import { LanguageProvider } from '@/lib/LanguageContext';
import { PermissionProvider } from '@/lib/PermissionContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <PermissionProvider>{children}</PermissionProvider>
    </LanguageProvider>
  );
}
