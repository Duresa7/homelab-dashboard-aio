import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import './styles/globals.css';
import { App } from './App';
import { AuthBoot } from './pages/auth/AuthBoot';
import { installAuthExpiryInterceptor } from './lib/auth';
import { onReconnect, startHeartbeat } from './lib/connectivity';
import { TempUnitProvider } from './lib/units';
import { rehydrate } from './lib/store';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

installAuthExpiryInterceptor();

onReconnect(() => {
  void rehydrate();
});
startHeartbeat();

createRoot(rootEl).render(
  <StrictMode>
    <AuthBoot>
      <TempUnitProvider>
        <App />
      </TempUnitProvider>
    </AuthBoot>
  </StrictMode>,
);
