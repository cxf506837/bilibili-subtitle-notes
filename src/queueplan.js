(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BnQueue = api;
})(typeof window !== "undefined" ? window : null, function () {
  // 整片整理要挑的块：还没出笔记、也没排进队列。
  // 已经 noteIndex 的跳过（不重复花钱）；queued 的跳过（同一块别排两次）。
  function todo(blocks) {
    var out = [];
    var list = Array.isArray(blocks) ? blocks : [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || typeof b !== "object") continue;
      if (b.noteIndex != null) continue;
      if (b.queued) continue;
      out.push(b);
    }
    return out;
  }
  function label(n, running) {
    if (running) return "停止整理";
    return "整理全片" + (n > 0 ? "（" + n + " 段）" : "");
  }
  function doneText(n, total) {
    var s = "全片整理完了：这次写了 " + n + " 段";
    if (total > 0) s += "，全片共 " + total + " 段";
    return s;
  }
  function stopText(left) {
    return "已停止：还有 " + left + " 段没整理";
  }
  return { todo: todo, label: label, doneText: doneText, stopText: stopText };
});
