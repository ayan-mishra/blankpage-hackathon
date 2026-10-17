import { createClient } from '@supabase/supabase-js';
import { isGuest } from './guest.js';

// Public browser configuration; database policies enforce access.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://czixliadrvvdooktoahe.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Pe3kgh3XRrENKdIPAXTwQA_NI9cQxhc';
export const supabase = !isGuest() && url && key ? createClient(url, key) : null;
