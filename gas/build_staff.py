"""Staff.html から GitHub Pages 用のスキャン画面（staff/index.html）を作る（Staff.html を直したら再実行する）"""
import pathlib, sys, re
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); gas_url = sys.argv[3]
s = src.read_text()

BOOT = """  // ===== 設定 =====
  var GAS_URL = '%s';
  var EVENT_NAME = 'twilight';
  // ===== 設定ここまで =====

  // 合言葉（k）と端末名（t）はURLから受け取り、合言葉はこの端末にだけ保存してアドレス欄から消す
  var BOOT = (function () {
    var q = new URLSearchParams(location.search), k = q.get('k') || '', t = q.get('t') || '';
    try { if (k) localStorage.setItem('nb_staff_key', k); else k = localStorage.getItem('nb_staff_key') || ''; } catch (e) {}
    if (q.get('k')) { try { history.replaceState(null, '', location.pathname + (t ? '?t=' + encodeURIComponent(t) : '')); } catch (e) {} }
    return { key: k, terminal: t, eventName: EVENT_NAME, offlineUrl: '../offline/Offline.html' };
  })();

  // Apps Script への問い合わせ（JSONP）。元の google.script.run と同じ形で呼べるようにする
  var NB_ANON = false;   // ログイン情報を送らない読み込みで通じたら、以後はそちらを使う
  window.google = { script: { run: (function make(ok, ng) {
    var api = { withSuccessHandler: function (f) { return make(f, ng); }, withFailureHandler: function (f) { return make(ok, f); } };
    ['redeem', 'undoRedeem', 'searchTickets', 'getStats'].forEach(function (fn) {
      api[fn] = function () {
        var args = Array.prototype.slice.call(arguments);
        var cb = '__nb_cb' + Date.now() + Math.floor(Math.random() * 100000);
        var s = null, settled = false;
        var timer = setTimeout(function () { finish(); ng && ng(new Error('通信がタイムアウトしました')); }, 20000);
        function finish() { settled = true; clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s && s.parentNode) s.parentNode.removeChild(s); }
        window[cb] = function (r) { finish(); if (r && r.ok) { ok && ok(r.result); } else { ng && ng(new Error((r && r.message) || 'エラーが発生しました')); } };
        // 1回目は通常の読み込み。失敗したら Google のログイン情報を送らない読み込み（crossorigin）でやり直す。
        // スマホのブラウザで Google アカウントが複数ログインしていると、Apps Script がエラーを返すことがあるため
        function load(anon) {
          if (s && s.parentNode) s.parentNode.removeChild(s);
          s = document.createElement('script');
          if (anon) s.crossOrigin = 'anonymous';
          s.onerror = function () {
            if (settled) return;
            if (!anon && !NB_ANON) { load(true); return; }
            finish(); ng && ng(new Error('通信できませんでした（電波を確認してください）'));
          };
          s.onload = function () { if (anon && settled) NB_ANON = true; };
          s.src = GAS_URL + '?p=staff_api&fn=' + fn + '&a=' + encodeURIComponent(JSON.stringify(args)) + '&cb=' + cb;
          document.head.appendChild(s);
        }
        load(NB_ANON);
        return api;
      };
    });
    return api;
  })() } };
""" % gas_url

assert '  var BOOT = <?!= bootJson ?>;\n' in s
s = s.replace('  var BOOT = <?!= bootJson ?>;\n', BOOT)
s = s.replace('<base target="_top">\n', '')
s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<meta name="referrer" content="no-referrer">\n<title>引換スキャン｜奈良醸造</title>', 1)
assert '<?' not in s
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(s)
print('wrote', out)
