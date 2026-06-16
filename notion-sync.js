require('dotenv').config();
const { Client } = require('@notionhq/client');
const { createClient } = require('@supabase/supabase-js');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Notion property names (from "Tools" database)
// 工具名稱  (title)
// 網站介紹  (rich_text)  – description
// 網站      (rich_text)  – url (stored as text)
// Multi-select (multi_select) – tags
// 開發平台  (select)     – platform
// 是否公開  (checkbox)
// Date      (date)

async function addToPortfolio({ name, description, url, tags = [], platform, coverUrl, isPublic = true }) {
  // --- Notion ---
  const notionPayload = {
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      '工具名稱': {
        title: [{ text: { content: name } }]
      },
      '是否公開': {
        checkbox: isPublic
      }
    }
  };

  if (description) {
    notionPayload.properties['網站介紹'] = {
      rich_text: [{ text: { content: description } }]
    };
  }
  if (url) {
    notionPayload.properties['網站'] = {
      rich_text: [{ text: { content: url } }]
    };
  }
  if (tags.length > 0) {
    notionPayload.properties['Multi-select'] = {
      multi_select: tags.map(t => ({ name: t }))
    };
  }
  if (platform) {
    notionPayload.properties['開發平台'] = {
      select: { name: platform }
    };
  }
  if (coverUrl) {
    notionPayload.cover = { external: { url: coverUrl } };
  }

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
      cover_url: coverUrl || null,
      is_public: isPublic
    }])
    .select();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  console.log('✅ Supabase record created:', data[0].id);

  return { notion: notionPage, supabase: data[0] };
}

module.exports = { addToPortfolio, notion, supabase };
