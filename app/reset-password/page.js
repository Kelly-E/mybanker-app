"use client";

import { useState } from "react";
import { updatePassword } from "../../lib/storage";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (password.length < 6) {
      setMessage("パスワードは6文字以上にしてください。");
      return;
    }
    if (password !== confirm) {
      setMessage("パスワードが一致しません。");
      return;
    }
    try {
      await updatePassword(password);
      setMessage("パスワードを更新しました。");
      setDone(true);
    } catch (err) {
      setMessage("エラー: " + err.message + "（メールのリンクが期限切れの可能性があります。もう一度パスワード再設定をお試しください）");
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>新しいパスワードを設定</h1>
        {!done ? (
          <form onSubmit={handleSubmit} style={styles.form}>
            <input
              style={styles.input}
              type="password"
              placeholder="新しいパスワード（6文字以上）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="新しいパスワード（確認）"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={6}
              required
            />
            <button style={styles.button} type="submit">更新する</button>
          </form>
        ) : (
          <a href="/" style={styles.button}>アプリに戻る</a>
        )}
        {message && <p style={styles.message}>{message}</p>}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#EAF2EC", fontFamily: "'Source Sans 3', 'Hiragino Sans', sans-serif", padding: 16 },
  card: { background: "#FBF8F0", borderRadius: 16, padding: "32px 28px", maxWidth: 380, width: "100%" },
  title: { fontFamily: "'Fraunces', serif", fontSize: 20, color: "#1F2630", marginBottom: 20 },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: { border: "1px solid #D8E2DA", borderRadius: 8, padding: "10px 12px", fontSize: 14 },
  button: { background: "#1F2630", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 14, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "block" },
  message: { marginTop: 14, fontSize: 12.5, color: "#9A4A1F" },
};
