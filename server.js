require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const {
  addToPortfolio,
  listPortfolioItems,
  updatePortfolioItem,
  deletePortfolioItem
} = require('./notion-sync');
const { resolveCoverUrl } = require('./cover-generator');

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error('❌ Missing ADMIN_PASSWORD or SESSION_SECRET in .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// --- Public site preview (mirrors what GitHub Pages serves) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.use('/covers', express.static(path.join(__dirname, 'covers')));

// --- Admin auth ---
function requirePageAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/admin/login');
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: '未登入' });
}

app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'login.html')));

app.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === process.env.ADMIN_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: '密碼錯誤' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/admin', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use('/admin-assets', express.static(path.join(__dirname, 'admin')));

// --- Admin API (all routes below require auth) ---
app.use('/admin/api', requireApiAuth);

app.get('/admin/api/items', async (req, res) => {
  try {
    const items = await listPortfolioItems();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/items', async (req, res) => {
  try {
    const { name, description, url, tags, platform, coverUrl, isPublic } = req.body || {};
    if (!name) return res.status(400).json({ error: '缺少作品名稱' });
    const result = await addToPortfolio({ name, description, url, tags, platform, coverUrl, isPublic });
    res.json(result.supabase);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/admin/api/items/:id', async (req, res) => {
  try {
    const { regenerateCover, ...fields } = req.body || {};
    const updated = await updatePortfolioItem(req.params.id, fields, { regenerateCover: !!regenerateCover });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/api/items/:id', async (req, res) => {
  try {
    await deletePortfolioItem(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a cover without saving it (used by the "自動抓取封面" button)
app.post('/admin/api/resolve-cover', async (req, res) => {
  try {
    const { name, url } = req.body || {};
    if (!name) return res.status(400).json({ error: '缺少作品名稱' });
    const coverUrl = await resolveCoverUrl({ name, url, coverUrl: null });
    res.json({ coverUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Admin server running: http://localhost:${PORT}/admin`);
});
