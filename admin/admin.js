const itemListEl = document.getElementById('itemList');
const itemCountEl = document.getElementById('itemCount');
const createFormEl = document.getElementById('createForm');

let items = [];

const TOPIC_TAGS = ['Spiritual', 'Lifestyle', 'Creative', 'Kids', 'Entertainment', 'CélesteDestin'];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('未登入');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '發生錯誤');
  return data;
}

function fieldsMarkup(values = {}) {
  const currentTopicTag = (values.tags || [])[0] || '';
  const techTagsStr = (values.tech_tags || []).join(', ');
  const topicOptions = TOPIC_TAGS
    .map(t => `<option value="${escapeAttr(t)}" ${t === currentTopicTag ? 'selected' : ''}>${escapeHtml(t)}</option>`)
    .join('');
  return `
    <label>作品名稱 *
      <input name="name" value="${escapeAttr(values.name || '')}" required>
    </label>
    <label>網站介紹
      <textarea name="description" rows="2">${escapeHtml(values.description || '')}</textarea>
    </label>
    <label>網址
      <input name="url" type="url" placeholder="https://" value="${escapeAttr(values.url || '')}">
    </label>
    <label>主題標籤（篩選器用，僅一個）
      <select name="topicTag">${topicOptions}</select>
    </label>
    <label>技術標籤（逗號分隔，不顯示在篩選器）
      <input name="techTags" value="${escapeAttr(techTagsStr)}" placeholder="React, Supabase">
    </label>
    <label>開發平台
      <input name="platform" list="platformOptions" value="${escapeAttr(values.platform || '')}">
    </label>
    <label>封面圖網址
      <div class="cover-row">
        <input name="coverUrl" value="${escapeAttr(values.cover_url || values.coverUrl || '')}">
        <button type="button" class="btn-ghost btn-fetch-cover">自動抓取</button>
      </div>
      <img class="cover-preview" src="${escapeAttr(values.cover_url || values.coverUrl || '')}" style="${(values.cover_url || values.coverUrl) ? '' : 'display:none;'}">
    </label>
    <label class="checkbox-row">
      <input type="checkbox" name="isPublic" ${values.is_public !== false ? 'checked' : ''}>
      公開顯示於作品集
    </label>
  `;
}

function readForm(form) {
  const fd = new FormData(form);
  const topicTag = (fd.get('topicTag') || '').trim();
  return {
    name: fd.get('name')?.trim(),
    description: fd.get('description')?.trim() || null,
    url: fd.get('url')?.trim() || null,
    tags: topicTag ? [topicTag] : [],
    techTags: (fd.get('techTags') || '').split(',').map(t => t.trim()).filter(Boolean),
    platform: fd.get('platform')?.trim() || null,
    coverUrl: fd.get('coverUrl')?.trim() || null,
    isPublic: fd.get('isPublic') === 'on'
  };
}

