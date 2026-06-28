import dynamic from "next/dynamic";

// recharts等はブラウザ専用のため、サーバー側でレンダリングしない設定にする
const MyBanker = dynamic(() => import("../components/MyBanker"), { ssr: false });

export default function Home() {
  return (
    <main>
      <MyBanker />
    </main>
  );
}
