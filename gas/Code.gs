/**
 * 奈良醸造 イベントグッズ引換券システム
 *
 * ・お客様ページ：注文番号＋メールアドレスで引換券（QR／バーコード）を表示
 * ・スキャン画面：専用スキャナで読み取り → 1回だけ「引換済」にする（複数台同時OK）
 * ・カラーミーショップAPIから引換券商品の注文を取り込み、注文ごとに12桁のコードを発行
 *
 * シート：「引換券」「ログ」「設定」（メニュー［引換券システム］→［初期設定］で作成）
 */

// ===================== 定数 =====================

const SHEET_TICKETS = '引換券';
const SHEET_LOG = 'ログ';
const SHEET_CONFIG = '設定';
const SHEET_PRINT = '当日リスト';
const SHEET_SEEN = '取込済み受注';   // 引換券を含まないと確認済みの受注番号（明細を取り直さないため）

const HEADERS = ['引換コード', '受注番号', '受注日時', '氏名', 'メールアドレス', '引換内容', '点数',
  '状態', '引換日時', '端末', '発行日時', '備考'];
const COL = { CODE: 0, ORDER: 1, ORDER_DATE: 2, NAME: 3, MAIL: 4, ITEMS: 5, QTY: 6,
  STATUS: 7, USED_AT: 8, TERMINAL: 9, ISSUED_AT: 10, NOTE: 11 };
const STATUS = { UNUSED: '未使用', USED: '引換済', UNPAID: '入金待ち', VOID: '無効' };

const LOG_HEADERS = ['日時', '端末', '操作', '結果', '引換コード', '受注番号', '詳細'];

const CODE_LENGTH = 12;
const API_BASE = 'https://api.shop-pro.jp';
const TZ = 'Asia/Tokyo';

/** 「設定」シートの項目（キー, 既定値, 説明） */
const CONFIG_ITEMS = [
  ['対象商品ID', '', 'カラーミーの引換券商品の商品ID。複数ある場合はカンマ区切り（例: 123456789,123456790）'],
  ['受注の検索開始日', '', '引換券の販売開始日（例: 2026-10-28）。この日以降の注文だけを取り込む'],
  ['入金済みのみ発行', 'FALSE', 'FALSE＝注文直後から表示（クレジットカード・Amazon Pay のみの場合）。TRUE＝カラーミーで「入金済み」になった注文だけ表示'],
  ['イベント名', '', 'お客様ページとスキャン画面の見出し'],
  ['引換日時・場所', '', 'お客様ページに表示（例: 11月8日（日）10:00〜16:00 ／ 会場内 奈良醸造ブース）'],
  ['お問い合わせ先', 'info@narabrewing.com', 'お客様ページの下部に表示'],
  ['WebアプリURL', '', 'デプロイ画面に表示されたウェブアプリのURL（…/exec）。カラーミー連携とURL表示に使う。空ならApps Scriptが返すURLを使う'],
  ['バーコード表示', 'CODE128', 'CODE128（1次元バーコードのみ。NETUM NT-1228BC 等のCCDスキャナ用）／ QR+CODE128 ／ QR'],
];

// ===================== メニュー =====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('引換券システム')
    .addItem('① 初期設定（シート作成）', 'setupSheets')
    .addSeparator()
    .addItem('② カラーミー連携を開始', 'colormeConnect')
    .addItem('　 認可コードを手入力', 'colormeEnterCode')
    .addItem('　 接続テスト', 'colormeTest')
    .addSeparator()
    .addItem('今すぐ注文を取り込む', 'syncOrdersFromMenu')
    .addItem('自動取り込みをオン（5分ごと）', 'enableAutoSync')
    .addItem('自動取り込みをオフ', 'disableAutoSync')
    .addSeparator()
    .addItem('URLを表示（お客様用・スキャン用）', 'showUrls')
    .addItem('スキャン用の合言葉を作り直す', 'resetStaffKey')
    .addItem('当日リスト（紙の控え）を作成', 'buildPrintList')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();

  let t = ss.getSheetByName(SHEET_TICKETS) || ss.insertSheet(SHEET_TICKETS);
  if (t.getLastRow() === 0) {
    t.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#F5F3EE');
    t.setFrozenRows(1);
    t.getRange('A:B').setNumberFormat('@');           // コード・受注番号は文字列で保持
    t.getRange('C:C').setNumberFormat('yyyy/mm/dd hh:mm');
    t.getRange('I:I').setNumberFormat('yyyy/mm/dd hh:mm:ss');
    t.getRange('K:K').setNumberFormat('yyyy/mm/dd hh:mm');
    t.setColumnWidth(1, 120); t.setColumnWidth(6, 320); t.setColumnWidth(12, 200);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.UNUSED, STATUS.USED, STATUS.UNPAID, STATUS.VOID], true).build();
    t.getRange(2, COL.STATUS + 1, 1999, 1).setDataValidation(rule);
  }

  let l = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);
  if (l.getLastRow() === 0) {
    l.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold').setBackground('#F5F3EE');
    l.setFrozenRows(1);
    l.getRange('E:F').setNumberFormat('@');
    l.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm:ss');
  }

  let c = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  if (c.getLastRow() === 0) {
    c.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold').setBackground('#F5F3EE');
    c.getRange(2, 1, CONFIG_ITEMS.length, 3).setValues(CONFIG_ITEMS);
    c.getRange(2, 2, CONFIG_ITEMS.length, 1).setNumberFormat('@');
    c.setColumnWidth(1, 160); c.setColumnWidth(2, 320); c.setColumnWidth(3, 520);
  }

  seenSheet_();

  SpreadsheetApp.getUi().alert('シートを作成しました。「設定」シートの値を入力してください。');
}

