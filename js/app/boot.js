/**
 * 应用入口：挂载弹窗 → 隐私 → 开局 → runtime.initGame
 */
(function (g) {
    'use strict';

    function lockPhone() {
        try {
            if (typeof plus === 'undefined') return;
            if (plus.screen && plus.screen.lockOrientation) {
                plus.screen.lockOrientation('portrait-primary');
            }
            if (plus.navigator && plus.navigator.setFullscreen) {
                plus.navigator.setFullscreen(true);
            }
        } catch (_) {}
    }

    function start() {
        if (g.__ecommerceSimBooted) return;
        g.__ecommerceSimBooted = true;
        lockPhone();
        try {
            if (g.AppOverlays && g.AppOverlays.mount) g.AppOverlays.mount();
        } catch (e) { console.error('[boot] overlays', e); }
        try {
            if (g.PrivacyFlow && g.PrivacyFlow.fillBody) g.PrivacyFlow.fillBody();
        } catch (_) {}
        AppRuntime.bindErrors();
        AppRuntime.closeNativeSplash();
        if (!g.PrivacyFlow || typeof g.PrivacyFlow.begin !== 'function') {
            console.error('[boot] 隐私模块未加载，禁止进入游戏');
            return;
        }
        g.PrivacyFlow.begin(function () {
            if (g.PrivacyFlow.canEnterGame && !g.PrivacyFlow.canEnterGame()) return;
            AppOnboarding.afterPrivacy();
        });
    }

    function bootWhenReady() {
        if (typeof plus !== 'undefined') {
            document.addEventListener('plusready', start);
            try {
                if (g.plus) start();
            } catch (_) {}
            return;
        }
        start();
    }

    g.AppBoot = { start: start };
    bootWhenReady();
})(window);
