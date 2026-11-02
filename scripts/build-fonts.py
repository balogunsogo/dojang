"""Build the self-hosted UI font files from the Fontsource packages.

Latin faces are copied as-is (~19-24 KB each). The Korean faces are
subset to exactly the Hangul the DOM renders (wordmark, fighter names,
corner names), so a session downloads a few KB of Korean instead of
~170 KB per weight. Any other Hangul falls back to the system Korean font.

Requires: pip install fonttools brotli   Run: python3 scripts/build-fonts.py
"""
import shutil
from pathlib import Path
from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
NM = ROOT / 'node_modules' / '@fontsource'
OUT = ROOT / 'src' / 'assets' / 'fonts'
OUT.mkdir(parents=True, exist_ok=True)

# Hangul rendered in the DOM: 도장 (wordmark), 김재원 / 박하나 (fighters),
# 청 / 홍 (corners), 태권도 (Taekwondo). Keep in sync with src/ui/fonts.css.
HANGUL = '도장김재원박하나청홍태권'

for w in (300, 400):
    shutil.copy(NM / 'hahmlet/files' / f'hahmlet-latin-{w}-normal.woff2', OUT / f'hahmlet-latin-{w}.woff2')
for w in (400, 500, 600):
    shutil.copy(NM / 'ibm-plex-sans/files' / f'ibm-plex-sans-latin-{w}-normal.woff2', OUT / f'plex-sans-latin-{w}.woff2')

def ko(src: Path, dst: Path):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    font = subset.load_font(str(src), opts)
    s = subset.Subsetter(opts)
    s.populate(text=HANGUL)
    s.subset(font)
    subset.save_font(font, str(dst), opts)

ko(NM / 'hahmlet/files/hahmlet-korean-400-normal.woff2', OUT / 'hahmlet-ko-400.woff2')
for w in (400, 600):
    ko(NM / f'ibm-plex-sans-kr/files/ibm-plex-sans-kr-korean-{w}-normal.woff2', OUT / f'plex-sans-kr-{w}.woff2')

for f in sorted(OUT.iterdir()):
    print(f'{f.name:28s} {f.stat().st_size / 1024:6.1f} KB')
print('unicode-range:', ','.join(f'U+{ord(c):04X}' for c in sorted(set(HANGUL))))
