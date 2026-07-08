import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

// Next.jsのビルド時静的解析を無効化（実行時にのみ動作させる）
export const dynamic = "force-dynamic";

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resendをここで動的にimportして初期化（ビルド時の実行を避ける）
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: profiles, error } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, reminder_email")
    .eq("email_reminder", true)
    .not("reminder_email", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const profile of profiles || []) {
    if (!profile.reminder_email) continue;
    try {
      await resend.emails.send({
        from: "MyBanker <noreply@mybanker-app.vercel.app>",
        to: profile.reminder_email,
        subject: "【MyBanker】今月の資産を記録しましょう",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1F2630;">
            <h2 style="font-size: 20px; margin-bottom: 8px;">今月の資産を記録しましょう</h2>
            <p style="color: #5C6862; line-height: 1.7;">
              月初めの資産記録のタイミングをお知らせします。<br>
              記録を続けると、実際の資産の推移とシミュレーションとの比較が見えてきます。
            </p>
            <a href="https://mybanker-app.vercel.app" style="display: inline-block; margin-top: 20px; background: #1F2630; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px;">
              MyBankerを開く →
            </a>
            <p style="margin-top: 32px; font-size: 11px; color: #9AA6A0;">
              このメールは MyBanker の「月初めリマインド」設定をオンにしているユーザーに送られています。<br>
              設定オフは アプリ内「その他 → 設定」から変更できます。
            </p>
          </div>
        `,
      });
      sent++;
    } catch (e) {
      console.error("mail error", profile.reminder_email, e.message);
    }
  }

  return NextResponse.json({ sent, total: (profiles || []).length });
}
