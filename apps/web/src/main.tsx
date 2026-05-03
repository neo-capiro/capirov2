import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { config } from './env.js';
import './theme.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// Brand palette - Capiro Brand Book.
const CAPIRO_BLUE = '#01226A';
const CAPIRO_BLUE_DEEP = '#001650';
const SIGNAL_BLUE = '#2456B8';
const SOFT_WHITE = '#F4F6F8';
const COOL_GRAY = '#6B7280';
const TEXT_PRIMARY = '#111827';
const APP_FONT =
  "'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={config.clerkPublishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      appearance={{
        variables: {
          colorPrimary: CAPIRO_BLUE,
          colorText: TEXT_PRIMARY,
          colorTextSecondary: COOL_GRAY,
          fontFamily: APP_FONT,
        },
      }}
    >
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: CAPIRO_BLUE,
            colorLink: SIGNAL_BLUE,
            colorLinkHover: CAPIRO_BLUE,
            colorTextSecondary: COOL_GRAY,
            colorText: TEXT_PRIMARY,
            colorBgLayout: SOFT_WHITE,
            borderRadius: 10,
            fontFamily: APP_FONT,
            fontFamilyCode:
              "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
          },
          components: {
            Typography: {
              titleMarginBottom: 0.5,
            },
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
              itemBorderRadius: 8,
            },
            Layout: {
              siderBg: CAPIRO_BLUE,
              triggerBg: CAPIRO_BLUE_DEEP,
            },
            Card: {
              borderRadiusLG: 14,
            },
            Input: {
              borderRadius: 10,
            },
            Select: {
              borderRadius: 10,
            },
            Button: {
              borderRadius: 10,
              fontWeight: 600,
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
