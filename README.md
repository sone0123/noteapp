# NoteApp

ブラウザで動く，手書き中心のシンプルなノートアプリです。

## 現在の状態

HTML / CSS / JavaScriptだけで動く最小版です。

- ノートの新規作成
- タイトル編集
- キャンバスへの手書き
- ペン
- 消しゴム
- 色変更
- 線幅変更
- undo / redo
- ページクリア
- ノート削除
- タイトル検索
- 更新日時表示
- `localStorage` への自動保存

まだPWA化，Service Worker，IndexedDB，エクスポート/インポート，複数ページは未実装です。

## 動かし方

`index.html` をブラウザで開きます。

開発用サーバーで確認する場合:

```sh
python3 -m http.server 5173
```

その後，ブラウザで `http://localhost:5173` を開きます。

## 次にやること

1. タブレットで手書きの遅延と操作感を確認する
2. エクスポート/インポートを追加する
3. `manifest.webmanifest` を追加する
4. Service Workerでオフライン対応する
5. 保存先を `localStorage` から `IndexedDB` に移す
