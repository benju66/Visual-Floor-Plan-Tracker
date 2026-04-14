import { createClient } from '@supabase/supabase-js';

// Using your provided project URL and Publishable (anon) Key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pmccdxmuszuykawvlphj.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_NxweMCXpjLfVMoABNA0QvA_LP1OrM3P';

export const supabase = createClient(supabaseUrl, supabaseKey);