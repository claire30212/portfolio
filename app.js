// Supabase config (anon/publishable key — safe to expose in browser)
const SUPABASE_URL = 'https://tpvhouihekekcgybnzgb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_D8xJND9DJONcH7FOvsMCww_n4a5Rx9D';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let allItems = [];
let activeTag = null;

const TAG_ORDER = ['CélesteDestin', 'Spiritual', 'Lifestyle', 'Creative', 'Kids'];

async function loadPortfolio() {
  const gallery = document.getElementById('gallery');
  const emptyState = document.getElementById('emptyState');

  try {
    const { data, error } = await db
      .from('portfolio_items')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    allItems = data || [];

    if (allItems.length === 0) {
      gallery.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    buildFilterBar(allItems);
    renderCards(allItems);
  } catch (err) {
    gallery.innerHTML = `
      <div class="loading">
        <p style="color:#c0715a;">⚠ 無法連線到資料庫</p>
        <p style="font-size:.8rem;">${err.message}</p>
      </div>`;
    console.error('Supabase error:', err);
  }
}

function buildFilterBar(items) {
  const bar = document.getElementById('filterBar');
  bar.innerHTML = '';

  const allBtn = createFilterBtn('All', null);
  allBtn.classList.add('active');
  bar.appendChild(allBtn);

  TAG_ORDER.forEach(tag => bar.appendChild(createFilterBtn(tag, tag)));
}

function createFilterBtn(label, tag) {
  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    activeTag = tag;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filtered = tag ? allItems.filter(i => (i.tags || []).includes(tag)) : allItems;
    renderCards(filtered);
  });
  return btn;
}

function renderCards(items) {
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';

  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'card';

    // Cover image
    if (item.cover_url) {
      const img = document.createElement('img');
      img.className = 'card-cover';
      img.src = item.cover_url;
      img.alt = item.name;
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(placeholder(item.name));
      card.appendChild(img);
    } else {
      card.appendChild(placeholder(item.name));
    }

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';

    if (item.platform) {
      const platform = document.createElement('div');
      platform.className = 'card-platform';
      platform.textContent = item.platform;
      body.appendChild(platform);
    }

    const name = document.createElement('h2');
    name.className = 'card-name';
    name.textContent = item.name;
    body.appendChild(name);

    if (item.description) {
      const desc = document.createElement('p');
      desc.className = 'card-desc';
      desc.textContent = item.description;
      body.appendChild(desc);
    }

    if ((item.tags || []).length > 0) {
      const tagRow = document.createElement('div');
      tagRow.className = 'card-tags';
      item.tags.forEach(t => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = t;
        tagRow.appendChild(span);
      });
      body.appendChild(tagRow);
    }

    card.appendChild(body);

    // Footer button
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    if (item.url) {
      const a = document.createElement('a');
      a.className = 'btn-link';
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '查看作品 →';
      footer.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'btn-no-link';
      span.textContent = '即將上線';
      footer.appendChild(span);
    }
    card.appendChild(footer);

    gallery.appendChild(card);
  });
}

function placeholder(name) {
  const div = document.createElement('div');
  div.className = 'card-cover-placeholder';
  div.textContent = (name || '?').charAt(0).toUpperCase();
  return div;
}

loadPortfolio();
