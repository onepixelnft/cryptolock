"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/config/wagmi";
import { PreferencesProvider } from "@/lib/preferences";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/lib/toast";
import { ChainClockProvider } from "@/lib/chainClock";
import { Shell } from "@/components/Shell";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: true, staleTime: 5_000, retry: 1 },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <I18nProvider>
            <ToastProvider>
              <ChainClockProvider>
                <Shell>{children}</Shell>
              </ChainClockProvider>
            </ToastProvider>
          </I18nProvider>
        </PreferencesProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
