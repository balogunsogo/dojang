import { audio, SOUND_NAMES } from '../game/audio/AudioEngine';

/**
 * Dev/UAT page (?lab=sounds): play every sound in the library, grouped, so
 * the mix can be judged by ear. "x4" plays four repeats to hear variation.
 */
export function runSoundLab(root: HTMLElement) {
  const groups: [string, string[]][] = [
    ['Impacts', ['body', 'head', 'punch', 'heavy', 'block']],
    ['Techniques', ['whoosh', 'whooshFast', 'whooshHeavy', 'snap', 'whiff', 'exhale']],
    ['Movement', ['step', 'scuff', 'land', 'slide']],
    ['Match', ['bell', 'horn', 'blip', 'buzz', 'drum', 'boom', 'fall', 'victory', 'defeat', 'stamina']],
    ['Training', ['tock', 'tick', 'chime', 'gong']],
    ['Menu', ['nav', 'select', 'confirm', 'back', 'swell']],
  ];
  const known = new Set(SOUND_NAMES());
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:24px;font:15px/1.4 system-ui,sans-serif;color:#efe6d8;background:#15120f;min-height:100%;overflow:auto';
  wrap.innerHTML = '<h1 style="font-weight:400;margin:0 0 4px">DOJANG sound lab</h1><p style="color:#a99f90;margin:0 0 16px">Tap a sound to play it once, or ×4 to hear its variations. Combined cues: <span id="combos"></span></p>';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:4px;padding:10px 14px;min-height:44px;background:#2a221b;color:#efe6d8;border:1px solid #4a3d31;border-radius:2px;cursor:pointer';
    b.onclick = () => {
      audio.unlock();
      audio.setMix({ master: 0.9, sfx: 1, ambient: 0.5, muted: false });
      fn();
    };
    return b;
  };
  const combos = wrap.querySelector('#combos')!;
  const combo: [string, () => void][] = [
    ['Roundhouse lands', () => (audio.technique({ kind: 'kick', strikeIn: 0.25, who: 0 }), setTimeout(() => audio.impact('body', false), 250))],
    ['Turning head kick lands', () => (audio.technique({ kind: 'turning', strikeIn: 0.3, who: 0 }), setTimeout(() => audio.impact('head', true), 300))],
    ['Kick blocked', () => (audio.technique({ kind: 'kick', strikeIn: 0.25, who: 0 }), setTimeout(() => audio.blocked(false, false), 250))],
    ['Kick misses', () => (audio.technique({ kind: 'kick', strikeIn: 0.25, who: 0 }), setTimeout(() => audio.whiff(), 300))],
    ['Competitive point (turning)', () => audio.score(4)],
    ['Gam-jeom', () => audio.penalty()],
    ['Deciding round', () => audio.roundStart(true, true)],
    ['Promotion', () => audio.promotion()],
  ];
  for (const [label, fn] of combo) combos.appendChild(btn(label, fn));
  for (const [title, names] of groups) {
    const h = document.createElement('h2');
    h.textContent = title;
    h.style.cssText = 'font-size:13px;color:#a99f90;margin:18px 0 4px';
    wrap.appendChild(h);
    for (const n of names.filter((x) => known.has(x))) {
      wrap.appendChild(btn(n, () => audio.play(n)));
      wrap.appendChild(btn('×4', () => [0, 1, 2, 3].forEach((i) => audio.play(n, { delay: i * 0.45 }))));
    }
  }
  root.appendChild(wrap);
}
