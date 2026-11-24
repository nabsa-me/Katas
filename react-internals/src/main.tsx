import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

// No <StrictMode> here: in development it renders every component twice and mounts effects twice,
// which would double the render counters this kata is about. Real apps should keep it.
createRoot(document.getElementById('root')!).render(<App />);
