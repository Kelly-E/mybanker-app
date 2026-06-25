import { createClient } from "@supabase/supabase-js";

// このクライアントはサーバー側（APIルート）でのみ使用する。
// service role keyはRLSを無視できる強力な権限を持つため、絶対にブラウザ側のコードに含めないこと。
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
