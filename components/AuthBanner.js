"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, upgradeToEmailAccount, signInWithEmail, signOut, ensureUser } from "../lib/storage";

export default function AuthBanner() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState(null); // null | "signup" | "login"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    ensureUser()
      .then(() => getCurrentUser())
      .then(setUser);
  }, []);

  const isAnonymous = !user?.email;

  const handleSignup = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await ensureUser(); // セッションが無い場合に備えて、登録の直前にも必ず確保する
      await upgradeToEmailAccount(email, password);
      setMessage("登録しました。確認メールが届いていれば、リンクを開いて認証してください。");
      const u = await getCurrentUser();
      setUser(u);
      setMode(null);
    } catch (err) {
      setMessage("エラー: " + err.message);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await signInWithEmail(email, password);
      window.location.reload();
    } catch (err) {
      setMessage("エラー: " + err.message);
    }
  };

  if (!isAnonymous) {
    return (
      <div style={styles.bar}>
        <span style={styles.text}>{user.email} でログイン中</span>
        <button style={styles.linkBtn} onClick={() => signOut().then(() => window.location.reload())}>
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <div style={styles.bar}>
      {!mode && (
        <>
          <span style={styles.text}>このデータは今のブラウザ・端末に保存されています。</span>
          <button style={styles.linkBtn} onClick={() => setMode("signup")}>
            登録してデータを保護する
          </button>
          <button style={styles.linkBtnGhost} onClick={() => setMode("login")}>
            既存アカウントでログイン
          </button>
        </>
      )}
      {mode === "signup" && (
        <form onSubmit={handleSignup} style={styles.form}>
          <input style={styles.input} type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="パスワード（6文字以上）" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          <button style={styles.submitBtn} type="submit">登録する</button>
          <button style={styles.linkBtnGhost} type="button" onClick={() => setMode(null)}>キャンセル</button>
        </form>
      )}
      {mode === "login" && (
        <form onSubmit={handleLogin} style={styles.form}>
          <input style={styles.input} type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button style={styles.submitBtn} type="submit">ログイン</button>
          <button style={styles.linkBtnGhost} type="button" onClick={() => setMode(null)}>キャンセル</button>
        </form>
      )}
      {message && <span style={styles.message}>{message}</span>}
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    background: "#FBF8F0",
    borderBottom: "1px solid #E3DAC2",
    padding: "10px 16px",
    fontSize: 12.5,
    fontFamily: "'Source Sans 3', sans-serif",
  },
  text: { color: "#6B6248" },
  linkBtn: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  linkBtnGhost: { background: "transparent", color: "#1F2630", border: "1px solid #D8E2DA", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: { border: "1px solid #D8E2DA", borderRadius: 8, padding: "6px 10px", fontSize: 12.5 },
  submitBtn: { background: "#B5582E", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" },
  message: { color: "#9A4A1F", fontSize: 11.5 },
};
