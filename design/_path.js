/* ?shot=n で 1 枚だけ表示する。撮影のためだけの仕掛け。 */
document.addEventListener("DOMContentLoaded", function () {
  var n = new URLSearchParams(location.search).get("shot");
  if (!n) return;
  document.body.classList.add("shot");
  var frames = document.querySelectorAll(".frame");
  for (var i = 0; i < frames.length; i++) if (i !== Number(n) - 1) frames[i].style.display = "none";
});
