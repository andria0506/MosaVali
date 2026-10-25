import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { SessionProvider } from './state/SessionContext';
import { AppRoutes } from './routes';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
