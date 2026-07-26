# 🎯 早押しクイズWebアプリ

教室で使えるリアルタイム早押しクイズアプリです。
**GitHub Pagesで無料公開**できます！

## 🚀 セットアップ手順

### 1. Firebaseプロジェクト作成（無料）

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」→ 名前を入力（例: `buzzer-quiz`）
3. Google Analytics は無効でOK → 「プロジェクトを作成」

### 2. Realtime Database を有効化

1. 左メニュー「Realtime Database」→「データベースを作成」
2. ロケーション: `asia-southeast1` または `us-central1`
3. **「テストモードで開始」**を選択（30日間読み書き可能）
4. 「有効にする」

### 3. Firebase設定を取得

1. 左上の歯車⚙️ →「プロジェクトの設定」
2. 「マイアプリ」→「</>」（Webアプリ追加）
3. アプリ名入力 → 「アプリを登録」
4. 表示された `firebaseConfig` をコピー

### 4. アプリに設定を貼り付け

`docs/js/firebase-app.js` を開いて、上部の設定を書き換え:

```javascript
const firebaseConfig = {
    apiKey: "あなたのAPIキー",
    authDomain: "あなたのプロジェクト.firebaseapp.com",
    databaseURL: "https://あなたのプロジェクト-default-rtdb.firebaseio.com",
    projectId: "あなたのプロジェクト",
    storageBucket: "あなたのプロジェクト.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};
```

### 5. GitHubにアップロード

GitHub Desktopで:
1. 「Add」→「Add Existing Repository」
2. `/Users/yasuki/Documents/GitHub/BuzzerQuiz` フォルダを選択
3. または 新規リポジトリ「buzzer-quiz」を作成
4. 変更内容をコミット → Publish

### 6. GitHub Pagesを有効化

1. GitHubリポジトリ → Settings → Pages
2. Source: 「Deploy from a branch」
3. Branch: `main` / `/docs`
4. Save

数分後、`https://ysk314.github.io/buzzer-quiz/` で公開！

---

## 📁 フォルダ構成

```
BuzzerQuiz/
├── docs/                ← GitHub Pagesで公開するオンライン版
│   ├── index.html       # トップページ
│   ├── host.html        # ホスト画面
│   ├── player.html      # プレイヤー画面
│   ├── css/styles.css   # スタイル
│   └── js/firebase-app.js # Firebase連携
├── local/               # このMacをサーバーにして遊ぶローカル版
├── server/              # ローカル版のNode.jsサーバー
└── start-local.command  # ローカル版起動用
```

---

## 🎮 使い方

### ホスト
1. 「ルームを作る」→ ルームコード＆PIN取得
2. PIN入力でホスト画面へ
3. 「クイズスタート」または「回答再開」で早押し開始 → 「○」「×」で判定

### プレイヤー
1. ルームコード入力 or QRスキャン
2. 名前を選んで参加
3. 早押しボタンをタップ！

### ローカル版
1. `start-local.command` をダブルクリック
2. ホスト画面でルームを作成
3. 表示されたQRコードを同じWi-FiのiPadで読み取って参加

#### ローカル版の公平性対策

- ホストが開始を押してから1秒後を、全端末共通の受付開始時刻として予約します。
- プレイヤー端末はサーバーと時刻同期し、端末で押した瞬間の時刻をサーバー時刻に変換して比較します。
- 同期がまだ十分でない場合は、従来どおり通信往復時間を使った補正にフォールバックします。
- ホスト画面の参加者一覧には、端末ごとの通信状態を表示します。

---

## ⚠️ 注意事項

- Firebaseの「テストモード」は30日で期限切れ → ルールを更新必要
- 長期運用する場合はセキュリティルールを設定してください
