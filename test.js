require('dotenv').config();
const { addToPortfolio, notion, supabase } = require('./notion-sync');

const TEST_NAME = `[TEST] 測試作品_${Date.now()}`;

async function run() {
  console.log('=== 端對端測試開始 ===\n');

  // 1. 寫入 Notion + Supabase
  console.log('➤ 寫入測試資料...');
  let notionId, supabaseId;
  try {
    const result = await addToPortfolio({
      name: TEST_NAME,
      description: '這是自動測試，請忽略',
      url: 'https://example.com',
      tags: ['測試', 'auto'],
      platform: 'Claude Code',
      isPublic: false
    });
    notionId = result.notion.id;
    supabaseId = result.supabase.id;
    console.log('  ✅ Notion page id :', notionId);
    console.log('  ✅ Supabase row id:', supabaseId);
  } catch (err) {
    console.error('  ❌ 寫入失敗:', err.message);
    process.exit(1);
  }

  // 2. 從 Supabase 讀回驗證
  console.log('\n➤ 從 Supabase 讀回驗證...');
  try {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('id', supabaseId)
      .single();
    if (error) throw error;
    console.log('  ✅ 名稱:', data.name);
    console.log('  ✅ 標籤:', data.tags.join(', '));
    console.log('  ✅ 公開:', data.is_public);
  } catch (err) {
    console.error('  ❌ 讀取失敗:', err.message);
    process.exit(1);
  }

  // 3. 清理測試資料
  console.log('\n➤ 清理測試資料...');
  try {
    const { error: delError } = await supabase
      .from('portfolio_items')
      .delete()
      .eq('id', supabaseId);
    if (delError) throw delError;
    await notion.pages.update({ page_id: notionId, archived: true });
    console.log('  ✅ Supabase 測試列已刪除');
    console.log('  ✅ Notion 測試頁已封存');
  } catch (err) {
    console.warn('  ⚠ 清理失敗（不影響測試結果）:', err.message);
  }

  console.log('\n=== 測試通過 ✅ Notion 與 Supabase 均正常 ===');
}

run().catch(err => {
  console.error('未預期錯誤:', err);
  process.exit(1);
});
