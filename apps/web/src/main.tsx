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

// Brand palette — Capiro Brand Book.
const CAPIRO_BLUE = '#01226A';
const CAPIRO_BLUE_DEEP = '#001650';
const SIGNAL_BLUE = '#3A6FF7';
const SOFT_WHITE = '#F4F6F8';
const COOL_GRAY = '#6B7280';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: CAPIRO_BLUE,
            colorLink: SIGNAL_BLUE,
            colorLinkHover: CAPIRO_BLUE,
            colorTextSecondary: COOL_GRAY,
            colorBgLayout: SOFT_WHITE,
            borderRadius: 6,
            // Inter is the open-source alternative to Capiro's licensed Creato
            // Display. Loaded via Google Fonts in index.html.
            fontFamily:
              "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
          },
          components: {
            Menu: {
              // Sider menu is rendered with theme="dark" + the Capiro Blue
              // background. These tokens make the selected/hover states visible
              // against that anchor color rather than blending in.
              darkItemBg: CAPIRO_BLUE,
              darkItemSelectedBg: CAPIRO_BLUE_DEEP,
              darkSubMenuItemBg: CAPIRO_BLUE,
              darkItemHoverBg: 'rgba(255,255,255,0.06)',
              darkItemColor: 'rgba(255,255,255,0.78)',
              darkItemSelectedColor: '#ffffff',
              itemHeight: 44,
              itemMarginInline: 8,
              itemBorderRadius: 6,
            },
            Layout: {
              siderBg: CAPIRO_BLUE,
              triggerBg: CAPIRO_BLUE_DEEP,
            },
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
