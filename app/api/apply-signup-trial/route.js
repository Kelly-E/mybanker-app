import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

// 会員登録（メールアドレス登録）の直後に1回だけ呼ばれる。
// 既に特典を受け取っていなければ、30日間のプレミアム無料期間を付与する。
export async function POST(req) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("trial_granted, is_premium")
      .eq("user_id", userId)
      .maybeSingle();

    if (profile?.trial_granted) {
      return NextResponse.json({ granted: false, reason: "already_granted" });
    }

    const until = new Date();
    until.setDate(until.getDate() + 30);

    await supabaseAdmin
      .from("user_profiles")
      .update({ is_premium: true, premium_until: until.toISOString(), premium_source: "trial", trial_granted: true })
      .eq("user_id", userId);

    return NextResponse.json({ granted: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