function wireCoverFetch(form) {
  const fetchBtn = form.querySelector('.btn-fetch-cover');
  const coverInput = form.querySelector('[name="coverUrl"]');
  const preview = form.querySelector('.cover-preview');

  fetchBtn.addEventListener('click', async () => {
    const name = form.querySelector('[name="name"]').value.trim();
    const url = form.querySelector('[name="url"]').value.trim();
    if (!name) return alert('請先填寫作品名稱');

    fetchBtn.disabled = true;
    fetchBtn.textContent = '抓取中…';
    try {
      const { coverUrl } = await api('/admin/api/resolve-cover', {
        method: 'POST',
        body: JSON.stringify({ name, url })
      });
      coverInput.value = coverUrl;
      preview.src = coverUrl;
      preview.style.display = '';
    } catch (err) {
      alert('抓取失敗：' + err.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = '自動抓取';
    }
  });

  coverInput.addEventListener('change', () => {
    preview.src = coverInput.value;
    preview.style.display = coverInput.value ? '' : 'none';
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// --- Create form ---
createFormEl.innerHTML = fieldsMarkup({}) + `<button type="submit" class="btn-primary">新增作品</button>`;
wireCoverFetch(createFormEl);
createFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = readForm(createFormEl);
  if (!payload.name) return alert('請填寫作品名稱');
  const btn = createFormEl.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '新增中…';
  try {
    await api('/admin/api/items', { method: 'POST', body: JSON.stringify(payload) });
    createFormEl.reset();
    createFormEl.querySelector('.cover-preview').style.display = 'none';
    await loadItems();
  } catch (err) {
    alert('新增失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '新增作品';
  }
});

// --- List + edit/delete ---
async function loadItems() {
  itemListEl.innerHTML = `<p class="muted">載入中…</p>`;
  try {
    items = await api('/admin/api/items');
    itemCountEl.textContent = `共 ${items.length} 件作品`;
    renderList();
  } catch (err) {
    itemListEl.innerHTML = `<p class="error">載入失敗：${escapeHtml(err.message)}</p>`;
  }
}

function renderList() {
  if (items.length === 0) {
    itemListEl.innerHTML = `<p class="muted">目前沒有作品</p>`;
    return;
  }
  itemListEl.innerHTML = '';
  items.forEach(item => itemListEl.appendChild(renderItemCard(item)));
}

function renderItemCard(item) {
  const card = document.createElement('article');
  card.className = 'item-card';
  card.dataset.id = item.id;

  card.innerHTML = `
    <div class="item-view">
      <img class="item-thumb" src="${escapeAttr(item.cover_url || '')}" onerror="this.style.visibility='hidden'">
      <div class="item-info">
        <h3>${escapeHtml(item.name)} ${item.is_public ? '' : '<span class="badge">未公開</span>'}</h3>
        <p class="muted">${escapeHtml(item.description || '')}</p>
        <p class="muted small">${escapeHtml(item.platform || '')} ${(item.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join(' ')} ${(item.tech_tags || []).map(t => `<span class="tag-pill tech">${escapeHtml(t)}</span>`).join(' ')}</p>
      </div>
      <div class="item-actions">
        <button class="btn-ghost btn-edit">編輯</button>
        <button class="btn-danger btn-delete">刪除</button>
      </div>
    </div>
    <form class="item-form item-edit-form" style="display:none;"></form>
  `;

  const editForm = card.querySelector('.item-edit-form');
  const editBtn = card.querySelector('.btn-edit');
  const deleteBtn = card.querySelector('.btn-delete');
  const viewEl = card.querySelector('.item-view');

  editBtn.addEventListener('click', () => {
    const isOpen = editForm.style.display !== 'none';
    if (isOpen) {
      editForm.style.display = 'none';
      editBtn.textContent = '編輯';
      return;
    }
    editForm.innerHTML = fieldsMarkup(item) + `
      <div class="form-actions">
        <button type="submit" class="btn-primary">儲存</button>
        <button type="button" class="btn-ghost btn-cancel">取消</button>
      </div>`;
    wireCoverFetch(editForm);
    editForm.querySelector('.btn-cancel').addEventListener('click', () => {
      editForm.style.display = 'none';
      editBtn.textContent = '編輯';
    });
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = readForm(editForm);
      const saveBtn = editForm.querySelector('button[type="submit"]');
      saveBtn.disabled = true;
      saveBtn.textContent = '儲存中…';
      try {
        await api(`/admin/api/items/${item.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        await loadItems();
      } catch (err) {
        alert('儲存失敗：' + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
      }
    });
    editForm.style.display = '';
    editBtn.textContent = '收合';
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`確定要刪除「${item.name}」嗎？此動作無法復原。`)) return;
    deleteBtn.disabled = true;
    try {
      await api(`/admin/api/items/${item.id}`, { method: 'DELETE' });
      await loadItems();
    } catch (err) {
      alert('刪除失敗：' + err.message);
      deleteBtn.disabled = false;
    }
  });

  return card;
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

loadItems();
