import dynamic from "next/dynamic";
import AuthBanner from "../components/AuthBanner";

// recharts等はブラウザ専用のため、サーバー側でレンダリングしない設定にする
const MyBanker = dynamic(() => import("../components/MyBanker"), { ssr: false });

export default function Home() {
  return (
    <main>
      <AuthBanner />
      <MyBanker />
    </main>
  );
}
