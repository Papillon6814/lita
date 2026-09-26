/* 「書く題を決める」簡素化の試作が共有するもの。_cloud.js の後に読む。
   - サイドバーはいま（D-69）の形: 主ボタン「題から書く」1 つ
   - [data-titles="0,2,6"] に 10 題を入れ、書いた番号を選んだ状態にする */

var TITLES = [
  "借入とエクイティ、どちらが高い金か",
  "値付けの前に、売り手が手放したくないもの",
  "資金繰りは月ではなく週で見る",
  "小さな会社の採用は、席ではなく仕事で決める",
  "当たらない前提で事業計画を作る",
  "のれんの話を、経営の言葉に直す",
  "社長が数字を読めるようになる順番",
  "撤退の基準は、始める前に決める",
  "銀行との面談で、先に出す一枚",
  "買収の後、最初の 90 日でしないこと"
];

function sidebarHtml() {
  return '' +
    '<div class="side-top" style="flex-direction:column;align-items:stretch;gap:10px"><span class="wordmark">Lita</span><button class="btn sm">題から書く</button></div>' +
    '<div class="side-group"><button class="side-head on">記事</button>' +
    '<ul class="side-list"><li><button class="side-item">すべての記事</button></li>' +
    '<li><button class="side-item">下書き</button></li></ul></div>' +
    '<div class="side-group"><button class="side-head">文体</button></div>' +
    '<div class="side-bottom"><button class="acct"><span class="avatar">K</span>' +
    '<span class="acct-email">kuno@muumoo.online</span></button></div>';
}

function fillTitles() {
  var nodes = document.querySelectorAll("[data-titles]");
  for (var i = 0; i < nodes.length; i++) {
    var picked = (nodes[i].getAttribute("data-titles") || "").split(",").filter(Boolean).map(Number);
    nodes[i].innerHTML = TITLES.map(function (t, n) {
      var on = picked.indexOf(n) >= 0;
      return '<li><label class="trow' + (on ? " on" : "") + '"><input type="checkbox"' + (on ? " checked" : "") +
        '><span class="t">' + t + "</span></label></li>";
    }).join("");
  }
}

document.addEventListener("DOMContentLoaded", fillTitles);
