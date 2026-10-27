"""Ticket.html から GitHub Pages 用の index.html を作る（Ticket.html を直したら再実行する）"""
import pathlib, sys
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
s = src.read_text()

CONFIG = """  // ===== 設定（ここだけ書き換える） =====
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbwOZQWB0Kn6lH4wSaknhrFCGK9XzX4omndBeGo65lycxzZCMKBH9kACFQehWMR3XFSJ/exec';
  var BOOT = {
    eventName: 'twilight 缶ビール引換券',
    eventInfo: '2026年11月8日（日）12:00〜18:00　日本武道館 奈良醸造ブース',
    contact: 'shop@narabrewing.com',
    barcode: 'CODE128'
  };
  // ===== 設定ここまで =====

  // Apps Script への問い合わせ（JSONP）。元の google.script.run と同じ形で呼べるようにする
  window.google = { script: { run: (function make(ok, ng) {
    return {
      withSuccessHandler: function (f) { return make(f, ng); },
      withFailureHandler: function (f) { return make(ok, f); },
      lookupTicket: function (o, m) {
        var cb = '__nb_cb' + Date.now() + Math.floor(Math.random() * 1000);
        var s = document.createElement('script');
        var timer = setTimeout(function () { finish(); ng && ng(new Error('TIMEOUT')); }, 20000);
        function finish() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
        window[cb] = function (r) { finish(); ok && ok(r); };
        s.onerror = function () { finish(); ng && ng(new Error('NETWORK')); };
        s.src = GAS_URL + '?p=ticket_lookup&o=' + encodeURIComponent(o) + '&m=' + encodeURIComponent(m) + '&cb=' + cb;
        document.head.appendChild(s);
      }
    };
  })() } };
"""
assert '  var BOOT = <?!= bootJson ?>;\n' in s
s = s.replace('  var BOOT = <?!= bootJson ?>;\n', CONFIG)
s = s.replace('<base target="_top">\n', '')
s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>引換券｜奈良醸造</title>', 1)
assert '<?' not in s
out.write_text(s)
print('wrote', out)
