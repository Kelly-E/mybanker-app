import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "MyBanker",
  description: "資産形成を、もっと楽しく。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
