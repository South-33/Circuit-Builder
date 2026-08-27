import React from 'react';
import ReactDOM from 'react-dom/client';
import './components/registerElements';
import App from './app/App';
import { registerWebMCPTools } from './agent/webmcp';
import './app/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void registerWebMCPTools();