// ===================== 設定・共通 =====================

let CONFIG_CACHE_ = null;

function getConfig_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONFIG);
  const map = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
      map[String(r[0]).trim()] = String(r[1]).trim();
    });
  }
  const get = function (k) {
    if (map[k] !== undefined && map[k] !== '') return map[k];
    const def = CONFIG_ITEMS.filter(function (i) { return i[0] === k; })[0];
    return def ? def[1] : '';
  };
  CONFIG_CACHE_ = {
    productIds: get('対象商品ID').split(/[,、\s]+/).map(function (s) { return toHalf_(s).replace(/\D/g, ''); })
      .filter(String),
    since: get('受注の検索開始日'),
    requirePaid: !/^(false|いいえ|0|no)$/i.test(get('入金済みのみ発行')),
    eventName: get('イベント名'),
    eventInfo: get('引換日時・場所'),
    contact: get('お問い合わせ先'),
    barcode: (get('バーコード表示') || 'CODE128').toUpperCase(),
    webAppUrl: get('WebアプリURL'),
  };
  return CONFIG_CACHE_;
}

function props_() { return PropertiesService.getScriptProperties(); }

/** ウェブアプリのURL。ScriptApp が別のデプロイのURLを返すことがあるため、「設定」シートの値を優先する */
function webAppUrl_() {
  const v = String(getConfig_().webAppUrl || '').trim();
  if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) return v;
  return ScriptApp.getService().getUrl();
}

function now_() { return new Date(); }

function fmt_(d, pattern) {
  if (!d) return '';
  if (!(d instanceof Date)) return String(d);
  return Utilities.formatDate(d, TZ, pattern || 'yyyy/MM/dd HH:mm');
}

/** 全角英数字・記号を半角に */
function toHalf_(s) {
  return String(s == null ? '' : s)
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/　/g, ' ');
}

function normOrder_(s) { return toHalf_(s).replace(/\D/g, ''); }
function normMail_(s) { return toHalf_(s).trim().toLowerCase(); }
function normCode_(s) { return toHalf_(s).replace(/\D/g, ''); }

function htmlTemplate_(file, vars) {
  const t = HtmlService.createTemplateFromFile(file);
  Object.keys(vars).forEach(function (k) { t[k] = vars[k]; });
  return t.evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** テンプレートに埋め込むJSON（</script> 対策） */
function jsonForHtml_(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// ===================== シート読み書き =====================

function ticketSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_TICKETS);
  if (!sh) throw new Error('「引換券」シートがありません。メニューの［初期設定］を実行してください。');
  return sh;
}

/** 引換券シートを配列で読む（行番号 row は2始まり） */
function readTickets_() {
  const sh = ticketSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues().map(function (v, i) {
    v[COL.CODE] = String(v[COL.CODE]).trim();
    v[COL.ORDER] = String(v[COL.ORDER]).trim();
    return { row: i + 2, v: v };
  }).filter(function (r) { return r.v[COL.CODE] || r.v[COL.ORDER]; });
}

function writeTicketRow_(row, values) {
  ticketSheet_().getRange(row, 1, 1, HEADERS.length).setValues([values]);
}

function appendTickets_(rows) {
  if (!rows.length) return;
  const sh = ticketSheet_();
  const start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, 1, rows.length, 2).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
}

function log_(terminal, action, result, code, order, detail) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  if (!sh) return;
  sh.appendRow([now_(), terminal || '', action, result, String(code || ''), String(order || ''), detail || '']);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('混み合っています。もう一度お試しください。');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/** 推測できない12桁の数字コードを発行（先頭は1〜9、既存と重複しない） */
function newCode_(existing) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ':' + Date.now() + ':' + Math.random());
    let s = '';
    for (let i = 0; i < bytes.length && s.length < CODE_LENGTH; i++) {
      const b = (bytes[i] + 256) % 256;
      if (b >= 250) continue;                 // 0-249 だけ使い、10で割った余りの偏りをなくす
      const d = b % 10;
      if (s.length === 0 && d === 0) continue; // 先頭0を避ける
      s += d;
    }
    if (s.length === CODE_LENGTH && !existing.has(s)) {
      existing.add(s);
      return s;
    }
  }
  throw new Error('コードの発行に失敗しました');
}

// ===================== カラーミーAPI =====================

