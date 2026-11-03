import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (OFL). Preload the two interface weights every screen uses.
import plex400 from './assets/fonts/plex-sans-latin-400.woff2?url';
import plex600 from './assets/fonts/plex-sans-latin-600.woff2?url';
import './fonts.css';
import './tokens.css';
import './styles.css';
import './ui/menu.css';

for (const href of [plex400, plex600]) {
  const l = document.createElement('link');
  l.rel = 'preload';
  l.as = 'font';
  l.type = 'font/woff2';
  l.crossOrigin = 'anonymous';
  l.href = href;
  document.head.appendChild(l);
}

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

if (params.get('lab') === 'poses') {
  import('./lab/poseLab').then((m) => m.runPoseLab(root));
} else if (params.get('lab') === 'sounds') {
  import('./lab/soundLab').then((m) => m.runSoundLab(root));
} else if (params.get('lab') === 'motion') {
  import('./lab/motionLab').then((m) => m.runMotionLab(root));
} else {
  import('./App').then(({ App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
