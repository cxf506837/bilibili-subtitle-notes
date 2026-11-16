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
  // 空面板（这个视频一段笔记都没有）时该给人看什么。
  // 首屏空是最大的劝退点：装完打开只看到「共 N 句」，不知道能干什么。
  // 这里只算文案与数字，不碰 DOM，方便单测。
  function cta(blocks, opts) {
    var o = opts || {};
    var list = Array.isArray(blocks) ? blocks : [];
    var left = todo(list).length;
    if (!list.length || left <= 0) return null;
    var k = Math.max(1, Math.round(left * 0.6));
    var have = Number(o.notes) || 0;
    return {
      title: have > 0 ? "还有 " + left + " 段没整理" : "这个视频还没整理过",
      text: have > 0
        ? "已经写了 " + have + " 段。剩下的一次整理完，或者先导出字幕——不花一分钱。"
        : "全片 " + list.length + " 段。可以现在整理一遍，也可以先只看字幕——不花一分钱。",
      primary: "整理全片（" + left + " 段）",
      secondary: "只导出字幕全文",
      cost: "整理约 " + k + "k token ≈ ¥" + (k * 1000 / 1e6 * 1.5).toFixed(3) + "，用你自己的额度",
      todo: left
    };
  }
  return { todo: todo, label: label, doneText: doneText, stopText: stopText, cta: cta };
});
