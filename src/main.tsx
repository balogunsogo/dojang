import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

if (params.get('lab') === 'poses') {
  import('./lab/poseLab').then((m) => m.runPoseLab(root));
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
