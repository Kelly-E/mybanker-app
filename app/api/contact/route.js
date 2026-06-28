import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const { name, email, message } = await req.json();
    if (!message || !message.trim()) {
      return NextResponse.json({ error: "内容を入力してください" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("contact_messages").insert({
      name: name || null,
      email: email || null,
      message,
    });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
