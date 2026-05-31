import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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
