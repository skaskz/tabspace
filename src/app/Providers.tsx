import type { ReactNode } from 'react';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { ThemeController } from './ThemeController';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <ThemeController />
        {children}
      </ConfirmProvider>
    </ToastProvider>
  );
}
