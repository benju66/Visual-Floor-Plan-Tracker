import { createClient } from '@supabase/supabase-js';

// Using your provided project URL and Publishable (anon) Key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pmccdxmuszuykawvlphj.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_NxweMCXpjLfVMoABNA0QvA_LP1OrM3P';

export const supabase = createClient(supabaseUrl, supabaseKey);