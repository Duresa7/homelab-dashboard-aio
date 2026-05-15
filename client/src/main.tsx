import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/globals.css';
import './styles/components.css';
import { App } from './App';
import { TempUnitProvider } from './lib/units';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <TempUnitProvider>
      <App />
    </TempUnitProvider>
  </StrictMode>,
);
