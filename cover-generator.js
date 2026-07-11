const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://claire30212.github.io/portfolio';
const COVERS_DIR = path.join(__dirname, 'covers');

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

function saveMorandiCover(name) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const filename = `${slugify(name)}.svg`;
  const filePath = path.join(COVERS_DIR, filename);
  fs.writeFileSync(filePath, generateMorandiCoverSvg(name), 'utf8');
  return `${SITE_BASE_URL}/covers/${filename}`;
}

// Resolves a cover image URL for a portfolio item:
// 1. explicit coverUrl wins
// 2. OG image scraped from the item's own url
// 3. generated Morandi-style SVG, saved under covers/ and served via GitHub Pages
async function resolveCoverUrl({ name, url, coverUrl }) {
  if (coverUrl) return coverUrl;

  if (url) {
    const og = await fetchOgImage(url);
    if (og) return og;
  }

  return saveMorandiCover(name);
}

module.exports = { resolveCoverUrl, fetchOgImage, saveMorandiCover, generateMorandiCoverSvg, slugify, SITE_BASE_URL };
