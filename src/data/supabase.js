import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
  throw new Error('Configure both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
