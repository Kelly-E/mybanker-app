"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SectionLabel } from "@/components/ui/Basics";
import type { EventRow } from "@/lib/types";

type Teammate = { role: string; profiles: { id: string; nickname: string; job: string | null } };

export default function RosterInvite({ event, members }: { event: EventRow; members: Teammate[] }) {
  const supabase = createClient();
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(members.length < event.size);

  useEffect(() => {
    supabase
      .from("invites")
      .select("token")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setToken(data.token);
      });
  }, [event.id]);

  async function createInvite() {
    setCreating(true);
    const { data, error } = await supabase.rpc("create_invite", { p_event_id: event.id });
    setCreating(false);
    if (!error && data) setToken((data as any).token);
  }

  const inviteUrl = token ? `${process.env.NEXT_PUBLIC_SITE_URL}/join/${token}` : null;
  const emptySlots = Math.max(0, event.size - members.length);

  return (
    <div style={{ background: "#fff", border: "1px solid #E4E2DB" }} className="rounded-xl p-4 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between">
        <SectionLabel sub={`${members.length}/${event.size}人 確定`}>メンバー</SectionLabel>
        <span style={{ color: "#8A93A5" }} className="text-[12px]">
          {open ? "閉じる ▴" : "開く ▾"}
        </span>
      </button>

      {open && (
        <div className="space-y-3">
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.profiles.id}
                style={{ background: "#fff", border: `1px solid ${m.role === "host" ? "#E4E2DB" : "#4A7C59"}` }}
                className="rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <div
                  style={{ background: m.role === "host" ? "#D93A2B" : "#33415C" }}
                  className="w-10 h-10 rounded-full text-white text-sm font-bold flex items-center justify-center"
                >
                  {m.profiles.nickname[0]}
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-bold" style={{ color: "#22304A" }}>
                    {m.profiles.nickname}
                    {m.role === "host" ? "(幹事)" : ""}
                  </p>
                  <p className="text-[12px]" style={{ color: "#8A93A5" }}>
                    {m.profiles.job ?? "未設定"}
                  </p>
                </div>
                {m.role !== "host" && (
                  <span style={{ color: "#4A7C59", border: "1px solid #4A7C59" }} className="text-[10px] px-2 py-0.5 rounded-full">
                    本人登録済み
                  </span>
                )}
              </div>
            ))}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={`empty-${i}`}
                style={{ background: "#FAFAF8", border: "1.5px dashed #E4E2DB" }}
                className="rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <div style={{ background: "#E4E2DB" }} className="w-10 h-10 rounded-full flex items-center justify-center text-[#8A93A5] text-[11px]">
                  ?
                </div>
                <p className="text-[13px]" style={{ color: "#8A93A5" }}>
                  未確定(招待リンクから参加待ち)
                </p>
              </div>
            ))}
          </div>

          <div style={{ background: "#FAFAF8", border: "1.5px dashed #D93A2B" }} className="rounded-xl p-3 space-y-2">
            <p className="text-[12.5px] font-bold" style={{ color: "#22304A" }}>
              招待リンク(何度でも・誰にでも送れます)
            </p>
            {!inviteUrl ? (
              <button
                onClick={createInvite}
                disabled={creating}
                style={{ background: "#D93A2B" }}
                className="w-full rounded-lg py-2.5 text-white text-[13px] font-bold active:scale-[.98] transition-transform"
              >
                {creating ? "作成中…" : "招待リンクを作成する"}
              </button>
            ) : (
              <div style={{ background: "#EEF1F6", border: "1px solid #E4E2DB" }} className="rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-mono truncate" style={{ color: "#22304A" }}>
                  {inviteUrl}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  style={{ background: copied ? "#4A7C59" : "#22304A" }}
                  className="text-white text-[11px] font-bold px-2.5 py-1.5 rounded-md shrink-0"
                >
                  {copied ? "コピー済み" : "コピー"}
                </button>
              </div>
            )}
            <p className="text-[11px]" style={{ color: "#8A93A5" }}>
              このリンクは同性のユーザーのみ参加できます。人数が揃うまで、欠員が出た場合の差し替えにも使えます。
            </p>
          </div>

          {emptySlots > 0 && (
            <p className="text-[11.5px] leading-relaxed" style={{ color: "#D93A2B" }}>
              メンバー全員(あと{emptySlots}人)が揃うまでは、相手からの申し込みを承諾できません。申し込み自体は今の時点でも受けられます。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