function api_(path, params) {
  const token = props_().getProperty('COLORME_TOKEN');
  if (!token) throw new Error('カラーミーショップと未連携です。メニューの［カラーミー連携を開始］を実行してください。');
  const qs = params ? Object.keys(params)
    .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&') : '';
  const res = UrlFetchApp.fetch(API_BASE + path + (qs ? '?' + qs : ''), {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  if (status === 404) return null;
  if (status >= 300) throw new Error('カラーミーAPIエラー ' + status + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

function getSale_(id) {
  const r = api_('/v1/sales/' + encodeURIComponent(id) + '.json');
  return r ? (r.sale || r) : null;
}

/** 検索開始日以降の受注をすべて取得 */
function listSales_(since) {
  const all = [];
  const after = since ? toHalf_(since).replace(/\//g, '-') : '';
  for (let offset = 0; offset < 20000; offset += 100) {
    const r = api_('/v1/sales.json', { after: after, limit: 100, offset: offset });
    const list = (r && r.sales) || [];
    Array.prototype.push.apply(all, list);
    if (list.length < 100) break;
  }
  return all;
}

/** 受注から引換券の対象明細を抜き出す。対象が無ければ null */
function voucherInfo_(sale, productIds) {
  const details = (sale.details || []).filter(function (d) {
    return productIds.indexOf(String(d.product_id)) >= 0;
  });
  if (!details.length) return null;
  const items = details.map(function (d) {
    const opts = [d.option1_value, d.option2_value].filter(function (o) { return o; });
    return (d.product_name || '') + (opts.length ? '（' + opts.join(' / ') + '）' : '') + ' ×' + (d.product_num || 1);
  });
  const qty = details.reduce(function (s, d) { return s + Number(d.product_num || 1); }, 0);
  const c = sale.customer || {};
  return {
    order: String(sale.id),
    orderDate: sale.make_date ? new Date(Number(sale.make_date) * 1000) : '',
    name: c.name || '',
    mail: c.mail || '',
    items: items.join(' / '),
    qty: qty,
    canceled: !!sale.canceled,
    paid: !!sale.paid,
  };
}

/** カラーミーの状態から、シートに入れる状態を決める */
function desiredStatus_(info, cfg) {
  if (info.canceled) return STATUS.VOID;
  if (cfg.requirePaid && !info.paid) return STATUS.UNPAID;
  return STATUS.UNUSED;
}

/**
 * 既存行を受注内容で更新する（v を書き換え、変更があれば true）
 * ・引換済は状態を変えない（キャンセルされたら備考に記録）
 * ・備考が「手動」で始まる行は状態を変えない（シートで手動で無効にした場合など）
 */
function applyInfo_(v, info, cfg) {
  const before = JSON.stringify(v);
  v[COL.NAME] = info.name;
  v[COL.MAIL] = info.mail;
  v[COL.ITEMS] = info.items;
  v[COL.QTY] = info.qty;
  if (info.orderDate) v[COL.ORDER_DATE] = info.orderDate;
  const manual = /^手動/.test(String(v[COL.NOTE]));
  if (v[COL.STATUS] === STATUS.USED) {
    if (info.canceled && !/キャンセル/.test(String(v[COL.NOTE]))) {
      v[COL.NOTE] = (v[COL.NOTE] ? v[COL.NOTE] + ' ' : '') + '※引換後にキャンセル';
    }
  } else if (!manual) {
    v[COL.STATUS] = desiredStatus_(info, cfg);
  }
  return JSON.stringify(v) !== before;
}

function newRow_(info, code, cfg) {
  const v = new Array(HEADERS.length).fill('');
  v[COL.CODE] = code;
  v[COL.ORDER] = info.order;
  v[COL.ISSUED_AT] = now_();
  applyInfo_(v, info, cfg);
  return v;
}

/**
 * 受注の取り込み（5分ごとの定期実行・手動実行）
 * ・受注一覧は毎回読む（キャンセル・入金の変化をここで拾う）
 * ・明細（どの商品か）を個別に取りに行くのは、まだ確認していない新しい受注だけ
 *   - 引換券の受注 → 「引換券」シートにある
 *   - 引換券を含まない受注 → 「取込済み受注」シートに受注番号を残し、次回からは見ない
 * ・1回に明細を取りに行くのは最大 MAX_DETAIL_FETCH 件（API の回数制限対策）。残りは次回
 */
const MAX_DETAIL_FETCH = 80;

function syncOrders() {
  const cfg = getConfig_();
  if (!cfg.productIds.length) throw new Error('「設定」シートの［対象商品ID］が空です。');
  const sales = listSales_(cfg.since);

  const known = {};
  readTickets_().forEach(function (r) { known[r.v[COL.ORDER]] = true; });
  const seen = readSeen_();

  const infos = [];        // 新しい引換券の受注
  const flags = {};        // 既存の引換券受注のキャンセル・入金の状態（受注一覧から）
  const newSeen = [];      // 引換券を含まないと分かった受注
  let fetched = 0, deferred = 0;

  sales.forEach(function (s) {
    const id = String(s.id);
    if (known[id]) { flags[id] = { canceled: !!s.canceled, paid: !!s.paid }; return; }
    if (seen[id]) return;
    let sale = s;
    if (!sale.details) {
      if (fetched >= MAX_DETAIL_FETCH) { deferred++; return; }
      sale = getSale_(id);
      fetched++;
      if (!sale) return;
    }
    const info = voucherInfo_(sale, cfg.productIds);
    if (info) infos.push(info); else newSeen.push(id);
  });

  return withLock_(function () {
    const rows = readTickets_();
    const byOrder = {};
    const codes = new Set();
    rows.forEach(function (r) { byOrder[r.v[COL.ORDER]] = r; codes.add(r.v[COL.CODE]); });
    const sh = ticketSheet_();
    const added = [];
    let updated = 0;

    // 既存の引換券：キャンセル・入金の変化だけ反映（明細は取り直さない）
    rows.forEach(function (r) {
      const f = flags[r.v[COL.ORDER]];
      if (f && applyFlags_(r.v, f, cfg)) {
        sh.getRange(r.row, 1, 1, HEADERS.length).setValues([r.v]);
        updated++;
      }
    });

    // 新しい引換券（お客様ページから先に発行済みなら更新だけ）
    infos.forEach(function (info) {
      const r = byOrder[info.order];
      if (r) {
        if (r.row > 0 && applyInfo_(r.v, info, cfg)) { sh.getRange(r.row, 1, 1, HEADERS.length).setValues([r.v]); updated++; }
      } else {
        const v = newRow_(info, newCode_(codes), cfg);
        added.push(v);
        byOrder[info.order] = { row: -1, v: v };
      }
    });
    appendTickets_(added);
    appendSeen_(newSeen);

    const msg = '受注' + sales.length + '件／明細取得' + fetched + '件' + (deferred ? '（' + deferred + '件は次回）' : '') +
      '／新規' + added.length + '・更新' + updated;
    if (added.length || updated || deferred) log_('', '取り込み', 'OK', '', '', msg);
    return { sales: sales.length, fetched: fetched, deferred: deferred, added: added.length, updated: updated };
  });
}

/** 受注一覧のキャンセル・入金の状態だけで既存行を更新（変更があれば true） */
function applyFlags_(v, f, cfg) {
  const before = JSON.stringify(v);
  const manual = /^手動/.test(String(v[COL.NOTE]));
  if (v[COL.STATUS] === STATUS.USED) {
    if (f.canceled && !/キャンセル/.test(String(v[COL.NOTE]))) {
      v[COL.NOTE] = (v[COL.NOTE] ? v[COL.NOTE] + ' ' : '') + '※引換後にキャンセル';
    }
  } else if (!manual) {
    v[COL.STATUS] = desiredStatus_({ canceled: f.canceled, paid: f.paid }, cfg);
  }
  return JSON.stringify(v) !== before;
}

// ---------- 引換券を含まないと確認済みの受注 ----------

function seenSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_SEEN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SEEN);
    sh.getRange(1, 1, 1, 2).setValues([['受注番号', '確認日時']]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function readSeen_() {
  const sh = seenSheet_();
  const out = {};
  const last = sh.getLastRow();
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { if (r[0] !== '') out[String(r[0]).trim()] = true; });
  return out;
}

function appendSeen_(ids) {
  if (!ids.length) return;
  const sh = seenSheet_();
  const start = Math.max(sh.getLastRow(), 1) + 1;
  const t = now_();
  sh.getRange(start, 1, ids.length, 1).setNumberFormat('@');
  sh.getRange(start, 1, ids.length, 2).setValues(ids.map(function (id) { return [id, t]; }));
}

function syncOrdersFromMenu() {
  const r = syncOrders();
  SpreadsheetApp.getUi().alert('取り込み完了\n\n受注 ' + r.sales + ' 件（明細を確認 ' + r.fetched + ' 件' +
    (r.deferred ? '、' + r.deferred + ' 件は次回' : '') + '）\n引換券 新規 ' + r.added + ' 件 ／ 更新 ' + r.updated + ' 件');
}

function enableAutoSync() {
  disableAutoSync(true);
  ScriptApp.newTrigger('syncOrders').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert('5分ごとの自動取り込みをオンにしました。');
}

function disableAutoSync(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncOrders') ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) SpreadsheetApp.getUi().alert('自動取り込みをオフにしました。');
}

// ===================== カラーミー連携（OAuth） =====================

function colormeConnect() {
  const ui = SpreadsheetApp.getUi();
  const p = props_();
  const url = webAppUrl_();
  if (!url) { ui.alert('先にWebアプリとしてデプロイしてください（手順書の手順3）。'); return; }

  const id = ui.prompt('カラーミー連携 1/2', 'クライアントID を貼り付けてください', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('カラーミー連携 2/2', 'クライアントシークレット を貼り付けてください', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;

  p.setProperties({
    COLORME_CLIENT_ID: id.getResponseText().trim(),
    COLORME_CLIENT_SECRET: secret.getResponseText().trim(),
    COLORME_REDIRECT_URI: url,
    OAUTH_PENDING: String(Date.now()),
  });
  const auth = 'https://api.shop-pro.jp/oauth/authorize?client_id=' + encodeURIComponent(id.getResponseText().trim()) +
    '&response_type=code&scope=read_sales&redirect_uri=' + encodeURIComponent(url);
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.7">' +
    '<p>下のリンクを開き、カラーミーショップにログインして［アプリを連携］を押してください。</p>' +
    '<p><a href="' + auth + '" target="_blank">カラーミーショップの認可画面を開く</a></p>' +
    '<p style="color:#666">「連携が完了しました」と表示されれば完了です（15分以内に行ってください）。<br>' +
    '別の画面になった場合は、表示された認可コードをメニュー［認可コードを手入力］で入力してください。</p>' +
    '<p style="color:#666">カラーミー側に登録するリダイレクトURL：<br><code style="word-break:break-all">' + url + '</code></p></div>'
  ).setWidth(520).setHeight(320);
  ui.showModalDialog(html, 'カラーミー連携');
}

function colormeEnterCode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('認可コードを入力', 'カラーミーの認可画面で表示されたコードを貼り付けてください', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  exchangeCode_(r.getResponseText().trim());
  ui.alert('連携が完了しました。続けて［接続テスト］を実行してください。');
}

function exchangeCode_(code) {
  const p = props_();
  const res = UrlFetchApp.fetch(API_BASE + '/oauth/token', {
    method: 'post',
    payload: {
      client_id: p.getProperty('COLORME_CLIENT_ID'),
      client_secret: p.getProperty('COLORME_CLIENT_SECRET'),
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: p.getProperty('COLORME_REDIRECT_URI'),
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('トークン取得に失敗しました: ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error('トークンが返りませんでした: ' + res.getContentText().slice(0, 300));
  p.setProperty('COLORME_TOKEN', json.access_token);
  p.deleteProperty('OAUTH_PENDING');
}

/** カラーミーからのリダイレクト（?code=...）を受ける。連携開始から15分以内だけ受け付ける */
function handleOAuthCallback_(code) {
  const pending = Number(props_().getProperty('OAUTH_PENDING') || 0);
  let msg;
  if (!pending || Date.now() - pending > 15 * 60 * 1000) {
    msg = '連携の受付時間外です。スプレッドシートのメニューから［カラーミー連携を開始］をやり直してください。';
  } else {
    try {
      exchangeCode_(code);
      msg = '連携が完了しました。このタブは閉じて、スプレッドシートで［接続テスト］を実行してください。';
    } catch (e) {
      msg = '連携に失敗しました：' + e.message;
    }
  }
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;font-size:16px;padding:24px">' +
    msg.replace(/</g, '&lt;') + '</p>').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function colormeTest() {
  const ui = SpreadsheetApp.getUi();
  const shop = api_('/v1/shop.json');
  const cfg = getConfig_();
  const sales = api_('/v1/sales.json', { limit: 1 });
  const s = (sales && sales.sales && sales.sales[0]) || null;
  let msg = '接続OK：' + ((shop && shop.shop && (shop.shop.shop_name || shop.shop.name)) || 'ショップ情報を取得しました');
  if (s) {
    msg += '\n\n直近の受注：受注番号 ' + s.id + '（明細 ' + ((s.details || []).length) + ' 行）';
    msg += '\n※この受注番号が、お客様の注文確認メールの「受注番号」と同じか確認してください。';
  }
  if (!cfg.productIds.length) msg += '\n\n［対象商品ID］が未入力です。';
  ui.alert(msg);
}

// ===================== URL・合言葉 =====================

function staffKey_() {
  const p = props_();
  let k = p.getProperty('STAFF_KEY');
  if (!k) {
    k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    p.setProperty('STAFF_KEY', k);
  }
  return k;
}

function resetStaffKey() {
  props_().deleteProperty('STAFF_KEY');
  staffKey_();
  SpreadsheetApp.getUi().alert('合言葉を作り直しました。これまでのスキャン用URLは使えなくなります。［URLを表示］で新しいURLを確認してください。');
}

function showUrls() {
  const url = webAppUrl_();
  if (!url) { SpreadsheetApp.getUi().alert('先にWebアプリとしてデプロイしてください。'); return; }
  const k = staffKey_();
  const esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  const row = function (label, u) {
    return '<p><b>' + label + '</b><br><input style="width:100%;font-size:12px" readonly onclick="this.select()" value="' + esc(u) + '"></p>';
  };
  // スキャン用URLのQRコード（スマホのカメラで読んで開く）。QRは画面内で作り、URLを外部に送らない
  const qr = function (label, u) {
    return '<div class="q"><div class="qr" data-u="' + esc(u) + '"></div><b>' + label + '</b>' +
      '<input readonly onclick="this.select()" value="' + esc(u) + '"></div>';
  };
  const html =
    '<style>body{font-family:sans-serif;font-size:13px;line-height:1.6;margin:0}' +
    '.qs{display:flex;gap:12px;flex-wrap:wrap}.q{flex:1;min-width:150px;text-align:center;border:1px solid #ddd;border-radius:8px;padding:8px}' +
    '.q .qr svg{width:150px;height:150px}.q b{display:block;font-size:15px}.q input{width:100%;font-size:10px;margin-top:4px}' +
    '.warn{color:#B0463B}</style>' +
    '<p class="warn"><b>スタッフ専用です。外部に出さないでください。</b></p>' +
    '<p>スマホのカメラでQRコードを読むと、その端末用のスキャン画面が開きます。</p>' +
    '<div class="qs">' +
    qr('端末A', url + '?p=staff&k=' + k + '&t=A') +
    qr('端末B', url + '?p=staff&k=' + k + '&t=B') +
    qr('端末C', url + '?p=staff&k=' + k + '&t=C') +
    '</div>' +
    row('オフライン照合の設定用（PCの「オフライン照合」に一度だけ貼る）', url + '?p=offline&k=' + k) +
    row('Apps ScriptのURL（GitHubの引換券ページ index.html の GAS_URL に貼る）', url) +
    '<p>お客様にお知らせするURL（メール・商品ページ）は、GitHub Pages の引換券ページです。</p>' +
    '<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>' +
    '<script>document.querySelectorAll(".qr").forEach(function(el){try{var q=qrcode(0,"M");q.addData(el.getAttribute("data-u"));q.make();' +
    'el.innerHTML=q.createSvgTag({cellSize:4,margin:4,scalable:true});}catch(e){el.textContent="QRコードを表示できませんでした";}});</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(640).setHeight(620), 'スキャン用URL');
}

function checkStaffKey_(k) {
  const real = props_().getProperty('STAFF_KEY');
  return !!real && String(k || '') === real;
}

// ===================== Webアプリ =====================

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.code && !p.p) return handleOAuthCallback_(p.code);
  if (p.p === 'offline_list' || p.p === 'offline_push') return offlineApi_(p);
  if (p.p === 'ticket_lookup') return ticketApi_(p);

  const cfg = getConfig_();
  if (p.p === 'staff') {
    if (!checkStaffKey_(p.k)) {
      return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">URLが正しくありません。</p>');
    }
    return htmlTemplate_('Staff', {
      bootJson: jsonForHtml_({ key: p.k, terminal: String(p.t || '').slice(0, 20), eventName: cfg.eventName }),
    }).setTitle('引換スキャン' + (p.t ? '（' + p.t + '）' : ''));
  }
  return htmlTemplate_('Ticket', {
    bootJson: jsonForHtml_({ eventName: cfg.eventName, eventInfo: cfg.eventInfo, contact: cfg.contact, barcode: cfg.barcode }),
  }).setTitle((cfg.eventName ? cfg.eventName + ' ' : '') + '引換券');
}

// ---------- お客様ページ ----------

const NOT_FOUND_MSG = 'ご注文が見つかりませんでした。ご注文番号とメールアドレスをご確認ください。（ご注文直後の場合は数分おいてお試しください）';

/** 注文番号＋メールアドレスで引換券を取得（お客様ページから呼ばれる） */
function lookupTicket(orderInput, mailInput) {
  const order = normOrder_(orderInput);
  const mail = normMail_(mailInput);
  if (!order || order.length > 15 || mail.indexOf('@') < 1) {
    return { ok: false, message: 'ご注文番号（数字）とメールアドレスを入力してください。' };
  }

  // 総当たり対策：同じ注文番号で10分に10回まで
  const cache = CacheService.getScriptCache();
  const ck = 'try_' + order;
  const tries = Number(cache.get(ck) || 0);
  if (tries >= 10) return { ok: false, message: '入力回数が多すぎます。10分ほどおいてからお試しください。' };

  const cfg = getConfig_();
  let rec = findByOrder_(order);

  // 未登録、または入金待ちの場合はカラーミーに直接確認する
  if (!rec || rec.v[COL.STATUS] === STATUS.UNPAID) {
    let sale = null;
    try { sale = getSale_(order); } catch (e) { console.error(e); }
    const info = sale ? voucherInfo_(sale, cfg.productIds) : null;
    if (info && normMail_(info.mail) === mail) rec = upsertFromInfo_(info, cfg);
  }

  if (!rec || normMail_(rec.v[COL.MAIL]) !== mail) {
    cache.put(ck, String(tries + 1), 600);
    return { ok: false, message: NOT_FOUND_MSG };
  }

  const v = rec.v;
  const base = {
    ok: true,
    status: v[COL.STATUS],
    order: v[COL.ORDER],
    name: v[COL.NAME],
    items: String(v[COL.ITEMS]).split(' / ').filter(String),
    qty: v[COL.QTY],
  };
  if (v[COL.STATUS] === STATUS.UNUSED) base.code = v[COL.CODE];
  if (v[COL.STATUS] === STATUS.USED) base.usedAt = fmt_(v[COL.USED_AT], 'M月d日 HH:mm');
  return base;
}

function findByOrder_(order) {
  const rows = readTickets_();
  for (let i = 0; i < rows.length; i++) if (rows[i].v[COL.ORDER] === order) return rows[i];
  return null;
}

/** 1件の受注を登録・更新（お客様ページ経由。ロック内で二重発行を防ぐ） */
function upsertFromInfo_(info, cfg) {
  return withLock_(function () {
    const rows = readTickets_();
    const codes = new Set(rows.map(function (r) { return r.v[COL.CODE]; }));
    const hit = rows.filter(function (r) { return r.v[COL.ORDER] === info.order; })[0];
    if (hit) {
      if (applyInfo_(hit.v, info, cfg)) writeTicketRow_(hit.row, hit.v);
      return hit;
    }
    const v = newRow_(info, newCode_(codes), cfg);
    appendTickets_([v]);
    log_('', '発行', 'OK', v[COL.CODE], v[COL.ORDER], 'お客様ページから');
    return { row: -1, v: v };
  });
}

// ---------- スキャン画面 ----------

function requireStaff_(key) {
  if (!checkStaffKey_(key)) throw new Error('スキャン用URLが無効です。最新のURLを開き直してください。');
}

function ticketView_(v) {
  return {
    code: v[COL.CODE],
    order: v[COL.ORDER],
    name: v[COL.NAME],
    items: String(v[COL.ITEMS]).split(' / ').filter(String),
    qty: v[COL.QTY],
    status: v[COL.STATUS],
    usedAt: fmt_(v[COL.USED_AT], 'HH:mm:ss'),
    usedBy: v[COL.TERMINAL],
    note: v[COL.NOTE],
  };
}

/**
 * 引換（スキャン1回ごとに呼ばれる）
 * 結果: OK / USED（引換済み） / NOT_FOUND / UNPAID / VOID / BAD（読み取りエラー）
 */
function redeem(key, rawCode, terminal) {
  requireStaff_(key);
  const code = normCode_(rawCode);
  terminal = String(terminal || '').slice(0, 20);
  if (code.length !== CODE_LENGTH) {
    log_(terminal, 'スキャン', 'BAD', rawCode, '', '桁数不正');
    return { result: 'BAD', raw: String(rawCode).slice(0, 40) };
  }
  return withLock_(function () {
    const rows = readTickets_();
    const hit = rows.filter(function (r) { return r.v[COL.CODE] === code; })[0];
    if (!hit) {
      log_(terminal, 'スキャン', 'NOT_FOUND', code, '', '');
      return { result: 'NOT_FOUND', code: code };
    }
    const v = hit.v;
    let result;
    if (v[COL.STATUS] === STATUS.UNUSED) {
      v[COL.STATUS] = STATUS.USED;
      v[COL.USED_AT] = now_();
      v[COL.TERMINAL] = terminal;
      writeTicketRow_(hit.row, v);
      result = 'OK';
    } else if (v[COL.STATUS] === STATUS.USED) {
      result = 'USED';
    } else if (v[COL.STATUS] === STATUS.UNPAID) {
      result = 'UNPAID';
    } else {
      result = 'VOID';
    }
    log_(terminal, 'スキャン', result, code, v[COL.ORDER], result === 'USED' ? '既に ' + fmt_(v[COL.USED_AT], 'HH:mm:ss') + ' ' + v[COL.TERMINAL] : '');
    const out = ticketView_(v);
    out.result = result;
    return out;
  });
}

/** 直前の引換の取り消し（誤って別の人の分を引換済にした時など） */
function undoRedeem(key, rawCode, terminal) {
  requireStaff_(key);
  const code = normCode_(rawCode);
  return withLock_(function () {
    const hit = readTickets_().filter(function (r) { return r.v[COL.CODE] === code; })[0];
    if (!hit || hit.v[COL.STATUS] !== STATUS.USED) return { ok: false, message: '取り消せる引換がありません。' };
    const v = hit.v;
    const prev = fmt_(v[COL.USED_AT], 'HH:mm:ss') + ' ' + v[COL.TERMINAL];
    v[COL.STATUS] = STATUS.UNUSED;
    v[COL.USED_AT] = '';
    v[COL.TERMINAL] = '';
    writeTicketRow_(hit.row, v);
    log_(terminal, '取消', 'OK', code, v[COL.ORDER], '取消前: ' + prev);
    return { ok: true, ticket: ticketView_(v) };
  });
}

/** 手入力検索（スマホの電池切れ等）：受注番号・コード・氏名・メールで検索 */
function searchTickets(key, query) {
  requireStaff_(key);
  const q = toHalf_(query).trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, '');
  return readTickets_().filter(function (r) {
    const v = r.v;
    if (digits && digits.length >= 4 && (v[COL.ORDER] === digits || v[COL.CODE] === digits)) return true;
    return String(v[COL.NAME]).toLowerCase().replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) >= 0 ||
      String(v[COL.MAIL]).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 20).map(function (r) { return ticketView_(r.v); });
}

/** 画面上部の集計 */
function getStats(key) {
  requireStaff_(key);
  const s = { total: 0, used: 0, unused: 0, unpaid: 0, void: 0 };
  readTickets_().forEach(function (r) {
    const st = r.v[COL.STATUS];
    if (st === STATUS.USED) { s.used++; s.total++; }
    else if (st === STATUS.UNUSED) { s.unused++; s.total++; }
    else if (st === STATUS.UNPAID) s.unpaid++;
    else if (st === STATUS.VOID) s.void++;
  });
  return s;
}

// ===================== 当日リスト（紙の控え） =====================

function buildPrintList() {
  const ss = SpreadsheetApp.getActive();
  const rows = readTickets_()
    .filter(function (r) { return r.v[COL.STATUS] === STATUS.UNUSED || r.v[COL.STATUS] === STATUS.USED; })
    .sort(function (a, b) { return Number(a.v[COL.ORDER]) - Number(b.v[COL.ORDER]); })
    .map(function (r) {
      return ['□', r.v[COL.ORDER], r.v[COL.NAME], r.v[COL.ITEMS], r.v[COL.QTY],
        String(r.v[COL.CODE]).slice(-4), r.v[COL.STATUS] === STATUS.USED ? '済' : ''];
    });
  let sh = ss.getSheetByName(SHEET_PRINT);
  if (sh) sh.clear(); else sh = ss.insertSheet(SHEET_PRINT);
  const head = [['済', '受注番号', '氏名', '引換内容', '点数', 'コード下4桁', '作成時点']];
  sh.getRange(1, 1, 1, 7).setValues(head).setFontWeight('bold').setBackground('#F5F3EE');
  if (rows.length) {
    sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 6, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 36); sh.setColumnWidth(3, 140); sh.setColumnWidth(4, 360);
  SpreadsheetApp.getUi().alert('「当日リスト」を作成しました（' + rows.length + '件・受注番号順）。\n［ファイル］→［印刷］で印刷してください。');
}


// ===================== オフライン照合（Wi-Fiが使えないとき用のPC） =====================
//
// PCのブラウザで開く「オフライン照合.html」から呼ばれる。ファイルから開いたページでも
// 確実に届くよう、JSONP（<script>での読み込み）で応答する。
//   ?p=offline_list&k=合言葉&cb=関数名        → 引換券の一覧（メール・住所・電話は含めない）
//   ?p=offline_push&k=合言葉&cb=関数名&r=記録  → オフライン中の引換記録を反映
//      r = 「引換コード.引換時刻(UNIX秒).記録ID」をカンマ区切り（1回40件まで）

const OFFLINE_TERMINAL = 'オフライン';

function offlineApi_(p) {
  const cb = String(p.cb || '');
  if (!/^[A-Za-z_$][\w$]{0,40}$/.test(cb)) {
    return ContentService.createTextOutput('// bad callback').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  let body;
  try {
    if (!checkStaffKey_(p.k)) body = { ok: false, error: 'KEY', message: '設定用URLが古いか、正しくありません。最新のURLを貼り直してください。' };
    else if (p.p === 'offline_list') body = offlineList_();
    else body = offlinePush_(String(p.r || ''));
  } catch (err) {
    body = { ok: false, error: 'SERVER', message: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(body) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** PCに持たせる一覧。項目は 引換コード・受注番号・氏名・引換内容・点数・状態・引換時刻・端末 だけ */
function offlineList_() {
  const tickets = readTickets_().filter(function (r) { return r.v[COL.CODE]; }).map(function (r) {
    const v = r.v;
    const used = v[COL.USED_AT] instanceof Date ? v[COL.USED_AT].getTime() : 0;
    return {
      c: v[COL.CODE], o: v[COL.ORDER], n: v[COL.NAME],
      i: String(v[COL.ITEMS]).split(' / ').filter(String), q: v[COL.QTY],
      s: v[COL.STATUS], u: used, t: v[COL.TERMINAL],
    };
  });
  return { ok: true, at: now_().getTime(), eventName: getConfig_().eventName, tickets: tickets };
}

/**
 * オフライン中の引換記録を反映する。何度送っても同じ結果になる（送り直しても二重にならない）。
 * 結果: applied（反映）/ already（送信済み）/ conflict（オンラインでも引換済＝二重引換の可能性）
 *       / not_found / unusable（入金待ち・無効）
 */
function offlinePush_(raw) {
  const recs = raw.split(',').map(function (x) {
    const a = x.split('.');
    return { code: normCode_(a[0]), at: Number(a[1]) * 1000, id: String(a[2] || '').replace(/[^\w-]/g, '').slice(0, 20) };
  }).filter(function (r) { return r.code.length === CODE_LENGTH && r.at > 0 && r.id; }).slice(0, 40);
  if (!recs.length) return { ok: true, results: [] };

  return withLock_(function () {
    const rows = readTickets_();
    const byCode = {};
    rows.forEach(function (r) { byCode[r.v[COL.CODE]] = r; });
    const results = recs.map(function (rec) {
      const hit = byCode[rec.code];
      const when = new Date(rec.at);
      if (!hit) {
        log_(OFFLINE_TERMINAL, 'オフライン反映', 'NOT_FOUND', rec.code, '', '記録ID ' + rec.id);
        return { id: rec.id, code: rec.code, result: 'not_found' };
      }
      const v = hit.v;
      const tag = '[OFF:' + rec.id + ']';
      if (String(v[COL.NOTE]).indexOf(tag) >= 0) return { id: rec.id, code: rec.code, result: 'already' };

      let result;
      if (v[COL.STATUS] === STATUS.UNUSED) {
        v[COL.STATUS] = STATUS.USED;
        v[COL.USED_AT] = when;
        v[COL.TERMINAL] = OFFLINE_TERMINAL;
        result = 'applied';
      } else if (v[COL.STATUS] === STATUS.USED) {
        result = 'conflict';
        v[COL.NOTE] = joinNote_(v[COL.NOTE], '二重引換の可能性：オフライン ' + fmt_(when, 'HH:mm:ss') +
          '／先の引換 ' + fmt_(v[COL.USED_AT], 'HH:mm:ss') + ' ' + v[COL.TERMINAL]);
      } else {
        result = 'unusable';
        v[COL.NOTE] = joinNote_(v[COL.NOTE], 'オフラインで引換（' + fmt_(when, 'HH:mm:ss') + '）時点の状態：' + v[COL.STATUS]);
      }
      v[COL.NOTE] = joinNote_(v[COL.NOTE], tag);
      writeTicketRow_(hit.row, v);
      log_(OFFLINE_TERMINAL, 'オフライン反映', result.toUpperCase(), rec.code, v[COL.ORDER], fmt_(when, 'HH:mm:ss'));
      return { id: rec.id, code: rec.code, result: result, order: v[COL.ORDER], name: v[COL.NAME] };
    });
    return { ok: true, results: results };
  });
}

function joinNote_(note, add) {
  note = String(note || '').trim();
  return note ? note + ' ' + add : add;
}


// ===================== GitHub Pages の引換券ページ用 =====================
//   ?p=ticket_lookup&o=受注番号&m=メールアドレス&cb=関数名  → lookupTicket と同じ結果を JSONP で返す

function ticketApi_(p) {
  const cb = String(p.cb || '');
  if (!/^[A-Za-z_$][\w$]{0,40}$/.test(cb)) {
    return ContentService.createTextOutput('// bad callback').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  let body;
  try { body = lookupTicket(p.o, p.m); }
  catch (err) { console.error(err); body = { ok: false, message: 'ただいま混み合っています。少し時間をおいてお試しください。' }; }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(body) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
