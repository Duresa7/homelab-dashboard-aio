import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (variable, latin subset fetched on demand via unicode-range).
// Works offline on an isolated LAN — no Fontshare/Google CDN dependency.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

// globals.css imports components.css into a low-priority `legacy` cascade layer.
import './styles/globals.css';
import { App } from './App';
import { TempUnitProvider } from './lib/units';
import { hydrateStore } from './lib/store';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

// Pull persistent state from the server before first render so route, theme,
// inventory, etc. are all in-memory and synchronously readable from components.
void hydrateStore().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <TempUnitProvider>
        <App />
      </TempUnitProvider>
    </StrictMode>,
  );
});
