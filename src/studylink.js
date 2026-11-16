// 学习页链接：内容脚本没有 chrome.tabs，开学习页只能交给后台。
// 这里只管一件事——把「课程 id + 视角」拼成扩展页 URL，纯函数，node 里能直接测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnStudyLink = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VIEWS = ['cross', 'unwatched'];

  // base 是 chrome-extension://<id>/src/study.html；cid 形如 season:8719249；
  // view 只认 cross / unwatched，其他一律当作「全部」（别把 path 串或大写当视角）。
  function studyUrl(base, cid, view) {
    var qs = [];
    var c = (cid === null || cid === undefined) ? '' : String(cid);
    if (c) qs.push('course=' + encodeURIComponent(c));
    var v = String(view === null || view === undefined ? '' : view);
    if (VIEWS.indexOf(v) >= 0) qs.push('view=' + v);
    return String(base) + (qs.length ? '?' + qs.join('&') : '');
  }

  return { VIEWS: VIEWS, studyUrl: studyUrl };
});
