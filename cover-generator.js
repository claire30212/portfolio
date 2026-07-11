const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://claire30212.github.io/portfolio';
const COVERS_DIR = path.join(__dirname, 'covers');
const STORAGE_BUCKET = 'covers';

// Storage writes need the service_role key (bypasses RLS) — server-side only, never expose to the browser.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Morandi palette pairs (background gradient) + matching blob accent colors.
const PALETTES = [
  { from: '#EDE1F5', to: '#D8C6E8', blobs: ['#C4B5D4', '#E8A59B'], ink: '#4A3860' },
  { from: '#F5F0EB', to: '#E8DED2', blobs: ['#D4B5A8', '#A8B5A2'], ink: '#3D3530' },
  { from: '#E7EEE8', to: '#D3E0D6', blobs: ['#A8C4B8', '#9BAEBE'], ink: '#3A4A3F' },
  { from: '#EAEFF4', to: '#D6E1EA', blobs: ['#9BB5CC', '#C9A9A6'], ink: '#324352' },
  { from: '#F4E9E6', to: '#E6D2CC', blobs: ['#D4B5A8', '#C4B5D4'], ink: '#4A3530' },
];

function hashString(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function slugify(name) {
  const ascii = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = hashString(name || 'cover').slice(0, 8);
  return ascii ? `${ascii}-${hash}` : `cover-${hash}`;
}

async function fetchOgImage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioCoverBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i);

    if (!match) return null;

    return new URL(match[1], res.url).href;
  } catch (err) {
    console.warn(`⚠ OG image fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

// Screenshots the live site with a headless browser when no og:image is available.
async function captureScreenshot(url) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 675 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    return await page.screenshot({ type: 'png' });
  } catch (err) {
    console.warn(`⚠ Screenshot failed for ${url}: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function uploadScreenshot(name, buffer) {
  const filename = `${slugify(name)}.png`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, buffer, { contentType: 'image/png', upsert: true });

  if (error) {
    console.warn(`⚠ Supabase Storage upload failed for ${filename}: ${error.message}`);
    return null;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

async function captureAndUploadScreenshot(name, url) {
  const buffer = await captureScreenshot(url);
  if (!buffer) return null;
  return uploadScreenshot(name, buffer);
}

function generateMorandiCoverSvg(name) {
  const hash = hashString(name || 'cover');
  const palette = PALETTES[parseInt(hash.slice(0, 2), 16) % PALETTES.length];
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const caption = escapeXml((name || '').trim().slice(0, 24));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur1"><feGaussianBlur stdDeviation="30"/></filter>
  </defs>

  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#glow)"/>

  <circle cx="110" cy="90" r="140" fill="${palette.blobs[0]}" opacity="0.4" filter="url(#blur1)"/>
  <circle cx="1090" cy="590" r="170" fill="${palette.blobs[1]}" opacity="0.35" filter="url(#blur1)"/>

  <circle cx="600" cy="300" r="90" fill="#FFFFFF" opacity="0.55"/>
  <text x="600" y="335" text-anchor="middle"
    font-family="'Playfair Display','Noto Sans TC',serif"
    font-weight="600" font-size="88" fill="${palette.ink}">${escapeXml(initial)}</text>

  <text x="600" y="470" text-anchor="middle"
    font-family="'Noto Sans TC',sans-serif"
    font-weight="500" font-size="36" letter-spacing="1" fill="${palette.ink}">${caption}</text>
</svg>`;

  return svg;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- Hex <-> HSL helpers, used to derive a tint/shade family from one chosen primary color ---
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255
  };
}
function adjustLightness(hex, deltaPercent) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  const rgb = hslToRgb(hsl.h, hsl.s, Math.max(0, Math.min(100, hsl.l + deltaPercent)));
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function buildDesignedPalette(primaryHex) {
  return {
    bgLight: adjustLightness(primaryHex, 38),
    bgMid: adjustLightness(primaryHex, 16),
    primary: primaryHex,
    ink: adjustLightness(primaryHex, -46),
    accent: adjustLightness(primaryHex, 8),
    accentSoft: adjustLightness(primaryHex, 26)
  };
}

// Wraps a title into up to 3 centered lines: word-wrap for latin text, character-chunking
// (preferring breaks after punctuation) for CJK text which has no spaces.
function wrapTitle(name, maxCharsPerLine = 11) {
  const trimmed = (name || '').trim();
  if (/[a-zA-Z]/.test(trimmed) && trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (candidate.length > 18 && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  const chars = [...trimmed];
  const lines = [];
  let cur = '';
  for (const ch of chars) {
    cur += ch;
    if (cur.length >= maxCharsPerLine || /[，。？！：、]/.test(ch)) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function starPath(cx, cy, outerR, innerR = outerR * 0.45, points = 5, rotationDeg = -90) {
  const step = Math.PI / points;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (rotationDeg * Math.PI) / 180 + i * step;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

function decorationMarkup(decoration, palette) {
  if (decoration === 'geometric') {
    return [
      `<circle cx="140" cy="120" r="46" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.5"/>`,
      `<circle cx="1080" cy="560" r="60" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.45"/>`,
      `<rect x="1030" y="70" width="60" height="60" fill="none" stroke="${palette.accentSoft}" stroke-width="3" opacity="0.5" transform="rotate(45 1060 100)"/>`,
      `<rect x="90" y="555" width="46" height="46" fill="none" stroke="${palette.accentSoft}" stroke-width="3" opacity="0.5" transform="rotate(45 113 578)"/>`
    ].join('\n    ');
  }

  // 'stars' (default)
  const stars = [
    { cx: 150, cy: 110, r: 26 },
    { cx: 1060, cy: 130, r: 20 },
    { cx: 1120, cy: 560, r: 24 },
    { cx: 110, cy: 580, r: 18 },
    { cx: 620, cy: 90, r: 14 }
  ];
  return stars
    .map(s => `<path d="${starPath(s.cx, s.cy, s.r)}" fill="${palette.accent}" opacity="0.55"/>`)
    .join('\n    ');
}

// Hand-designed-style Morandi cover: gradient background in a chosen primary color,
// large centered title, and a scattering of star or geometric decorations.
function generateDesignedCoverSvg({ name, primaryColor, decoration = 'stars' }) {
  const palette = buildDesignedPalette(primaryColor);
  const lines = wrapTitle(name);
  const longest = Math.max(...lines.map(l => l.length));

  let fontSize = 76;
  if (longest > 7) fontSize = 60;
  if (longest > 10) fontSize = 48;
  if (longest > 14) fontSize = 38;

  const lineHeight = fontSize * 1.25;
  const startY = 337 - ((lines.length - 1) * lineHeight) / 2;

  const titleMarkup = lines
    .map((line, i) => `
  <text x="600" y="${(startY + i * lineHeight).toFixed(1)}" text-anchor="middle"
    font-family="'Playfair Display','Noto Sans TC',serif" font-weight="600"
    font-size="${fontSize}" fill="${palette.ink}" stroke="#FFFFFF" stroke-width="${(fontSize * 0.09).toFixed(1)}"
    paint-order="stroke" letter-spacing="1">${escapeXml(line)}</text>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bgLight}"/>
      <stop offset="55%" stop-color="${palette.bgMid}"/>
      <stop offset="100%" stop-color="${palette.primary}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur1"><feGaussianBlur stdDeviation="30"/></filter>
  </defs>

  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#glow)"/>

  <circle cx="120" cy="100" r="150" fill="${palette.accentSoft}" opacity="0.35" filter="url(#blur1)"/>
  <circle cx="1090" cy="580" r="180" fill="${palette.accent}" opacity="0.3" filter="url(#blur1)"/>

  ${decorationMarkup(decoration, palette)}
  ${titleMarkup}
</svg>`;
}

async function uploadSvgToStorage(name, svgText) {
  const filename = `${slugify(name)}.svg`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, Buffer.from(svgText, 'utf8'), { contentType: 'image/svg+xml', upsert: true });

  if (error) {
    console.warn(`⚠ Supabase Storage upload failed for ${filename}: ${error.message}`);
    return null;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

function saveMorandiCover(name) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const filename = `${slugify(name)}.svg`;
  const filePath = path.join(COVERS_DIR, filename);
  fs.writeFileSync(filePath, generateMorandiCoverSvg(name), 'utf8');
  return `${SITE_BASE_URL}/covers/${filename}`;
}

// True for covers produced by saveMorandiCover() (our generated fallback) — i.e. not a
// real og:image, not a screenshot, and not a hand-made asset like covers/kids-points.svg.
function isGeneratedCover(coverUrl) {
  if (!coverUrl) return true;
  if (!coverUrl.startsWith(`${SITE_BASE_URL}/covers/`)) return false;
  return /-[0-9a-f]{8}\.svg$/i.test(coverUrl);
}

// Resolves a cover image URL for a portfolio item, in order:
// 1. explicit coverUrl wins
// 2. OG image scraped from the item's own url
// 3. headless-browser screenshot of the site, uploaded to Supabase Storage
// 4. generated Morandi-style SVG, saved under covers/ and served via GitHub Pages
async function resolveCoverUrl({ name, url, coverUrl }) {
  if (coverUrl) return coverUrl;

  if (url) {
    const og = await fetchOgImage(url);
    if (og) return og;

    const screenshotUrl = await captureAndUploadScreenshot(name, url);
    if (screenshotUrl) return screenshotUrl;
  }

  return saveMorandiCover(name);
}

module.exports = {
  resolveCoverUrl,
  fetchOgImage,
  captureScreenshot,
  uploadScreenshot,
  saveMorandiCover,
  generateMorandiCoverSvg,
  generateDesignedCoverSvg,
  uploadSvgToStorage,
  isGeneratedCover,
  slugify,
  SITE_BASE_URL
};
