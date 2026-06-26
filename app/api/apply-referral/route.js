import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const { userId, referralCode } = await req.json();
    if (!userId || !referralCode) {
      return NextResponse.json({ error: "userId and referralCode are required" }, { status: 400 });
    }

    // 既に紹介を適用済みなら、二重付与を防ぐため何もしない
    const { data: me } = await supabaseAdmin
      .from("user_profiles")
      .select("referred_by")
      .eq("user_id", userId)
      .maybeSingle();

    if (me?.referred_by) {
      return NextResponse.json({ applied: false, reason: "already_applied" });
    }

    // 自分自身のコードを入れた場合は無視（不正防止）
    const { data: referrer } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id, is_premium, premium_until")
      .eq("referral_code", referralCode)
      .maybeSingle();

    if (!referrer || referrer.user_id === userId) {
      return NextResponse.json({ applied: false, reason: "invalid_code" });
    }

    // 紹介された側に「誰に紹介されたか」を記録（同じコードでの再付与を防ぐ）
    await supabaseAdmin.from("user_profiles").update({ referred_by: referrer.user_id }).eq("user_id", userId);

    // 紹介した側に1ヶ月分の無料期間を付与
    const base = referrer.premium_until ? new Date(referrer.premium_until) : new Date();
    const newUntil = new Date(base > new Date() ? base : new Date());
    newUntil.setMonth(newUntil.getMonth() + 1);

    await supabaseAdmin
      .from("user_profiles")
      .update({ is_premium: true, premium_until: newUntil.toISOString() })
      .eq("user_id", referrer.user_id);

    return NextResponse.json({ applied: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
