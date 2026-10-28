# 奈良醸造 イベント引換券ページ

カラーミーショップで購入した引換券（バーコード）を表示するページです。GitHub Pages で公開します。

- 公開URL：https://narabrewing2018.github.io/nara-ticket/
- お客様が受注番号とメールアドレスを入力すると、Google Apps Script（管理シート）に問い合わせて引換券を表示します。
- このリポジトリには個人情報や合言葉は含まれていません。

## 設定

`index.html` の「設定」の部分を書き換えます。

| 項目 | 内容 |
|---|---|
| `GAS_URL` | 管理シートの［引換券システム］→［URLを表示］の「Apps ScriptのURL」（…/exec） |
| `eventName` | ページの見出し |
| `eventInfo` | 引換日時・場所 |
| `contact` | お問い合わせ先 |

`index.html` は Apps Script 側の `Ticket.html` から `build_pages.py` で作っています。画面を直すときは `Ticket.html` を直してから作り直します。

## フォルダ

| 場所 | 中身 |
|---|---|
| `index.html` | お客様用の引換券ページ（GitHub Pages で公開） |
| `staff/index.html` | スタッフ用のスキャン画面。管理シートの［URLを表示］のQRコード（合言葉つき）から開く。合言葉はリポジトリに含まない |
| `gas/` | 管理用スプレッドシートの Apps Script（Code.gs・Staff.html・Ticket.html）。合言葉やトークンは含まない（実行時に Google 側へ保存） |
| `offline/Offline.html` | 通信できないとき用のオフライン照合ページ。PC は保存して開く。スマホはスキャン画面の［オフライン照合へ］から開く（合言葉・端末名を引き継ぐ） |
| `offline/sw.js` | オフライン照合ページを端末に保存し、オフライン中でも再読み込みできるようにする。ページを直したら `VERSION` を上げる |
