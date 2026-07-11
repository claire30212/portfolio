require('dotenv').config();
const { Client } = require('@notionhq/client');
const { createClient } = require('@supabase/supabase-js');
const { resolveCoverUrl } = require('./cover-generator');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
// Server-side only: uses the service_role key so it bypasses RLS (needed for writes).
// Never expose SUPABASE_SERVICE_KEY to browser code — app.js uses the public anon key instead.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Notion property names (from "Tools" database)
// 工具名稱  (title)
// 網站介紹  (rich_text)  – description
// 網站      (rich_text)  – url (stored as text)
// Multi-select (multi_select) – tags
// 開發平台  (select)     – platform
// 是否公開  (checkbox)
// Date      (date)

function buildNotionProperties({ name, description, url, tags = [], platform, isPublic }) {
  const properties = {
    '工具名稱': {
      title: [{ text: { content: name } }]
    }
  };

  if (isPublic !== undefined) {
    properties['是否公開'] = { checkbox: isPublic };
  }
  if (description !== undefined) {
    properties['網站介紹'] = {
      rich_text: description ? [{ text: { content: description } }] : []
    };
  }
  if (url !== undefined) {
    properties['網站'] = {
      rich_text: url ? [{ text: { content: url } }] : []
    };
  }
  if (tags !== undefined) {
    properties['Multi-select'] = {
      multi_select: (tags || []).map(t => ({ name: t }))
    };
  }
  if (platform !== undefined) {
    properties['開發平台'] = platform ? { select: { name: platform } } : { select: null };
  }

  return properties;
}

async function addToPortfolio({ name, description, url, tags = [], platform, coverUrl, isPublic = true }) {
  // --- Resolve cover image: explicit > OG image from url > generated Morandi SVG ---
  const resolvedCoverUrl = await resolveCoverUrl({ name, url, coverUrl });

  // --- Notion ---
  const notionPayload = {
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: buildNotionProperties({ name, description, url, tags, platform, isPublic }),
    cover: { external: { url: resolvedCoverUrl } }
  };

  const notionPage = await notion.pages.create(notionPayload);
  console.log('✅ Notion page created:', notionPage.id);

  // --- Supabase ---
  const { data, error } = await supabase
    .from('portfolio_items')
    .insert([{
      name,
      description: description || null,
      url: url || null,
      tags,
      platform: platform || null,
      notion_page_id: notionPage.id,
      cover_url: resolvedCoverUrl,
      is_public: isPublic
    }])
    .select();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  console.log('✅ Supabase record created:', data[0].id);

  return { notion: notionPage, supabase: data[0] };
}

async function listPortfolioItems() {
  const { data, error } = await supabase
    .from('portfolio_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Supabase select failed: ${error.message}`);
  return data;
}

// Updates a portfolio item in Supabase and keeps the linked Notion page in sync.
// `fields` may include: name, description, url, tags, platform, coverUrl, isPublic
// If `regenerateCover` is true, coverUrl is re-resolved (OG image / generated SVG)
// instead of using fields.coverUrl directly.
async function updatePortfolioItem(id, fields = {}, { regenerateCover = false } = {}) {
  const { data: existingRows, error: fetchError } = await supabase
    .from('portfolio_items')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`Supabase fetch failed: ${fetchError.message}`);
  const existing = existingRows;

  const merged = {
    name: fields.name !== undefined ? fields.name : existing.name,
    description: fields.description !== undefined ? fields.description : existing.description,
    url: fields.url !== undefined ? fields.url : existing.url,
    tags: fields.tags !== undefined ? fields.tags : existing.tags,
    platform: fields.platform !== undefined ? fields.platform : existing.platform,
    isPublic: fields.isPublic !== undefined ? fields.isPublic : existing.is_public
  };

  let coverUrl = fields.coverUrl !== undefined ? fields.coverUrl : existing.cover_url;
  if (regenerateCover) {
    coverUrl = await resolveCoverUrl({ name: merged.name, url: merged.url, coverUrl: null });
  }

  const supabaseUpdate = {
    name: merged.name,
    description: merged.description || null,
    url: merged.url || null,
    tags: merged.tags || [],
    platform: merged.platform || null,
    cover_url: coverUrl || null,
    is_public: merged.isPublic
  };

  const { data, error } = await supabase
    .from('portfolio_items')
    .update(supabaseUpdate)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Supabase update failed: ${error.message}`);

  if (existing.notion_page_id) {
    await notion.pages.update({
      page_id: existing.notion_page_id,
      properties: buildNotionProperties({
        name: merged.name,
        description: merged.description,
        url: merged.url,
        tags: merged.tags,
        platform: merged.platform,
        isPublic: merged.isPublic
      }),
      cover: coverUrl ? { external: { url: coverUrl } } : null
    });
  }

  return data;
}

async function deletePortfolioItem(id) {
  const { data: existing, error: fetchError } = await supabase
    .from('portfolio_items')
    .select('notion_page_id')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`Supabase fetch failed: ${fetchError.message}`);

  const { error } = await supabase
    .from('portfolio_items')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Supabase delete failed: ${error.message}`);

  if (existing && existing.notion_page_id) {
    await notion.pages.update({ page_id: existing.notion_page_id, archived: true });
  }

  return { id };
}

// Backfills cover_url for every item missing one, syncing the result to both
// Supabase (cover_url) and Notion (page cover).
async function backfillMissingCovers() {
  const { data: items, error } = await supabase
    .from('portfolio_items')
    .select('*')
    .or('cover_url.is.null,cover_url.eq.');

  if (error) throw new Error(`Supabase select failed: ${error.message}`);

  const results = [];
  for (const item of items) {
    try {
      const coverUrl = await resolveCoverUrl({ name: item.name, url: item.url, coverUrl: null });

      const { error: updateError } = await supabase
        .from('portfolio_items')
        .update({ cover_url: coverUrl })
        .eq('id', item.id);
      if (updateError) throw new Error(`Supabase update failed: ${updateError.message}`);

      if (item.notion_page_id) {
        await notion.pages.update({
          page_id: item.notion_page_id,
          cover: { external: { url: coverUrl } }
        });
      }

      console.log(`✅ ${item.name} → ${coverUrl}`);
      results.push({ id: item.id, name: item.name, coverUrl, ok: true });
    } catch (err) {
      console.error(`❌ ${item.name}: ${err.message}`);
      results.push({ id: item.id, name: item.name, ok: false, error: err.message });
    }
  }

  return results;
}

module.exports = {
  addToPortfolio,
  listPortfolioItems,
  updatePortfolioItem,
  deletePortfolioItem,
  backfillMissingCovers,
  notion,
  supabase
};
