import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

// 「アカウント削除」は、ログインできなくする処理。
// データ自体（user_profilesの行）はそのまま残し、分析・改善目的のために保持する。
export async function POST(req) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    const randomSuffix = Math.random().toString(36).slice(2, 10);
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: `deleted-${userId}-${randomSuffix}@mybanker.invalid`,
      password: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      ban_duration: "876000h", // 約100年間ログイン不可（実質永久停止）
    });

    await supabaseAdmin.from("user_profiles").update({ account_deleted: true }).eq("user_id", userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
