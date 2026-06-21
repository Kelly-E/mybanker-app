# MyBanker セットアップ手順

## 1. Supabaseの設定

### テーブルとセキュリティの作成
1. Supabaseダッシュボードの左メニューから「SQL Editor」を開く
2. `schema.sql` の内容を貼り付けて実行（Run）

### 匿名ログインを有効にする（重要・これをやらないと動きません）
1. 左メニューの「Authentication」→「Sign In / Providers」を開く
2. 「Anonymous Sign-Ins」という項目を探し、有効化（Enable）する

### メール認証の確認設定（任意）
- 「Authentication」→「Sign In / Providers」→「Email」で、確認メールの送信設定を確認できます
- 初期設定のままでも動作確認は可能です

## 2. ローカルでの動作確認

```bash
npm install
cp .env.local.example .env.local
# .env.local を開いて、実際のSupabaseのURLとキーになっているか確認
npm run dev
```

`http://localhost:3000` を開いて動作確認してください。

## 3. GitHubへアップロード

```bash
git init
git add .
git commit -m "initial commit"
```

GitHub上で新しいリポジトリを作成し、案内されるコマンドでpushしてください。

## 4. Vercelで公開

1. https://vercel.com にアクセスし、GitHubでサインアップ
2. 「Add New」→「Project」から、先ほどのGitHubリポジトリを選択
3. 環境変数の設定画面で、`.env.local` と同じ内容（`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY`）を入力
4. 「Deploy」をクリック

数分で公開され、`https://（プロジェクト名）.vercel.app` のようなURLが発行されます。

## 5. 今後の更新の流れ

コードを修正したら：
```bash
git add .
git commit -m "修正内容"
git push
```

これだけで、Vercelが自動的に新しいバージョンを再公開します。
