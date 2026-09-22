/**
 * 隐私协议：启动必过。
 * App 端必须用 androidPrivacy.json 的原生 template 弹窗拦截启动，
 * 广告 SDK（泛连 / Octopus / 孛樊 / 倍孜）才能在同意后再初始化。
 * H5 弹窗用于浏览器，以及个人中心「查看协议」。
 */
(function (g) {
    'use strict';

    var AGREE_KEY = 'ecommerce_sim_privacy_agreed';
    var VERSION_KEY = 'ecommerce_sim_privacy_version';
    var POLICY_VERSION = '4';

    function fillBody() {
        try {
            var el = document.getElementById('privacyPolicyBody');
            if (el && typeof PRIVACY_POLICY !== 'undefined' && PRIVACY_POLICY.h5Body) {
                el.innerHTML = PRIVACY_POLICY.h5Body;
            }
        } catch (_) {}
    }

    function isAgreed() {
        try {
            return localStorage.getItem(AGREE_KEY) === 'true'
                && localStorage.getItem(VERSION_KEY) === POLICY_VERSION;
        } catch (_) {
            return false;
        }
    }

    function lockShell() {
        try { document.body.classList.add('privacy-pending'); } catch (_) {}
        show();
    }

    function unlockShell() {
        try { document.body.classList.remove('privacy-pending'); } catch (_) {}
        hide();
    }

    function nativePrivacyAgreed() {
        try {
            return typeof plus !== 'undefined'
                && plus.runtime
                && typeof plus.runtime.isAgreePrivacy === 'function'
                && !!plus.runtime.isAgreePrivacy();
        } catch (_) {
            return false;
        }
    }

    function storedPolicyVersion() {
        try { return localStorage.getItem(VERSION_KEY); } catch (_) { return null; }
    }

    // 原生 template 已同意且本地没有旧版协议记录时，不再叠一层 H5。
    // 本地仍是旧版本时要再走一遍 H5，保证披露更新被看到。
    function canTrustNativeConsent() {
        if (!nativePrivacyAgreed()) return false;
        var ver = storedPolicyVersion();
        return !ver || ver === POLICY_VERSION;
    }

    function setAdPrivacyFlags(allowed) {
        try {
            if (typeof plus === 'undefined' || !plus.ad || typeof plus.ad.setPrivacyConfig !== 'function') return;
            plus.ad.setPrivacyConfig({
                isCanUsePhoneState: !!allowed,
                isCanGetAndroidId: !!allowed,
                isCanGetOAID: !!allowed,
                isCanGetMacAddress: !!allowed,
                isCanGetInstallAppList: !!allowed,
                isCanUseSensor: !!allowed,
                isCanGetIP: !!allowed,
                isCanUseLocation: false
            });
        } catch (e) {
            console.warn('[隐私] setPrivacyConfig 失败:', e);
        }
    }

    function markAgreed() {
        try {
            localStorage.setItem(AGREE_KEY, 'true');
            localStorage.setItem(VERSION_KEY, POLICY_VERSION);
        } catch (_) {}
        try {
            if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.agreePrivacy === 'function') {
                plus.runtime.agreePrivacy();
            }
        } catch (e) {
            console.warn('[隐私] agreePrivacy 调用失败:', e);
        }
        setAdPrivacyFlags(true);
        try { g.__privacyAgreed = true; } catch (_) {}
    }

    function disagreeAndExit() {
        try {
            localStorage.removeItem(AGREE_KEY);
            localStorage.removeItem(VERSION_KEY);
        } catch (_) {}
        try { g.__privacyAgreed = false; } catch (_) {}
        try { g.__privacyFlowDone = false; } catch (_) {}
        lockShell();
        setAdPrivacyFlags(false);
        try {
            if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.disagreePrivacy === 'function') {
                plus.runtime.disagreePrivacy();
            }
        } catch (_) {}
        try {
            if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.quit === 'function') {
                plus.runtime.quit();
                return;
            }
        } catch (_) {}
        alert('您需要同意隐私协议才能进入游戏');
    }

    function show() {
        var overlay = document.getElementById('privacyOverlay');
        if (overlay) overlay.classList.remove('hidden');
    }

    function hide() {
        var overlay = document.getElementById('privacyOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function restoreConsentControls() {
        var checkbox = document.getElementById('privacyAgree');
        var agreeBtn = document.getElementById('privacyAgreeBtn');
        var disagreeBtn = document.getElementById('privacyDisagree');
        var checkboxWrap = document.getElementById('privacyCheckboxWrap');
        if (checkboxWrap) checkboxWrap.style.display = '';
        if (disagreeBtn) {
            disagreeBtn.style.display = '';
            disagreeBtn.textContent = '不同意并退出';
        }
        if (agreeBtn) {
            agreeBtn.textContent = '同意并进入';
            agreeBtn.disabled = !(checkbox && checkbox.checked);
        }
        if (checkbox) checkbox.disabled = false;
    }

    function preloadAd() {
        try {
            if (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.preload) {
                setTimeout(function () { RewardedAdManager.preload(); }, 800);
            }
        } catch (_) {}
    }

    function afterAgreed(next) {
        if (g.__privacyFlowDone) return;
        g.__privacyFlowDone = true;
        markAgreed();
        unlockShell();
        preloadAd();
        if (typeof next === 'function') next();
    }

    function bindEvents(next) {
        var checkbox = document.getElementById('privacyAgree');
        var agreeBtn = document.getElementById('privacyAgreeBtn');
        var disagreeBtn = document.getElementById('privacyDisagree');
        var overlay = document.getElementById('privacyOverlay');
        g.__privacyAfterAgree = next;
        if (overlay && overlay.getAttribute('data-bound') === '1') {
            restoreConsentControls();
            return;
        }
        if (overlay) overlay.setAttribute('data-bound', '1');

        if (checkbox && agreeBtn) {
            checkbox.addEventListener('change', function () {
                agreeBtn.disabled = !this.checked;
            });
            agreeBtn.disabled = !checkbox.checked;
        }
        if (agreeBtn) {
            agreeBtn.addEventListener('click', function (e) {
                if (e) e.preventDefault();
                if (agreeBtn.getAttribute('data-view-only') === '1') return;
                if (!checkbox || !checkbox.checked) {
                    alert('请先勾选「我已阅读并同意《用户协议与隐私政策》」');
                    return;
                }
                afterAgreed(g.__privacyAfterAgree);
            });
        }
        if (disagreeBtn) {
            disagreeBtn.addEventListener('click', function (e) {
                if (e) e.preventDefault();
                if (disagreeBtn.getAttribute('data-view-only') === '1') return;
                disagreeAndExit();
            });
        }
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay && !isAgreed()) {
                    e.stopPropagation();
                }
            });
        }
    }

    function begin(next) {
        fillBody();
        restoreConsentControls();
        if (isAgreed() || canTrustNativeConsent()) {
            markAgreed();
            g.__privacyFlowDone = true;
            unlockShell();
            preloadAd();
            if (typeof next === 'function') next();
            return;
        }
        g.__privacyFlowDone = false;
        setAdPrivacyFlags(false);
        lockShell();
        bindEvents(next);
    }

    function canEnterGame() {
        return isAgreed() && !!g.__privacyFlowDone;
    }

    g.PrivacyFlow = {
        fillBody: fillBody,
        isAgreed: isAgreed,
        canEnterGame: canEnterGame,
        markAgreed: markAgreed,
        disagreeAndExit: disagreeAndExit,
        begin: begin,
        POLICY_VERSION: POLICY_VERSION
    };
    g.isPrivacyAgreed = isAgreed;
    g.markPrivacyAgreed = markAgreed;
    g.markPrivacyDisagreedAndExit = disagreeAndExit;
    g.checkPrivacyAndInit = function () {
        begin(function () {
            if (g.AppOnboarding && g.AppOnboarding.afterPrivacy) g.AppOnboarding.afterPrivacy();
        });
    };
})(window);
