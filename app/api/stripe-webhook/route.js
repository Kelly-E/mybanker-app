import { stripe } from "../../../lib/stripeClient";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

async function applyReferralReward(referralCode) {
  if (!referralCode) return;
  const { data: referrer } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, is_premium, premium_until")
    .eq("referral_code", referralCode)
    .maybeSingle();
  if (!referrer) return;

  // 紹介者の有効期限に1ヶ月を追加する（すでにプレミアムなら、その期限から+1ヶ月）
  const base = referrer.premium_until ? new Date(referrer.premium_until) : new Date();
  const newUntil = new Date(base);
  newUntil.setMonth(newUntil.getMonth() + 1);

  await supabaseAdmin
    .from("user_profiles")
    .update({ is_premium: true, premium_until: newUntil.toISOString() })
    .eq("user_id", referrer.user_id);
}

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const referralCode = session.metadata?.referral_code;

      if (userId) {
        await supabaseAdmin.from("user_profiles").update({ is_premium: true }).eq("user_id", userId);
      }
      if (referralCode) {
        await applyReferralReward(referralCode);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      const isActive = sub.status === "active" || sub.status === "trialing";
      if (userId) {
        await supabaseAdmin
          .from("user_profiles")
          .update({
            is_premium: isActive,
            premium_until: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          })
          .eq("user_id", userId);
      }
    }
  } catch (err) {
    console.error("webhook handling error:", err);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
