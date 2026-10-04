import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { HostedSpacetimeProvider } from './spacetime/hosted';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HostedSpacetimeProvider>
      <App />
    </HostedSpacetimeProvider>
  </StrictMode>,
);
