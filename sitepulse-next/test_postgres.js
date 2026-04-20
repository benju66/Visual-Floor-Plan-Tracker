const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
  return acc;
}, {});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase.from('status_logs').insert([{
    unit_id: '00000000-0000-0000-0000-000000000000',
    milestone: 'test',
    status_color: 'red',
    temporal_state: 'none',
    track: 'test'
  }]);
  console.log('Result error:', error);
}
test();
