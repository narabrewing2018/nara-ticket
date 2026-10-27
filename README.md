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
