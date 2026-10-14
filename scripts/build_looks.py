#!/usr/bin/env python3
"""Estimate a pixel-art look for each NFL player from his official headshot.

Writes nfl-looks.json: { "<headshot url>": [skin, hair, hairColor, beard] } using the
game's palettes (SKIN 0-5 light->dark, HAIR 0 bald 1 buzz 2 short 3 afro 4 long/dreads,
HAIRC 0-5, beard 0 none 1 stubble 2 beard). Results are cached by URL, so the weekly
job only analyses new headshots. These are rough automatic estimates from photo
colours; anything that comes out wrong can be fixed in-game with EDIT LOOK.
"""
import io, json, os, sys, urllib.request, concurrent.futures as cf
import numpy as np
from PIL import Image

SKIN = ['#f6d0a8','#e8b88a','#c98e5e','#a8703f','#7c4a26','#5a341a']
HAIRC = ['#16100c','#3a2414','#6b4420','#c8a050','#8a3a1a','#cfcfcf']
hexrgb = lambda h: np.array([int(h[i:i+2],16) for i in (1,3,5)],float)
SKIN_RGB = [hexrgb(c) for c in SKIN]; HAIR_RGB = [hexrgb(c) for c in HAIRC]
lum = lambda c: 0.299*c[0]+0.587*c[1]+0.114*c[2]

try:
    import cv2
    _casc = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
    FACE = cv2.CascadeClassifier(_casc) if os.path.exists(_casc) else None
except Exception:
    cv2 = None; FACE = None

def fetch(url):
    u = url.replace('f_auto,q_auto', 'f_png,q_auto,w_240')
    req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 retro-football-roster-bot'})
    return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGBA')

def nearest(c, pal):
    return int(np.argmin([np.sum((c-p)**2) for p in pal]))

