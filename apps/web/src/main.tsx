import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { config } from './env.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#01226a',
            colorLink: '#3a6ff7',
            borderRadius: 6,
            fontFamily:
              "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
          },
        }}
      >
        <AntApp>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </AntApp>
      </ConfigProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
