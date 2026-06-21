export const metadata = {
  title: "MyBanker",
  description: "たまる、ふえる、心地いい。あなた専用のマネープランナー。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
