import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "MyBanker",
  description: "資産形成を、もっと楽しく。",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#EAF2EC" />
      </head>
      <body style={{ margin: 0, WebkitTapHighlightColor: "transparent" }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
