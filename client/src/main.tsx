import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (variable, latin subset fetched on demand via unicode-range).
// Works offline on an isolated LAN — no Fontshare/Google CDN dependency.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

// globals.css imports components.css into a low-priority `legacy` cascade layer.
import './styles/globals.css';
import { App } from './App';
import { AuthBoot } from './pages/auth/AuthBoot';
import { installAuthExpiryInterceptor } from './lib/auth';
import { onReconnect, startHeartbeat } from './lib/connectivity';
import { TempUnitProvider } from './lib/units';
import { rehydrate } from './lib/store';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

// Any /api 401 mid-session flips the auth state to logged-out, which swaps
// the login screen back in. Install before anything fetches.
installAuthExpiryInterceptor();

onReconnect(() => {
  void rehydrate();
});
startHeartbeat();

// AuthBoot fetches the auth status, walks create-admin/login when needed, and
// hydrates the persistent store after login — /api/state requires a session.
createRoot(rootEl).render(
  <StrictMode>
    <AuthBoot>
      <TempUnitProvider>
        <App />
      </TempUnitProvider>
    </AuthBoot>
  </StrictMode>,
);
