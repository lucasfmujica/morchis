'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is fresh for 5 min and kept in cache for 30 min, so moving
            // between tabs reuses the cache instead of refetching every time.
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 30,
            // A PWA regains focus constantly; don't refetch everything on each
            // return. Mutations explicitly invalidate what actually changed.
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
