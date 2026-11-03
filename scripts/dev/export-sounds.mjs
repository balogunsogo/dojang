// Export the ?lab=sounds A/B examples (loudness-matched) as MP3 for listening.
// Usage: npm run build && npx vite preview --port 4173, then
//   node scripts/dev/export-sounds.mjs [outDir]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
const out = process.argv[2] ?? 'docs/media/phase9_1';
mkdirSync(out, { recursive: true });
const wav = (chs, rate = 44100) => {
  const n = chs[0].length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chs[c][i] * 32767))), 44 + i * 4 + c * 2);
  return b;
};
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:4173/?lab=sounds');
const res = await p.evaluate(() => window.__renderExamples());
await b.close();
const stats = res.stats; delete res.stats;
const ids = [...new Set(Object.keys(res).map((k) => k.replace(/-v9?1?$/, '').replace(/-v9$/, '')))];
for (const [k, ch] of Object.entries(res)) {
  writeFileSync(`${out}/${k}.wav`, wav(ch));
  execSync(`ffmpeg -loglevel error -y -i ${out}/${k}.wav -c:a libmp3lame -q:a 3 ${out}/${k}.mp3 && rm ${out}/${k}.wav`);
}
// A then B, with a short gap, for quick comparison.
for (const id of ids) {
  execSync(`ffmpeg -loglevel error -y -i ${out}/${id}-v9.mp3 -f lavfi -t 0.6 -i anullsrc=r=44100:cl=stereo -i ${out}/${id}-v91.mp3 -filter_complex "[0][1][2]concat=n=3:v=0:a=1" -c:a libmp3lame -q:a 3 ${out}/${id}-A9-then-B91.mp3`);
}
console.log(JSON.stringify(stats, null, 1));
