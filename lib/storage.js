import { supabase } from "./supabaseClient";

let cachedUserId = null;

// 初めて開いたユーザーは「匿名ユーザー」として自動的にログインさせる。
// これにより、登録なしで今まで通りすぐにアプリを使い始められる。
// 後から「登録する」ボタンでメールアドレス等を連携すると、このデータはそのまま引き継がれる。
async function ensureUser() {
  if (cachedUserId) return cachedUserId;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.user) {
    cachedUserId = sessionData.session.user.id;
    return cachedUserId;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  cachedUserId = data.user.id;
  return cachedUserId;
}

async function loadRow(userId) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.data || {};
}

// window.storage と同じ呼び出し方（get/set/delete/list）ができるオブジェクト。
// 既存のアーティファクトのコードを、ほぼそのまま使えるようにするためのアダプター。
export const storage = {
  async get(key) {
    const userId = await ensureUser();
    const row = await loadRow(userId);
    if (row[key] === undefined) {
      throw new Error("not found");
    }
    return { key, value: row[key], shared: false };
  },

  async set(key, value) {
    const userId = await ensureUser();
    const row = await loadRow(userId);
    const nextData = { ...row, [key]: value };
    const { error } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, data: nextData }, { onConflict: "user_id" });
    if (error) throw error;
    return { key, value, shared: false };
  },

  async delete(key) {
    const userId = await ensureUser();
    const row = await loadRow(userId);
    const nextData = { ...row };
    delete nextData[key];
    const { error } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, data: nextData }, { onConflict: "user_id" });
    if (error) throw error;
    return { key, deleted: true, shared: false };
  },

  async list(prefix = "") {
    const userId = await ensureUser();
    const row = await loadRow(userId);
    const keys = Object.keys(row).filter((k) => k.startsWith(prefix));
    return { keys, prefix, shared: false };
  },
};

// 匿名ユーザーから、メールアドレス付きの本登録ユーザーへアップグレードする。
// これを呼ぶと、今までのデータ（匿名ユーザーのuser_id）はそのまま新しいログイン方法に引き継がれる。
export async function upgradeToEmailAccount(email, password) {
  const { data, error } = await supabase.auth.updateUser({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedUserId = data.user.id;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  cachedUserId = null;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}
