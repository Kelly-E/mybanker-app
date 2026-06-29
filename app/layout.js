export const metadata = {
  title: "MyBanker",
  description: "資産形成を、もっと楽しく。自分の立ち位置がわかる資産管理サービス。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
