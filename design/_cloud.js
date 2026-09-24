/* 「よく書いている言葉」の雲の試作で 3 案が共有するもの。
   要件 docs/pm/requirements/2026-09-24-topic-cloud.md に合わせる。
   - 言葉は 20〜40 個（ここでは 36）。大きさは 3 段だけ（弱 1 / 中 2 / 強 3）で、数字は出さない
   - もう書いた題材は薄く（done）、それでも押せる
   - 選べるのは 3 つまで。3 つ選んだら残りは押せない（.cloud.capped）
   - 言葉は Tab で辿れ、Space / Enter で選べる（role="button" と aria-pressed）
   画面の骨（サイドバー）も場面ごとに同じなので、ここで作る。 */

var WORDS = [
  ["在庫", 1, 0], ["契約書", 1, 0], ["顧問", 1, 1], ["粗利", 2, 0], ["月次", 1, 0], ["人件費", 2, 0],
  ["事業承継", 2, 0], ["銀行", 2, 0], ["資金繰り", 3, 0], ["値付け", 2, 0], ["のれん", 2, 1],
  ["買収", 3, 0], ["借入", 2, 0], ["売り手", 2, 0], ["数字の読み方", 2, 0], ["採用", 3, 0],
  ["権限委譲", 2, 0], ["撤退基準", 2, 0], ["資本政策", 2, 1], ["現場", 2, 0], ["定着", 2, 0],
  ["社長の時間", 2, 0], ["評価", 2, 0], ["投資家", 2, 1], ["会議", 1, 0], ["経営計画", 2, 0],
  ["引き継ぎ", 1, 0], ["税務", 1, 0], ["キャッシュ", 2, 0], ["組織", 2, 0], ["給与", 1, 0],
  ["独立", 1, 0], ["小さな会社", 2, 0], ["業界構造", 1, 0], ["デューデリジェンス", 1, 0],
  ["ミドルマネジメント", 1, 0]
];

/* 崩れないかを確かめるための、いちばん多い数（40）といちばん長い言葉（9〜10 字） */
var WORDS_MAX = WORDS.concat([
  ["バリュエーション", 3, 0], ["アーンアウト条項", 2, 0], ["サクセッション", 2, 0], ["事業再生計画", 3, 1]
]);

/* 案 C の帯は雲より小さい。強い言葉だけを 3 段で並べる */
var BAND = [
  ["資金繰り", 3, 0], ["買収", 3, 0], ["採用", 3, 0], ["借入", 2, 0], ["事業承継", 2, 0],
  ["銀行", 2, 0], ["撤退基準", 2, 0], ["数字の読み方", 2, 0], ["資本政策", 2, 1], ["定着", 1, 0],
  ["値付け", 1, 0], ["権限委譲", 1, 0], ["のれん", 1, 1], ["評価", 1, 0]
];

function wordHtml(w, picked, cls, prefix) {
  var on = picked.indexOf(w[0]) >= 0;
  return '<span class="' + cls + " " + prefix + w[1] + (w[2] ? " done" : "") + '"' +
    ' role="button" tabindex="0" aria-pressed="' + (on ? "true" : "false") + '">' + w[0] + "</span>";
}

/* 案 B は中心が大きい塊に見せる。強い言葉を真ん中の行に集め、行の幅を変える */
function roundHtml(words, picked) {
  var strong = [], mid = [], weak = [];
  words.forEach(function (w) { (w[1] === 3 ? strong : w[1] === 2 ? mid : weak).push(w); });
  var rows = [
    { width: 620, items: weak.slice(0, 6) },
    { width: 800, items: mid.slice(0, 6) },
    { width: 880, items: mid.slice(6, 9).concat(strong).concat(mid.slice(9, 12)) },
    { width: 800, items: mid.slice(12) },
    { width: 620, items: weak.slice(6) }
  ];
  return rows.map(function (r) {
    return '<div class="crow" style="max-width:' + r.width + 'px">' +
      r.items.map(function (w) { return wordHtml(w, picked, "w", "s"); }).join("") + "</div>";
  }).join("");
}

function fillClouds() {
  var nodes = document.querySelectorAll("[data-cloud]");
  for (var i = 0; i < nodes.length; i++) {
    var picked = (nodes[i].getAttribute("data-picked") || "").split(",").filter(Boolean);
    var kind = nodes[i].getAttribute("data-cloud");
    var words = kind === "band" ? BAND : kind === "max" ? WORDS_MAX : WORDS;
    if (kind === "round" || kind === "round-max") {
      nodes[i].innerHTML = roundHtml(kind === "round-max" ? WORDS_MAX : WORDS, picked);
    } else {
      nodes[i].innerHTML = words.map(function (w) {
        return wordHtml(w, picked, kind === "band" ? "chip" : "w", kind === "band" ? "c" : "s");
      }).join("");
    }
    if (picked.length >= 3) nodes[i].classList.add("capped");
  }
}

function sidebarHtml() {
  return '' +
    '<div class="side-top"><span class="wordmark">Lita</span><button class="btn pri sm">新しく書く</button></div>' +
    '<div class="side-group"><button class="side-head on">記事</button>' +
    '<ul class="side-list"><li><button class="side-item on">すべての記事</button></li>' +
    '<li><button class="side-item">下書き</button></li></ul></div>' +
    '<div class="side-group"><button class="side-head">文体</button>' +
    '<ul class="side-list"><li><button class="side-item">自分の文章</button></li></ul></div>' +
    '<div class="side-bottom"><button class="acct"><span class="avatar">K</span>' +
    '<span class="acct-email">kuno@muumoo.online</span></button></div>';
}

function fillSidebars() {
  var nodes = document.querySelectorAll(".sidebar");
  for (var i = 0; i < nodes.length; i++) nodes[i].innerHTML = sidebarHtml();
}

/* ?shot=n で 1 枚だけ、?tall=1 で縦長。撮影のためだけの仕掛け */
function applyShot() {
  var q = new URLSearchParams(location.search);
  if (q.get("tall")) document.body.classList.add("tall");
  var n = q.get("shot");
  if (!n) return;
  document.body.classList.add("shot");
  var frames = document.querySelectorAll(".frame");
  for (var i = 0; i < frames.length; i++) if (i !== Number(n) - 1) frames[i].style.display = "none";
}

document.addEventListener("DOMContentLoaded", function () {
  fillSidebars();
  fillClouds();
  applyShot();
});
