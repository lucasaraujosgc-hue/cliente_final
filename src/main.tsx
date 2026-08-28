import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}

// Session handling lives in src/lib/apiClient.ts: apiFetch transparently
// refreshes an expired access token and retries, and only dispatches the
// 'unauthorized' event (which the layouts turn into a redirect to /login)
// when the refresh token itself is gone/revoked. No global fetch patch — a
// bare 401/403 from some other call must not log the user out on its own.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