def analyse(img):
    a = np.asarray(img).astype(float); rgb = a[..., :3]; alpha = a[..., 3]
    H, W = alpha.shape
    if alpha.min() > 250:  # no transparency: estimate background from the top corners
        bg = np.median(np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3)]), 0)
        fg = np.linalg.norm(rgb - bg, axis=2) > 40
    else:
        fg = alpha > 128
    rows = np.where(fg.any(1))[0]
    if not len(rows): return None
    top = rows[0]
    # 1) where is the face? Haar cascade when available, else the head silhouette.
    cx = hw = None; fy = None
    if FACE is not None:
        g = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)
        fs = FACE.detectMultiScale(g, 1.1, 4, minSize=(W//6, W//6))
        if len(fs):
            x, y, w, h = max(fs, key=lambda f: f[2]*f[3]); cx, hw, fy = x+w//2, w, y+h//2
    if cx is None:
        r = min(H-1, top + int(0.22*H)); cols = np.where(fg[r])[0]
        if len(cols) < 3: return None
        cx, hw = (cols[-1]+cols[0])//2, cols[-1]-cols[0]
        fy = top + int(hw*0.62)
    # 2) skin = median colour of the cheeks / centre of the face
    def reg(x0, y0, x1, y1):
        x0, x1 = max(0, int(x0)), min(W, int(x1)); y0, y1 = max(0, int(y0)), min(H, int(y1))
        if x1 <= x0 or y1 <= y0: return np.zeros((0, 3)), 0
        m = fg[y0:y1, x0:x1]; return rgb[y0:y1, x0:x1][m], m.size
    cheeks, _ = reg(cx-hw*.25, fy-hw*.05, cx+hw*.25, fy+hw*.2)
    if len(cheeks) < 20: return None
    skin = np.median(cheeks, 0); sL = lum(skin); skin_i = nearest(skin, SKIN_RGB)
    nonskin = lambda px: np.linalg.norm(px - skin, axis=-1) > 45
    # 3) forehead line: scanning up the centre of the face, the first non-skin row is the hairline
    band = slice(max(0, cx-int(hw*.12)), min(W, cx+int(hw*.12)))
    hairline = top
    for yy in range(int(fy), top-1, -1):
        m = fg[yy, band]
        if not m.any(): hairline = yy+1; break
        if np.mean(nonskin(rgb[yy, band][m])) > 0.6: hairline = yy+1; break
    hair_px, n = reg(cx-hw*.45, top, cx+hw*.45, hairline)
    hair_px = hair_px[nonskin(hair_px)] if len(hair_px) else hair_px
    hair_h = (hairline-top)/max(1, hw)                    # hair thickness above the forehead
    width_top = 0
    for yy in range(top, hairline):
        c = np.where(fg[yy])[0]
        if len(c): width_top = max(width_top, c[-1]-c[0])
    sides, n1 = reg(cx-hw*.75, fy+hw*.15, cx-hw*.42, fy+hw*.75)
    sides2, n2 = reg(cx+hw*.42, fy+hw*.15, cx+hw*.75, fy+hw*.75)
    sp = np.concatenate([sides, sides2]) if len(sides)+len(sides2) else np.zeros((0, 3))
    dark_sides = (np.sum(nonskin(sp) & (np.array([lum(c) for c in sp]) < sL*0.8)) if len(sp) else 0)/max(1, n1+n2)
    if len(hair_px) < 15 or hair_h < 0.04: hair = 0                      # bald / shaved
    elif dark_sides > 0.3: hair = 4                                      # long hair / dreads past the ears
    elif hair_h < 0.06: hair = 1                                         # very close-cropped
    else: hair = 2                                                       # short (safe default; afro etc. via EDIT LOOK)
    hc = nearest(np.median(hair_px, 0), HAIR_RGB) if len(hair_px) > 10 else (0 if sL < 150 else 1)
    chin, _ = reg(cx-hw*.16, fy+hw*.30, cx+hw*.16, fy+hw*.46)
    frac = (np.mean(nonskin(chin) & (np.array([lum(c) for c in chin]) < sL*0.85)) if len(chin) > 10 else 0)
    # raw measurements; final palette indices are chosen in finalize() so thresholds can be tuned
    return {'v': 2, 'skin': [int(round(v)) for v in skin], 'hair': hair, 'hc': hc, 'chin': round(float(frac), 3)}

# Luminance cut points between the 6 skin tones (light -> dark). Photo lighting makes raw
# medians read darker than the sprite palette, so these were tuned on the whole roster.
# score = 0.6*red + 0.4*luminance (red copes better with warm studio lighting)
SKIN_CUTS = [195, 172, 150, 125, 95]
def finalize(raw):
    c = np.array(raw['skin'], float); score = 0.6*c[0] + 0.4*lum(c)
    skin = sum(score < x for x in SKIN_CUTS)
    beard = 2 if raw['chin'] > 0.55 else 1 if raw['chin'] > 0.38 else 0
    return [int(skin), int(raw['hair']), int(raw['hc']), int(beard)]

def update(rows):
    cache = json.load(open('nfl-looks.json')) if os.path.exists('nfl-looks.json') else {}
    cache = {k: v for k, v in cache.items() if isinstance(v, dict) and v.get('v') == 2}   # drop old-format entries
    urls = sorted({r['headshot_url'] for r in rows if r.get('headshot_url') and r['headshot_url'] not in cache})
    print(f'{len(urls)} new headshots to analyse ({len(cache)} cached); face detector: {"on" if FACE is not None else "off"}')
    def work(u):
        try: return u, analyse(fetch(u))
        except Exception as e: return u, None
    done = 0
    with cf.ThreadPoolExecutor(12) as ex:
        for u, look in ex.map(work, urls):
            if look: cache[u] = look
            done += 1
            if done % 250 == 0: print(f'  {done}/{len(urls)}')
    json.dump(cache, open('nfl-looks.json', 'w'), separators=(',', ':'))
    print(f'nfl-looks.json: {len(cache)} looks')
    return cache

if __name__ == '__main__':
    print('run via: python3 scripts/build_rosters.py 2026 --looks')
