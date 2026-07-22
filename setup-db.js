// Run: node setup-db.js
// Creates the portfolio_items table in Supabase via SQL.
// If this script fails, copy the SQL below into Supabase Dashboard > SQL Editor.

require('dotenv').config();

const SQL = `
CREATE TABLE IF NOT EXISTS portfolio_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  url         text,
  tags        text[],
  tech_tags   text[],
  platform    text,
  notion_page_id text,
  cover_url   text,
  is_public   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;

-- Allow public read of public items
CREATE POLICY IF NOT EXISTS "public read" ON portfolio_items
  FOR SELECT USING (is_public = true);
`;

async function createTable() {
  const url = process.env.SUPABASE_URL + '/rest/v1/rpc/exec_sql';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql: SQL })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('❌ Auto-create failed (expected if exec_sql function not available).');
    console.error('   Status:', res.status, text.slice(0, 200));
    console.log('\n📋 Please run the following SQL manually in Supabase Dashboard > SQL Editor:\n');
    console.log(SQL);
  } else {
    console.log('✅ Table portfolio_items created successfully!');
  }
}

createTable().catch(console.error);
