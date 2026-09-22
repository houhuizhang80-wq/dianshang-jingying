/**
 * 按清单同步注入脚本（解析期 document.write，兼容 HBuilder 5+）。
 */
(function (g) {
    'use strict';
    var list = (g.AppManifest && g.AppManifest.scripts) || [];
    for (var i = 0; i < list.length; i++) {
        document.write('<script type="text/javascript" src="' + list[i] + '"><\/script>');
    }
})(window);
