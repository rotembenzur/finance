import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = 'https://gkebcozgbczxrjakkknx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I';
export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
