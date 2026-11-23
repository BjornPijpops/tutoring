import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { ConfigErrorScreen } from './app/config-error-screen';
import { parseConfig } from './core/config';
import { createContainer } from './infrastructure/container';
import './shared/styles/tokens.css';
import './shared/styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

const config = parseConfig(import.meta.env);

createRoot(container).render(
  <StrictMode>
    {config.ok ? (
      <App services={createContainer(config.value)} />
    ) : (
      <ConfigErrorScreen error={config.error} />
    )}
  </StrictMode>,
);
