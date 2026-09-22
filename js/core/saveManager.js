/**
 * saveManager.js - 存档系统核心（SaveManager）
 * ======================================
 * 设计目标：稳定、可靠、防损坏的本地持久化存档系统
 *
 * 架构：分层双存储 + 三副本 + 9层fallback + DJB2哈希校验 + GZIP压缩
 *   - localStorage：_meta 摘要（同步快速读取 + 状态检测）
 *   - IndexedDB   ：完整压缩存档（主/备/快照，大容量）
 *   - sessionStorage：紧急缓冲（页面崩溃前最后一次成功快照）
 *
 * 数据安全优先级：数据安全性 > 操作稳定性 > 存储效率 > 性能
 */
class SaveManager {
    constructor() {
        // ===== 常量 =====
        this.SAVE_FORMAT_VERSION = 1;                       // 存档系统自身版本
        // 原始 JSON 上限：IndexedDB+GZIP 可放宽；localStorage 降级仍守紧
        this.MAX_ARCHIVE_SIZE = 888 * 1024 * 1024;         // 展示上限 888MB
        this.MAX_ARCHIVE_SIZE_IDB = 888 * 1024 * 1024;     // IDB 模式原始上限 888MB
        this.MAX_ARCHIVE_SIZE_LS = 4 * 1024 * 1024;         // localStorage 降级 4MB（最终落盘 payload 上限）
        this.MAX_ARCHIVE_SIZE_LS_GZIP = 16 * 1024 * 1024;   // 降级+gzip：原始 JSON 放宽到 16MB，落盘前按压缩后大小二次校验
        this.WARN_ARCHIVE_SIZE = 710 * 1024 * 1024;         // 约 80% 上限开始预警并预裁剪
        this.SESSION_BUFFER_MAX = 2 * 1024 * 1024;          // session 紧急缓冲最大 2MB
        this.HISTORY_MAX = 5;                               // 历史快照保留数
        this.SNAPSHOT_INITIAL_DELAY = 2 * 60 * 1000;        // 初始化后2分钟启动快照
        this.SNAPSHOT_INTERVAL = 6 * 60 * 1000;             // 之后每6分钟一次
        this.SAVE_MIN_GAP = 200;                            // 防抖最小间隔(ms)
        this.SAVE_MIN_INTERVAL = 5000;                      // 动态保存间隔下限 5s
        this.SAVE_MAX_INTERVAL = 30000;                     // 动态保存间隔上限 30s
        this.BACKUP_ROTATE_EVERY = 3;                       // 每3次主档保存滚动一次备份
        this.DB_NAME = 'ecommerce_sim_archive';
        this.DB_VERSION = 1;
        // localStorage / sessionStorage key 命名（统一 ecommerce_sim_ 前缀，被 _doResetGame 清理覆盖）
        this.META_KEY_PREFIX = 'ecommerce_sim_meta_';       // _meta 摘要前缀
        this.ARCHIVE_LS_KEY_PREFIX = 'ecommerce_sim_archive_'; // 降级模式 localStorage 主体
        this.HISTORY_INDEX_KEY = 'ecommerce_sim_history_index';
        this.SESSION_BUFFER_KEY = 'ecommerce_sim_session_buffer';
        this.OLD_WAREHOUSE_KEY = 'ecommerce_sim_warehouse_v2'; // 旧仓储独立存储 key（迁移用）
        // 旧版（v2.1.x 打包）存档 key：直接 JSON.stringify(state)，与新版 {state,express,warehouse} 不同
        this.LEGACY_SAVE_KEY = 'ecommerce_sim_save';
        this.LEGACY_KEYS = [
            'ecommerce_sim_save',
            'ecommerce_sim_save_backup',
            'ecommerce_sim_save_bak2',
            'ecommerce_sim_save_meta',
            'ecommerce_sim_save_emergency'
        ];
        this.LEGACY_SNAP_PREFIX = 'ecommerce_sim_save_snap_';
        this.LEGACY_IDB_STORE = 'saves';   // 旧版 IndexedDB objectStore 名

        // ===== 运行时状态 =====
        this._db = null;                  // IndexedDB 连接
        this._dbReady = null;             // Promise<IDBDatabase>，懒初始化
        this._hasIDB = this._checkIDBSupport();
        this._hasCompression = this._checkCompressionSupport();
        this._saveTimer = null;           // 防抖 setTimeout 句柄
        this._lastSaveTime = 0;           // 上次实际保存时间戳
        this._lastFastHash = '';          // 上次计算的快速哈希（用于跳过未变存档）
        this._isSaving = false;           // 保存进行中标志（串行化保护）
        this._saveQueue = [];             // 保存请求队列
        this._saveCount = 0;              // 保存计数（用于备份滚动判断）
        this._snapshotTimer = null;       // 快照定时器
        this._snapshotStarted = false;
        this._status = 'pending';         // idle|saving|saved|error|pending
        this._lastError = null;
        this._listeners = new Set();      // 状态变化监听器（供 UI 状态灯）
        this._phase1Meta = null;          // Phase1 同步读取的 _meta（UI 快速展示用）
        this._warnLevel = 0;              // 预警等级 0=OK/1=黄/2=橙
        this._migratedFromLegacy = false; // 本次启动是否从旧档迁移
        this._blockSaving = false;        // 重新开始期间禁止任何写入，防止旧档写回
        // ===== 大存档性能（后期卡顿治理）=====
        this.SLICED_STRINGIFY_THRESHOLD = 400 * 1024;  // 预估原始体积>400KB 走分片序列化，避免大 stringify 冻结主线程
        this.PRE_PRUNE_COOLDOWN = 60 * 1000;           // 保存前预裁剪冷却 60s（裁剪本身也要几十~几百ms 同步）
        this._lastPrePruneAt = 0;
    }


    // ==================== 统一日志（排查存档同步问题用） ====================

    /** 带时间戳和彩色标签的日志，便于在控制台快速定位存档流程 */
    _log(tag, msg, data) {
        const d = new Date();
        const ts = String(d.getHours()).padStart(2, '0') + ':' +
                   String(d.getMinutes()).padStart(2, '0') + ':' +
                   String(d.getSeconds()).padStart(2, '0') + '.' +
                   String(d.getMilliseconds()).padStart(3, '0');
        const styles = {
            SAVE: 'color:#4caf50;font-weight:bold',
            LOAD: 'color:#2196f3;font-weight:bold',
            SNAP: 'color:#9c27b0;font-weight:bold',
            WARN: 'color:#ff9800;font-weight:bold',
            INFO: 'color:#607d8b;font-weight:bold',
            ERR:  'color:#f44336;font-weight:bold'
        };
        const style = styles[tag] || styles.INFO;
        if (data !== undefined) {
            console.log('%c[' + ts + '][SAVE][' + tag + '] ' + msg, style, data);
        } else {
            console.log('%c[' + ts + '][SAVE][' + tag + '] ' + msg, style);
        }
    }


    // ==================== 能力探测与降级 ====================

    _checkIDBSupport() {
        try {
            return typeof indexedDB !== 'undefined' &&
                   typeof IDBKeyRange !== 'undefined';
        } catch (e) { return false; }
    }

    _checkCompressionSupport() {
        try {
            return typeof CompressionStream !== 'undefined' &&
                   typeof DecompressionStream !== 'undefined';
        } catch (e) { return false; }
    }

    /** 存储能力概览：tier A=IDB+GZIP(最佳) B=IDB+raw C=localStorage降级 */
    get capability() {
        return {
            idb: this._hasIDB,
            gzip: this._hasCompression,
            localStorage: this._safeLocalStorage(),
            sessionStorage: this._safeSessionStorage(),
            tier: this._hasIDB ? (this._hasCompression ? 'A' : 'B') : 'C'
        };
    }


    // ==================== IndexedDB 封装 ====================

    /** 懒打开数据库连接，返回 Promise<IDBDatabase>。
     *  自动修复：若数据库已存在但 object stores 缺失（旧版本残留），自动升级版本号重建。
     *  版本兼容：若 DB_VERSION 低于数据库实际版本（上次自动升级过），以当前版本打开。 */
    _idbOpen() {
        if (this._db) return Promise.resolve(this._db);
        if (this._dbReady) return this._dbReady;
        // archives/express/warehouse/meta = 新版；saves = 旧版（迁移用，创建后不删除）
        const requiredStores = ['archives', 'express', 'warehouse', 'meta'];

        const openInternal = (version) => new Promise((resolve, reject) => {
            if (!this._hasIDB) { reject(new Error('IndexedDB 不支持')); return; }
            let req;
            try {
                // version 为 null 时不指定版本号，以数据库当前版本打开（避免 VersionError）
                req = (version != null) ? indexedDB.open(this.DB_NAME, version) : indexedDB.open(this.DB_NAME);
            } catch (e) { reject(e); return; }
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const name of requiredStores) {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'slot' });
                    }
                }
                // 保留/创建旧版 saves store，便于一次性迁移旧档（不会覆盖已有数据）
                if (!db.objectStoreNames.contains(this.LEGACY_IDB_STORE)) {
                    try { db.createObjectStore(this.LEGACY_IDB_STORE, { keyPath: 'slot' }); } catch (_) {}
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const actualVersion = db.version;
                // 检查 object stores 是否完整（防止数据库已存在但 stores 缺失）
                const missing = requiredStores.filter(s => !db.objectStoreNames.contains(s));
                if (missing.length > 0 && actualVersion < 100) {
                    db.close();
                    this._log('WARN', 'IDB 缺少 stores [' + missing.join(',') + ']，升级到 v' + (actualVersion + 1) + ' 重建');
                    resolve(openInternal(actualVersion + 1));
                    return;
                }
                // 同步实例版本号，避免下次再用旧版本打开
                this.DB_VERSION = actualVersion;
                this._db = db;
                this._db.onclose = () => { this._db = null; this._dbReady = null; };
                this._db.onerror = (e) => { console.warn('[SaveManager] IDB error:', e.target.error); };
                this._log('INFO', 'IDB 连接成功 v' + actualVersion + ' stores=[' + Array.from(db.objectStoreNames).join(',') + ']');
                resolve(this._db);
            };
            req.onerror = () => {
                // VersionError：请求版本低于数据库实际版本（上次自动升级过），以当前版本重新打开
                if (req.error && req.error.name === 'VersionError') {
                    this._log('WARN', 'IDB 版本 ' + version + ' 低于实际版本，以当前版本重新打开');
                    resolve(openInternal(null));
                    return;
                }
                reject(req.error);
            };
            req.onblocked = () => reject(new Error('IndexedDB 打开被阻塞（其他标签页占用）'));
        });

        this._dbReady = openInternal(this.DB_VERSION);
        return this._dbReady;
    }

    /** 通用事务执行器：浏览器无真正事务，用 oncomplete/onerror/onabort 确保完整性 */
    _idbTx(storeName, mode, fn) {
        return this._idbOpen().then(db => new Promise((resolve, reject) => {
            let tx;
            try {
                tx = db.transaction(storeName, mode);
            } catch (e) { reject(e); return; }
            const store = tx.objectStore(storeName);
            let result;
            try { result = fn(store); } catch (e) { reject(e); return; }
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('事务被中止'));
        }));
    }

    _idbPut(storeName, record) {
        return this._idbTx(storeName, 'readwrite', s => { s.put(record); return record; });
    }

    _idbGet(storeName, key) {
        return this._idbTx(storeName, 'readonly', s => new Promise((res, rej) => {
            const r = s.get(key);
            r.onsuccess = () => res(r.result || null);
            r.onerror = () => rej(r.error);
        }));
    }

    _idbDelete(storeName, key) {
        return this._idbTx(storeName, 'readwrite', s => { s.delete(key); return true; });
    }

    _idbClear(storeName) {
        return this._idbTx(storeName, 'readwrite', s => { s.clear(); return true; });
    }

    _idbGetAllKeys(storeName) {
        return this._idbTx(storeName, 'readonly', s => new Promise((res, rej) => {
            const r = s.getAllKeys();
            r.onsuccess = () => res(r.result || []);
            r.onerror = () => rej(r.error);
        }));
    }

    /** 清空所有 IndexedDB store（供 fullReset 调用） */
    async _idbClearAll() {
        if (!this._hasIDB) return;
        try {
            await this._idbClear('archives');
            await this._idbClear('express');
            await this._idbClear('warehouse');
            await this._idbClear('meta');
        } catch (e) {
            console.warn('[SaveManager] 清空 IDB 失败:', e);
        }
    }


    // ==================== UTF8 编解码 + GZIP 压缩 ====================

    _strToUtf8Bytes(str) {
        return new TextEncoder().encode(str);
    }

    _utf8BytesToStr(bytes) {
        return new TextDecoder().decode(bytes);
    }

    /** GZIP 压缩 Uint8Array → Uint8Array（不支持 CompressionStream 时原样返回） */
    async _gzipCompress(bytes) {
        if (!this._hasCompression) return bytes;
        try {
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            writer.write(bytes);
            writer.close();
            return await this._readStreamToUint8(cs.readable.getReader());
        } catch (e) {
            console.warn('[SaveManager] GZIP 压缩失败，降级 raw:', e);
            return bytes;
        }
    }

    /** GZIP 解压 Uint8Array → Uint8Array（不支持时原样返回） */
    async _gzipDecompress(bytes) {
        if (!this._hasCompression) return bytes;
        try {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            writer.write(bytes);
            writer.close();
            return await this._readStreamToUint8(ds.readable.getReader());
        } catch (e) {
            console.warn('[SaveManager] GZIP 解压失败，尝试 raw:', e);
            return bytes;
        }
    }

    async _readStreamToUint8(reader) {
        const chunks = [];
        let totalLen = 0;
        let r;
        while (!(r = await reader.read()).done) {
            chunks.push(r.value);
            totalLen += r.value.length;
        }
        const out = new Uint8Array(totalLen);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }

    /** Uint8Array → base64（分块转换，避免大数组 call stack 溢出） */
    _bytesToBase64(bytes) {
        const CHUNK = 0x8000;
        let bin = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }

    /** base64 → Uint8Array */
    _base64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }


    // ==================== DJB2 哈希（32位，对未压缩 UTF8 字节计算） ====================

    _hashDJB2(bytes) {
        return this._hashDJB2Chunk(5381, bytes).toString(16).padStart(8, '0');
    }

    /** DJB2 分块续算：分片序列化时跨片累计，最终结果与整段 _hashDJB2 完全一致 */
    _hashDJB2Chunk(seed, bytes) {
        let hash = seed >>> 0;
        for (let i = 0; i < bytes.length; i++) {
            hash = ((hash << 5) + hash) + bytes[i];   // hash * 33 + c
            hash = hash >>> 0;                          // 强制无符号 32 位
        }
        return hash >>> 0;
    }


    // ==================== 存档签名（导入防伪） ====================
    // ⚠️ 与资金混淆同理：密钥在客户端，只能挡住「导出的文本被手动改资金后再导入」
    //    这类低成本篡改（提高作弊成本），不能替代服务端校验。

    /** 签名密钥：应用标识 + 独立盐派生 16 字节（与资金混淆密钥不同源） */
    _getSignKeyBytes() {
        const seed = 'ecommerce-sim-archive-signature-v1::K7F3A1C9D2E64B80';
        let h = 2166136261 >>> 0;
        for (let i = 0; i < seed.length; i++) {
            h ^= seed.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const bytes = [];
        for (let i = 0; i < 16; i++) {
            h = (Math.imul(h, 1103515245) + 12345) >>> 0;
            bytes.push((h >>> 16) & 0xff);
        }
        return bytes;
    }

    /**
     * 对导出文本中的 payloadB64 计算带密钥摘要（16 位十六进制，双通道降低碰撞）
     * @returns {string} 签名串
     */
    _signText(str) {
        const key = this._getSignKeyBytes();
        const bytes = this._strToUtf8Bytes(String(str == null ? '' : str));
        let h1 = 0x811c9dc5 >>> 0;
        let h2 = 0x9e3779b9 >>> 0;
        for (let i = 0; i < key.length; i++) {
            h1 = Math.imul(h1 ^ key[i], 16777619) >>> 0;
            h2 = Math.imul(h2 + key[i] + 0x85ebca6b, 2246822519) >>> 0;
        }
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            h1 = Math.imul(h1 ^ b, 16777619) >>> 0;
            h2 = Math.imul(h2 ^ (b + ((i * 31) & 0xff)), 2246822519) >>> 0;
        }
        return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * 读档/导入时的数值体检：NaN / Infinity / 负数越界 / 天文数字一律重置或钳制。
     * 关键经济字段是历史刷钱入口，必须在数据进入内存前收口。
     * @returns {{state:Object, fixed:string[]}} 修复过的字段名列表
     */
    _sanitizeLoadedState(state) {
        const fixed = [];
        if (!state || typeof state !== 'object') return { state: state, fixed: fixed };
        const shop = state.shop;
        if (shop && typeof shop === 'object') {
            const before = shop.funds;
            shop.funds = this._clampNum(before, -this._maxDebtAbs(), 9e12, 0);
            if (shop.funds !== before) fixed.push('shop.funds');
            const lv = shop.level;
            shop.level = Math.floor(this._clampNum(lv, 1, 999, 1));
            if (shop.level !== lv) fixed.push('shop.level');
            if (shop.reputation != null) {
                const rp = shop.reputation;
                shop.reputation = Math.floor(this._clampNum(rp, 0, 1e9, 0));
                if (shop.reputation !== rp) fixed.push('shop.reputation');
            }
            if (shop.totalSalesAmount != null) {
                const sa = shop.totalSalesAmount;
                shop.totalSalesAmount = this._clampNum(sa, 0, 9e12, 0);
                if (shop.totalSalesAmount !== sa) fixed.push('shop.totalSalesAmount');
            }
        }
        const gt = state.gameTime;
        if (gt && typeof gt === 'object') {
            const d = gt.day;
            gt.day = Math.floor(this._clampNum(d, 1, 1e7, 1));
            if (gt.day !== d) fixed.push('gameTime.day');
            const h = gt.hour;
            gt.hour = Math.floor(this._clampNum(h, 0, 23, 0));
            if (gt.hour !== h) fixed.push('gameTime.hour');
        }
        return { state: state, fixed: fixed };
    }

    /** 允许的最大欠款绝对值（SHOP_CONFIG 未加载时用兜底值） */
    _maxDebtAbs() {
        try {
            if (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG && isFinite(SHOP_CONFIG.maxDebt)) {
                return Math.abs(Number(SHOP_CONFIG.maxDebt));
            }
        } catch (_) {}
        return 100000;
    }

    /** 数值钳制：非数字/NaN/Infinity → fallback；越界 → 边界值 */
    _clampNum(v, min, max, fallback) {
        const n = (typeof v === 'number') ? v : Number(v);
        if (!isFinite(n)) return fallback;
        if (n < min) return min;
        if (n > max) return max;
        return n;
    }

    // ==================== 资金混淆（存档防篡改：金额不再以明文落盘） ====================

    /** 混淆密钥：固定盐 + 应用标识派生 16 字节（FNV-1a 播种 LCG） */
    _getFundsKeyBytes() {
        const seed = 'ecommerce-sim-funds-obfuscation-v1::H529D8F66';
        let h = 2166136261 >>> 0;
        for (let i = 0; i < seed.length; i++) {
            h ^= seed.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const bytes = [];
        for (let i = 0; i < 16; i++) {
            h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
            bytes.push((h >>> 24) & 0xff);
        }
        return bytes;
    }

    /** 编码金额 → 'f1:<base64>'（非数字/异常时原样返回，保证存档流程不中断） */
    encodeFunds(n) {
        if (typeof n !== 'number' || !isFinite(n)) return n;
        try {
            const key = this._getFundsKeyBytes();
            const text = 'f1' + String(n);
            const bytes = this._strToUtf8Bytes(text);
            const out = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
            let bin = '';
            for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
            return 'f1:' + btoa(bin);
        } catch (_) {
            return n;
        }
    }

    /** 解码金额：数字/旧档原样返回；'f1:' 前缀解码；篡改失败返回 0（防刷钱） */
    decodeFunds(v) {
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        if (typeof v !== 'string' || v.indexOf('f1:') !== 0) return v;
        try {
            const key = this._getFundsKeyBytes();
            const bin = atob(v.slice(3));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
            const text = this._utf8BytesToStr(bytes);
            if (text.slice(0, 2) !== 'f1') return 0;
            const n = Number(text.slice(2));
            return isFinite(n) ? n : 0;
        } catch (_) {
            return 0;
        }
    }

    /** 解码存档 state 中的混淆资金（幂等；旧档纯数字不动） */
    _decodeFundsInState(state) {
        try {
            if (state && state.shop && typeof state.shop.funds === 'string'
                && state.shop.funds.indexOf('f1:') === 0) {
                state.shop.funds = this.decodeFunds(state.shop.funds);
            }
        } catch (_) {}
        return state;
    }

    /** 构造可序列化副本：混淆 shop.funds（浅拷贝，不修改活状态） */
    _prepareStateForStringify(fullState) {
        const s = fullState && fullState.state;
        if (s && s.shop && typeof s.shop.funds === 'number' && isFinite(s.shop.funds)) {
            fullState = Object.assign({}, fullState, {
                state: Object.assign({}, s, {
                    shop: Object.assign({}, s.shop, { funds: this.encodeFunds(s.shop.funds) })
                })
            });
        }
        return fullState;
    }

    /** 序列化完整存档：先混淆 shop.funds 再 stringify（构造浅拷贝，不修改活状态） */
    _stringifyFullState(fullState) {
        return JSON.stringify(this._prepareStateForStringify(fullState));
    }

    /** 预估存档原始 JSON 体积（字节）。用于决定是否走分片序列化 / 跳过无意义的紧急序列化。 */
    _estimateStateSize(state, express, warehouse) {
        let est = 2000;
        if (!state) return est;
        if (Array.isArray(state.orders)) est += state.orders.length * 850;
        if (Array.isArray(state.inventory)) est += state.inventory.length * 300;
        if (Array.isArray(state.employees)) est += state.employees.length * 450;
        if (Array.isArray(state.listings)) est += state.listings.length * 220;
        if (state.finance) {
            if (Array.isArray(state.finance.records)) est += state.finance.records.length * 160;
            if (Array.isArray(state.finance.dailyStats)) est += state.finance.dailyStats.length * 420;
        }
        if (state.marketing && Array.isArray(state.marketing.promotionLogs)) est += state.marketing.promotionLogs.length * 180;
        if (state.customerService) {
            const cs = state.customerService;
            est += (Array.isArray(cs.consultations) ? cs.consultations.length : 0) * 500;
            est += (Array.isArray(cs.returns) ? cs.returns.length : 0) * 600;
            est += (Array.isArray(cs.disputes) ? cs.disputes.length : 0) * 600;
            est += (Array.isArray(cs.appeals) ? cs.appeals.length : 0) * 600;
            est += (Array.isArray(cs.logs) ? cs.logs.length : 0) * 200;
            est += (Array.isArray(cs.notifications) ? cs.notifications.length : 0) * 200;
        }
        if (state.warehouse && Array.isArray(state.warehouse.logs)) est += state.warehouse.logs.length * 180;
        if (state.warehouse && Array.isArray(state.warehouse.packagingLogs)) est += state.warehouse.packagingLogs.length * 180;
        if (express) {
            if (express.waybills && typeof express.waybills === 'object') est += Object.keys(express.waybills).length * 420;
            if (express.tracks && typeof express.tracks === 'object') est += Object.keys(express.tracks).length * 260;
            if (Array.isArray(express.bills)) est += express.bills.length * 300;
        }
        if (warehouse && typeof warehouse === 'object') {
            const whArr = ['logs', 'packagingLogs', 'inboundOrders', 'outboundOrders', 'stocktakeOrders'];
            for (let i = 0; i < whArr.length; i++) {
                if (Array.isArray(warehouse[whArr[i]])) est += warehouse[whArr[i]].length * 200;
            }
            if (warehouse.stock && typeof warehouse.stock === 'object') est += Object.keys(warehouse.stock).length * 150;
        }
        return est;
    }

    /**
     * 分片序列化：与 JSON.stringify 逐字节等价，但构建过程拆成多个宏任务执行，
     * 每片时间预算 ~budgetMs，到点让出主线程给渲染/游戏 tick。
     *
     * 背景：后期 state 可达 3~10MB，整段 JSON.stringify + UTF8 编码 + DJB2 哈希
     * 在手机 WebView 上可同步阻塞 0.5~2s；保存每 30~90s 一次 + 每 6 分钟快照一次，
     * 是「玩到后期时不时卡一下」的主要来源。分片后单片阻塞压到 ~20ms 以内，
     * 配合让出点把保存摊到多帧里完成，玩家几乎无感。
     *
     * @param {object} fullState _collectFullState() 的结果
     * @param {{budgetMs?:number, needJson?:boolean}} opts
     * @returns {Promise<{json:string|null, bytes:Uint8Array, hash:string, yields:number, maxBlockMs:number}>}
     */
    async _buildSlicedJson(fullState, opts) {
        opts = opts || {};
        const budgetMs = (typeof opts.budgetMs === 'number' && opts.budgetMs > 0) ? opts.budgetMs : 12;
        const needJson = opts.needJson !== false;
        const ARR_SLICE = 250;   // 大数组每片元素数（≈150~400KB/片，几 ms~十几 ms）
        const OBJ_SLICE = 200;   // 大对象每批键数
        const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        const out = [];            // 大文本片段（在让出点 flush 编码）
        const pending = [];        // 当前片内小片段
        const byteParts = [];
        let hash = 5381;
        let byteLen = 0;
        let lastYield = nowMs();
        let maxBlockMs = 0;
        let yields = 0;

        const flush = () => {
            if (!pending.length) return;
            const s = pending.join('');
            pending.length = 0;
            out.push(s);
            const b = this._strToUtf8Bytes(s);
            byteParts.push(b);
            byteLen += b.length;
            hash = this._hashDJB2Chunk(hash, b);
        };
        const emit = (str) => { pending.push(str); };

        // 递归探测：对象内是否藏着大数组/大对象（如 state 键少但嵌套 orders 数组几 MB），
        // 有则必须走分批路径，不能整段 stringify 夹带（否则分片形同虚设）
        const likelyBig = (v, depth) => {
            if (depth === undefined) depth = 0;
            if (depth > 8 || !v || typeof v !== 'object') return false;
            if (Array.isArray(v)) return v.length > ARR_SLICE;
            const ks = Object.keys(v);
            if (ks.length > OBJ_SLICE) return true;
            for (let i = 0; i < ks.length; i++) {
                const val = v[ks[i]];
                if (val && typeof val === 'object' && likelyBig(val, depth + 1)) return true;
            }
            return false;
        };

        // 显式任务栈（避免深递归）：{k:'raw',s} 输出文本 | {k:'val',v} 输出值 | {k:'obj',obj,keys} 一批对象键
        const stack = [{ k: 'val', v: this._prepareStateForStringify(fullState) }];
        let ops = 0;

        while (stack.length) {
            if ((++ops & 31) === 0) {
                const now = nowMs();
                const block = now - lastYield;
                if (block > maxBlockMs) maxBlockMs = block;
                if (block >= budgetMs) {
                    flush();
                    await new Promise(r => setTimeout(r, 0));
                    yields++;
                    lastYield = nowMs();
                }
            }

            const t = stack.pop();
            if (t.k === 'raw') { emit(t.s); continue; }

            if (t.k === 'obj') {
                // 一批对象键：按 JSON.stringify 键序输出 "key":<value>,...（逆序入栈保正序弹出）
                // 批间逗号走共享 commaCtx 条件输出：整批被 undefined 跳过时不产生孤立逗号
                const obj = t.obj, keys = t.keys;
                if (t.commaCtx) {
                    if (t.commaCtx.any) emit(',');
                    t.commaCtx.any = false;
                }
                for (let i = keys.length - 1; i >= 0; i--) {
                    const k = keys[i];
                    const v = obj[k];
                    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
                    if (t.commaCtx) t.commaCtx.any = true;
                    // 逆序入栈：弹出序为 , "key": <value>（逗号最先弹出、紧跟在前一对之后）
                    stack.push({ k: 'val', v });
                    stack.push({ k: 'raw', s: JSON.stringify(k) + ':' });
                    if (i > 0) stack.push({ k: 'raw', s: ',' });
                }
                continue;
            }

            // t.k === 'val'
            let v = t.v;
            if (v !== null && typeof v === 'object' && typeof v.toJSON === 'function') v = v.toJSON();
            if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue; // JSON.stringify 跳过
            if (v === null || typeof v !== 'object') { emit(JSON.stringify(v)); continue; }

            if (Array.isArray(v)) {
                const n = v.length;
                if (n <= ARR_SLICE) { emit(JSON.stringify(v)); continue; }
                emit('[');
                stack.push({ k: 'raw', s: ']' }); // 闭合括号先入栈 → 全部段弹出后才输出
                // 先算全部起点 [0, ARR, 2ARR, ...]，再倒序入栈：
                // 每段「先推前导逗号、再推内容」，弹出序 = 段0 , 段1 , ... 段k
                const starts = [];
                for (let s = 0; s < n; s += ARR_SLICE) starts.push(s);
                for (let k = starts.length - 1; k >= 0; k--) {
                    const s = starts[k], e = Math.min(n, s + ARR_SLICE);
                    const inner = JSON.stringify(v.slice(s, e)).slice(1, -1); // 去外层 []
                    // 先推内容再推逗号：弹出序 = 内容 , 内容 , ...（逗号落在段间）
                    if (inner) stack.push({ k: 'raw', s: inner });
                    if (k > 0) stack.push({ k: 'raw', s: ',' });
                }
                continue;
            }

            const keys = Object.keys(v);
            if (keys.length === 0) { emit('{}'); continue; }
            if (keys.length <= OBJ_SLICE && !likelyBig(v)) { emit(JSON.stringify(v)); continue; }
            emit('{');
            stack.push({ k: 'raw', s: '}' }); // 闭合括号先入栈 → 全部批次弹出后才输出
            // 先算全部批次起点 [0, OBJ_SLICE, 2*OBJ_SLICE, ...] 再倒序入栈，覆盖全部键
            const commaCtx = { any: false };
            const bStarts = [];
            for (let s = 0; s < keys.length; s += OBJ_SLICE) bStarts.push(s);
            for (let k = bStarts.length - 1; k >= 0; k--) {
                const batch = keys.slice(bStarts[k], bStarts[k] + OBJ_SLICE);
                stack.push({ k: 'obj', obj: v, keys: batch, commaCtx });
            }
        }

        flush();
        const json = needJson ? out.join('') : null;

        // 拼接最终字节流（各片编码顺序与 JSON 文本顺序一致，哈希已跨片累计）
        const bytes = new Uint8Array(byteLen);
        let off = 0;
        for (let i = 0; i < byteParts.length; i++) {
            bytes.set(byteParts[i], off);
            off += byteParts[i].length;
        }
        return {
            json,
            bytes,
            hash: (hash >>> 0).toString(16).padStart(8, '0'),
            yields,
            maxBlockMs
        };
    }


    // ==================== 状态序列化与 _meta 生成 ====================

    /** 收集完整存档数据：主 state + ExpressState + warehouseState */
    _collectFullState() {
        const gs = (typeof gameState !== 'undefined') ? gameState.state : null;
        if (!gs) return null;
        return {
            state: gs,
            express: this._serializeExpressState(),
            warehouse: this._serializeWarehouseState(),
            _saveMeta: {
                gameVersion: (typeof GAME_STATE_VERSION !== 'undefined') ? GAME_STATE_VERSION : 7,
                saveFormatVersion: this.SAVE_FORMAT_VERSION,
                timestamp: Date.now(),
                stateVersion: gs.version
            }
        };
    }

    /** ExpressState 序列化（当前纯内存全局对象，必须显式收集） */
    _serializeExpressState() {
        if (typeof ExpressState === 'undefined') return null;
        return {
            partners: ExpressState.partners,
            waybills: ExpressState.waybills,
            tracks: ExpressState.tracks,
            bills: ExpressState.bills,
            monthlyStats: ExpressState.monthlyStats,
            totalExpressSpend: ExpressState.totalExpressSpend,
            totalWaybills: ExpressState.totalWaybills,
            defaultCompany: ExpressState.defaultCompany,
            defaultService: ExpressState.defaultService,
            pendingSettlement: ExpressState.pendingSettlement
        };
    }

    /** warehouseState 序列化（替代其独立 localStorage）
     *  性能优化：不再 JSON.parse(JSON.stringify()) 二次克隆——
     *  _collectFullState 返回后立刻被 _stringifyFullState 同步序列化，
     *  中间没有 await/异步变更窗口，外层 stringify 本身会产出等价 JSON，
     *  大存档时省掉一轮全量序列化+反序列化。 */
    _serializeWarehouseState() {
        if (typeof window === 'undefined' || !window.warehouseState) return null;
        try {
            return window.warehouseState.state;
        } catch (e) {
            console.warn('[SaveManager] warehouse 序列化失败:', e);
            return null;
        }
    }

    /** 恢复 ExpressState（优先走官方 deserialize，兼容旧档缺字段） */
    _deserializeExpressState(saved) {
        if (!saved || typeof ExpressState === 'undefined') return;
        try {
            if (typeof ExpressState.deserialize === 'function') {
                ExpressState.deserialize(saved);
                return;
            }
            ExpressState.partners = saved.partners || {};
            ExpressState.waybills = saved.waybills || {};
            ExpressState.tracks = saved.tracks || {};
            ExpressState.bills = saved.bills || {};
            ExpressState.monthlyStats = saved.monthlyStats || {};
            ExpressState.totalExpressSpend = saved.totalExpressSpend || 0;
            ExpressState.totalWaybills = saved.totalWaybills || 0;
            if (saved.defaultCompany) ExpressState.defaultCompany = saved.defaultCompany;
            if (saved.defaultService) ExpressState.defaultService = saved.defaultService;
            ExpressState.pendingSettlement = saved.pendingSettlement || 0;
        } catch (e) {
            console.warn('[SaveManager] ExpressState 恢复失败:', e);
        }
    }

    /** 恢复 warehouseState（缓存到 gameState._pendingWarehouseData，由 warehouseState.init 取用） */
    _deserializeWarehouseState(saved) {
        if (!saved || typeof gameState === 'undefined') return;
        gameState._pendingWarehouseData = saved;
    }

    /** 生成 _meta 摘要（几百字节，用于 localStorage 快速读取） */
    _buildMeta(fullState, hash, rawSize, compressedSize) {
        const s = fullState.state;
        return {
            version: this.SAVE_FORMAT_VERSION,
            stateVersion: s.version,
            gameVersion: (typeof GAME_STATE_VERSION !== 'undefined') ? GAME_STATE_VERSION : 7,
            hash: hash,
            timestamp: Date.now(),
            rawSize: rawSize,
            compressedSize: compressedSize,
            format: this._hasCompression ? 'gzip' : 'raw',
            funds: this.encodeFunds((s.shop && typeof s.shop.funds === 'number') ? s.shop.funds : 0),
            day: (s.gameTime && typeof s.gameTime.day === 'number') ? s.gameTime.day : 0,
            hour: (s.gameTime && typeof s.gameTime.hour === 'number') ? s.gameTime.hour : 0,
            shopName: (s.shop && s.shop.name) ? s.shop.name : '',
            totalOrders: (s.shop && typeof s.shop.totalOrders === 'number') ? s.shop.totalOrders : 0,
            orderCount: Array.isArray(s.orders) ? s.orders.length : 0,
            employeeCount: Array.isArray(s.employees) ? s.employees.length : 0,
            hasExpress: !!fullState.express,
            hasWarehouse: !!fullState.warehouse
        };
    }


    // ==================== 存档保存（原子写-校验-提交） ====================

    /** 当前能力下的原始体积硬上限 */
    _getMaxRawSize() {
        if (this._hasIDB) return this.MAX_ARCHIVE_SIZE_IDB;
        // 降级(localStorage)且支持 gzip：放宽原始体积，落盘前按「压缩后 base64 大小」二次校验（见 _archiveSave 7c）
        if (this._hasCompression) return this.MAX_ARCHIVE_SIZE_LS_GZIP;
        return this.MAX_ARCHIVE_SIZE_LS;
    }

    /**
     * 核心保存方法：序列化 → 哈希 → 压缩 → 写IDB → 写_meta → 写buffer
     * 伪事务：先写 IDB 主体（oncomplete 才算成功），成功后写 localStorage _meta，最后写 sessionStorage buffer
     * 串行化保护：_isSaving 标志 + 队列，防止并发保存导致数据错乱
     */
    async _archiveSave(slot = 'main') {
        // 重新开始期间：拒绝一切写入（含排队），避免清空后旧进度又落盘
        if (this._blockSaving) {
            this._log('WARN', '保存已阻断（重新开始中）slot=' + slot);
            return { success: false, blocked: true, slot: slot };
        }
        // 串行化：若正在保存，排队等待
        if (this._isSaving) {
            this._log('INFO', '保存排队（已有保存进行中）slot=' + slot);
            return new Promise(resolve => {
                this._saveQueue.push({ slot, resolve });
            });
        }
        this._isSaving = true;
        this._setStatus('saving');
        this._log('SAVE', '▶ 开始保存 slot=' + slot + ' tier=' + this.capability.tier);

        try {
            const maxRaw = this._getMaxRawSize();
            let fullState = null;
            let jsonStr = '';
            let utf8Bytes = null;
            let pruned = false;

            // 预裁剪：订单很多时先瘦身，避免序列化过大再失败
            // 性能：裁剪本身也是几十~几百ms 的同步阻塞，加 60s 冷却避免每次保存都裁一遍
            try {
                const oc = (typeof gameState !== 'undefined' && gameState.state && Array.isArray(gameState.state.orders))
                    ? gameState.state.orders.length : 0;
                if (oc > 2500 && typeof gameState._pruneOldData === 'function') {
                    const nowTs = Date.now();
                    if (!this._lastPrePruneAt || nowTs - this._lastPrePruneAt >= this.PRE_PRUNE_COOLDOWN) {
                        this._lastPrePruneAt = nowTs;
                        gameState._pruneOldData(false);
                        pruned = true;
                    }
                }
            } catch (e) { /* ignore */ }

            let built = null;
            let useSliced = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                fullState = this._collectFullState();
                if (!fullState || !fullState.state) {
                    throw new Error('无可保存的游戏状态');
                }
                // 大存档走分片序列化：每片 ~12ms 让出主线程，避免整段 stringify 冻结 UI
                const estSize = this._estimateStateSize(fullState.state, fullState.express, fullState.warehouse);
                useSliced = estSize >= this.SLICED_STRINGIFY_THRESHOLD;
                if (useSliced) {
                    try {
                        built = await this._buildSlicedJson(fullState, { needJson: !this._hasIDB });
                        jsonStr = built.json;
                        utf8Bytes = built.bytes;
                    } catch (e) {
                        console.warn('[SaveManager] 分片序列化失败，回退整段序列化:', e);
                        built = null;
                        useSliced = false;
                    }
                }
                if (!useSliced) {
                    built = null; // 防止残留上一次尝试的分片结果（hash 与 bytes 必须同源）
                    jsonStr = this._stringifyFullState(fullState);
                    utf8Bytes = this._strToUtf8Bytes(jsonStr);
                }

                if (utf8Bytes.length <= maxRaw) break;

                // 超限：先激进裁剪再重试（旧逻辑直接抛错导致永远存不上、也不裁剪）
                this._log('WARN', '存档超限 attempt=' + (attempt + 1) +
                    ' raw=' + (utf8Bytes.length / 1024 / 1024).toFixed(2) + 'MB' +
                    ' max=' + (maxRaw / 1024 / 1024).toFixed(0) + 'MB → 激进裁剪');
                if (typeof gameState !== 'undefined' && typeof gameState._pruneOldData === 'function') {
                    gameState._pruneOldData(true);
                    pruned = true;
                } else {
                    break;
                }
            }

            if (utf8Bytes.length > maxRaw) {
                const limMB = (maxRaw / 1024 / 1024).toFixed(0);
                throw new Error('存档过大: ' + (utf8Bytes.length / 1024 / 1024).toFixed(2) +
                    'MB > ' + limMB + 'MB 上限（请点「清理订单」后再保存）');
            }

            // 4. 哈希计算（对未压缩字节，确保加载时可校验；分片路径已在构建时跨片累计）
            const hash = (built && built.hash) ? built.hash : this._hashDJB2(utf8Bytes);

            // 5. 压缩
            const compressed = await this._gzipCompress(utf8Bytes);
            const format = (compressed !== utf8Bytes) ? 'gzip' : 'raw';
            const ratio = ((1 - compressed.length / utf8Bytes.length) * 100).toFixed(1);
            this._log('SAVE', '序列化完成: raw=' + (utf8Bytes.length / 1024).toFixed(1) + 'KB' +
                ' compressed=' + (compressed.length / 1024).toFixed(1) + 'KB' +
                ' 压缩率=' + ratio + '% format=' + format + ' hash=' + hash +
                ' orders=' + (Array.isArray(fullState.state.orders) ? fullState.state.orders.length : 0) +
                ' day=' + (fullState.state.gameTime ? fullState.state.gameTime.day : '?') +
                ' funds=' + (fullState.state.shop ? fullState.state.shop.funds : '?') +
                (useSliced && built ? ' sliced=1(yield' + built.yields + ')' : '') +
                (pruned ? ' pruned=1' : ''));

            // 6. 构造存档记录
            const record = {
                slot: slot,
                format: format,
                payload: compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
                hash: hash,
                rawSize: utf8Bytes.length,
                compressedSize: compressed.length,
                timestamp: Date.now(),
                gameVersion: (typeof GAME_STATE_VERSION !== 'undefined') ? GAME_STATE_VERSION : 7,
                saveFormatVersion: this.SAVE_FORMAT_VERSION,
                stateVersion: fullState.state.version,
                meta: this._buildMeta(fullState, hash, utf8Bytes.length, compressed.length)
            };

            // 7. 原子提交：先写 IDB 主体，成功后写 _meta，最后写 buffer
            if (this._hasIDB) {
                // 7a. 写 IDB（archives 主记录）
                await this._idbPut('archives', record);
                // 7b. 写 express / warehouse 附属 store（便于独立恢复）
                if (fullState.express) {
                    await this._idbPut('express', { slot: slot, data: fullState.express, hash: hash, timestamp: record.timestamp });
                }
                if (fullState.warehouse) {
                    await this._idbPut('warehouse', { slot: slot, data: fullState.warehouse, hash: hash, timestamp: record.timestamp });
                }
                this._log('SAVE', 'IDB 写入完成: archives/express/warehouse → slot=' + slot);
            } else {
                // 7c. 降级：localStorage 存主体（受 ~5MB 配额限制）
                // 容量优化：支持 gzip 时，若 base64(gzip) 比原始 JSON 更小则存压缩版（6~16MB raw 可压到 ~3MB）
                let lsPayload = jsonStr;
                let lsEncoded = 'raw';
                if (this._hasCompression && compressed !== utf8Bytes && compressed.length < utf8Bytes.length) {
                    const b64 = this._bytesToBase64(compressed);
                    if (b64.length < jsonStr.length) {
                        lsPayload = b64;
                        lsEncoded = 'gzip64';
                    }
                }
                // localStorage 配额按 UTF-16 字符计费，留出 _meta 等余量，最终落盘 payload 仍守 4MB
                if (lsPayload.length > this.MAX_ARCHIVE_SIZE_LS) {
                    throw new Error('存档过大: 压缩后 ' + (lsPayload.length / 1024 / 1024).toFixed(2) +
                        'MB 仍超 localStorage 上限（请点「清理订单」后再保存）');
                }
                this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + slot, lsPayload);
                this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + slot + '_enc', lsEncoded);
                this._log('SAVE', '降级模式: localStorage 写入主体 slot=' + slot + ' enc=' + lsEncoded +
                    ' len=' + (lsPayload.length / 1024).toFixed(1) + 'KB');
            }

            // 7d. 写 _meta 摘要到 localStorage（IDB 成功后才写，保证一致性）
            this._lsPutRaw(this.META_KEY_PREFIX + slot, JSON.stringify(record.meta));

            // 8. 写 sessionStorage 紧急缓冲（仅 main；过大则跳过，避免 5MB 配额炸裂）
            if (slot === 'main') {
                if (utf8Bytes.length <= this.SESSION_BUFFER_MAX) {
                    // IDB 分片路径不保留文本，此处按需从字节流还原（≤2MB，成本可忽略）
                    if (jsonStr == null) jsonStr = this._utf8BytesToStr(utf8Bytes);
                    this._ssPutRaw(this.SESSION_BUFFER_KEY, jsonStr);
                } else {
                    try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (e) {}
                    this._log('WARN', 'sessionBuffer 跳过（' + (utf8Bytes.length / 1024 / 1024).toFixed(1) + 'MB > 2MB）');
                }
            }

            // 9. 预警检查（按展示上限比例提示清理）
            this._checkArchiveWarn(utf8Bytes.length);

            // 10. 更新运行时状态
            this._lastSaveTime = Date.now();
            this._lastError = null; // 成功后清掉旧错误，避免 UI 一直显示「上次 38MB」
            // 用快速哈希标记「当前内存状态已落盘」，避免误用全量 hash 导致防抖跳过失效
            this._lastFastHash = this._computeFastStateHash() || hash;
            if (slot === 'main') this._saveCount++;
            this._setStatus('saved');
            this._log('SAVE', '✓ 保存成功 slot=' + slot + ' hash=' + hash + ' saveCount=' + this._saveCount + (slot === 'main' ? ' (已写sessionBuffer)' : ''));

            return { success: true, hash: hash, size: utf8Bytes.length, compressedSize: compressed.length, slot: slot };

        } catch (e) {
            this._lastError = e;
            this._setStatus('error');
            this._log('ERR', '✗ 保存失败 slot=' + slot + ': ' + (e && e.message ? e.message : e), e);
            // 失败时也尝试裁剪，方便用户下次点保存
            try {
                if (typeof gameState !== 'undefined' && typeof gameState._pruneOldData === 'function') {
                    gameState._pruneOldData(true);
                }
            } catch (_) {}
            if (typeof eventBus !== 'undefined' && eventBus.emit) {
                eventBus.emit('save:error', { slot: slot, error: e });
            }
            return { success: false, error: e, slot: slot };
        } finally {
            this._isSaving = false;
            // 处理队列中下一个保存请求（重置阻断时直接取消队列）
            if (this._blockSaving) {
                while (this._saveQueue.length > 0) {
                    const next = this._saveQueue.shift();
                    try { next.resolve({ success: false, blocked: true, slot: next.slot }); } catch (_) {}
                }
            } else if (this._saveQueue.length > 0) {
                const next = this._saveQueue.shift();
                setTimeout(() => { this._archiveSave(next.slot).then(next.resolve); }, 0);
            }
        }
    }

    /**
     * 重新开始：先阻断保存并等待进行中的写入结束，避免 fullReset 后旧档写回
     */
    async beginResetGate() {
        this._blockSaving = true;
        this._log('WARN', '🔒 beginResetGate：阻断保存');
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        while (this._saveQueue.length > 0) {
            const next = this._saveQueue.shift();
            try { next.resolve({ success: false, blocked: true, slot: next.slot }); } catch (_) {}
        }
        const started = Date.now();
        while (this._isSaving && (Date.now() - started) < 4000) {
            await new Promise(r => setTimeout(r, 40));
        }
        if (this._isSaving) {
            this._log('WARN', 'beginResetGate：等待写入超时，仍继续清空（后续写入会被阻断）');
        }
        return true;
    }

    /** 新建流程就绪后解除保存阻断 */
    endResetGate() {
        this._blockSaving = false;
        this._lastFastHash = '';
        this._log('WARN', '🔓 endResetGate：允许保存');
    }

    /** 防抖保存入口（gameState.saveDebounced 委托）：快速哈希跳过 + 动态防抖 */
    saveDebounced() {
        if (this._blockSaving) return;
        // 1. 快速哈希跳过：状态未变化时不保存
        const fastHash = this._computeFastStateHash();
        if (fastHash && fastHash === this._lastFastHash && this._lastSaveTime > 0) {
            this._log('INFO', '防抖跳过（数据未变）fastHash=' + fastHash);
            return; // 数据未变，跳过
        }
        this._lastFastHash = fastHash;

        // 2. 防抖：清除旧定时器
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }

        // 3. 动态间隔（根据数据规模 5~30s）
        const interval = this._computeDynamicInterval();
        const elapsed = Date.now() - this._lastSaveTime;
        // 保证不超过动态间隔，也不小于 SAVE_MIN_GAP
        const delay = Math.max(this.SAVE_MIN_GAP, Math.min(interval, interval - elapsed));

        this._log('INFO', '防抖安排保存: delay=' + delay + 'ms interval=' + interval + 'ms fastHash=' + fastHash + (this._lastSaveTime > 0 ? ' (距上次' + elapsed + 'ms)' : ' (首次保存)'));
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._archiveSave('main').then(r => {
                if (r.success) {
                    // 成功后滚动备份：每 BACKUP_ROTATE_EVERY 次主档保存，main→bak1→bak2
                    this._maybeRotateBackups();
                }
            });
        }, delay);
    }

    /** 强制立即保存（flushSave 委托）：取消防抖定时器，立即执行 */
    async flushSave() {
        if (this._blockSaving) {
            this._log('WARN', 'flushSave 已阻断（重新开始中）');
            return { success: false, blocked: true };
        }
        this._log('SAVE', '⚡ flushSave 立即保存触发');
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        const r = await this._archiveSave('main');
        if (r.success) this._maybeRotateBackups();
        return r;
    }

    /** 页面卸载紧急保存：同步写 sessionStorage（体积允许时）+ localStorage _meta（仅首次）。
     *  不覆盖已成功保存的 _meta，避免 emergencySave 的 hash 与 IDB 中的 hash 不一致，破坏 L1-L3 恢复。 */
    emergencySave() {
        if (this._blockSaving) {
            this._log('WARN', 'emergencySave 已阻断（重新开始中）');
            return;
        }
        this._log('SAVE', '🚨 emergencySave 紧急保存触发（页面隐藏/卸载）');
        try {
            const fullState = this._collectFullState();
            if (!fullState || !fullState.state) return;
            // 大存档：整段序列化结果必然超过 sessionBuffer 上限被丢弃，
            // 直接跳过，避免页面隐藏/卸载时白白同步阻塞 0.5~2s
            const estSize = this._estimateStateSize(fullState.state, fullState.express, fullState.warehouse);
            if (estSize > this.SESSION_BUFFER_MAX + 512 * 1024) {
                try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (e) {}
                this._log('SAVE', '🚨 紧急保存跳过序列化（预估 ' + (estSize / 1048576).toFixed(1) + 'MB > 2MB 缓冲上限，主档已由防抖保存覆盖）');
                return;
            }
            const jsonStr = this._stringifyFullState(fullState);
            const bytes = this._strToUtf8Bytes(jsonStr);
            const hash = this._hashDJB2(bytes);
            // 过大则跳过 sessionBuffer（浏览器配额约 5MB，20MB+ 必失败且阻塞卸载）
            if (bytes.length <= this.SESSION_BUFFER_MAX) {
                this._ssPutRaw(this.SESSION_BUFFER_KEY, jsonStr);
            } else {
                try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (e) {}
            }
            if (this._lastSaveTime === 0) {
                // 从未成功保存过：写 _meta（raw 格式），让 L1-L3 有机会恢复
                const meta = this._buildMeta(fullState, hash, bytes.length, bytes.length);
                meta.format = 'raw';
                this._lsPutRaw(this.META_KEY_PREFIX + 'main', JSON.stringify(meta));
                this._log('SAVE', '🚨 紧急保存(首次): ' + (bytes.length / 1024).toFixed(1) + 'KB hash=' + hash + ' → sessionBuffer+meta(raw)');
            } else {
                // 已有成功保存：只写 sessionBuffer，不覆盖 _meta（避免 hash 不匹配破坏 IDB 恢复）
                this._log('SAVE', '🚨 紧急保存(增量): ' + (bytes.length / 1024).toFixed(1) + 'KB hash=' + hash +
                    (bytes.length <= this.SESSION_BUFFER_MAX ? ' → sessionBuffer only' : ' → skip sessionBuffer(过大)'));
            }
        } catch (e) {
            this._log('ERR', '紧急保存失败: ' + (e && e.message ? e.message : e), e);
        }
    }

    /** 备份滚动：每 BACKUP_ROTATE_EVERY 次主档保存，bak1→bak2，main→bak1 */
    async _maybeRotateBackups() {
        if (this._saveCount % this.BACKUP_ROTATE_EVERY !== 0) return;
        try {
            const mainMeta = this._lsGetRaw(this.META_KEY_PREFIX + 'main');
            if (!mainMeta) return;
            // bak1 → bak2
            const bak1Meta = this._lsGetRaw(this.META_KEY_PREFIX + 'bak1');
            if (bak1Meta) {
                this._lsPutRaw(this.META_KEY_PREFIX + 'bak2', bak1Meta);
                if (this._hasIDB) {
                    const bak1Rec = await this._idbGet('archives', 'bak1');
                    if (bak1Rec) { bak1Rec.slot = 'bak2'; await this._idbPut('archives', bak1Rec); }
                    const bak1Ex = await this._idbGet('express', 'bak1');
                    if (bak1Ex) { bak1Ex.slot = 'bak2'; await this._idbPut('express', bak1Ex); }
                    const bak1Wh = await this._idbGet('warehouse', 'bak1');
                    if (bak1Wh) { bak1Wh.slot = 'bak2'; await this._idbPut('warehouse', bak1Wh); }
                } else {
                    const bak1Raw = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + 'bak1');
                    if (bak1Raw) this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + 'bak2', bak1Raw);
                }
            }
            // main → bak1
            this._lsPutRaw(this.META_KEY_PREFIX + 'bak1', mainMeta);
            if (this._hasIDB) {
                const mainRec = await this._idbGet('archives', 'main');
                if (mainRec) { mainRec.slot = 'bak1'; await this._idbPut('archives', mainRec); }
                const mainEx = await this._idbGet('express', 'main');
                if (mainEx) { mainEx.slot = 'bak1'; await this._idbPut('express', mainEx); }
                const mainWh = await this._idbGet('warehouse', 'main');
                if (mainWh) { mainWh.slot = 'bak1'; await this._idbPut('warehouse', mainWh); }
            } else {
                const mainRaw = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + 'main');
                if (mainRaw) this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + 'bak1', mainRaw);
            }
        } catch (e) {
            console.warn('[SaveManager] 备份滚动失败:', e);
        }
    }


    // ==================== 存档加载（9 层 fallback + 自愈回写） ====================

    /**
     * 9 层 fallback 读取链：
     * L1-L3: localStorage _meta + IDB 主体（main/bak1/bak2）
     * L4-L6: IDB only（无 _meta 时，可能 _meta 丢失但 IDB 完好）（main/bak1/bak2）
     * L7: 5 份历史快照 snap_0~snap_4（按时间倒序）
     * L8: sessionStorage 紧急缓冲
     * L9: 返回 null（用 INITIAL_GAME_STATE）
     */
    async _archiveLoad() {
        const slots = ['main', 'bak1', 'bak2'];
        let result = null;
        this._log('LOAD', '▶ 开始加载存档 tier=' + this.capability.tier + ' idb=' + this._hasIDB + ' gzip=' + this._hasCompression);

        // Phase 1: 同步快速读取 localStorage _meta（UI 可立即展示）
        for (const slot of slots) {
            const meta = this._lsGetRaw(this.META_KEY_PREFIX + slot);
            if (meta) {
                try {
                    const parsed = JSON.parse(meta);
                    if (parsed && parsed.hash) {
                        this._phase1Meta = parsed;
                        this._log('LOAD', 'Phase1 _meta 命中 slot=' + slot + ' hash=' + parsed.hash +
                            ' day=' + parsed.day + ' funds=' + parsed.funds + ' orders=' + parsed.orderCount +
                            ' raw=' + (parsed.rawSize / 1024).toFixed(1) + 'KB' +
                            ' saved=' + new Date(parsed.timestamp).toLocaleTimeString('zh-CN', { hour12: false }));
                        break;
                    }
                } catch (e) {}
            }
        }
        if (!this._phase1Meta) {
            this._log('LOAD', 'Phase1 _meta 未命中（无任何 localStorage 摘要）');
        }

        // Phase 2: 异步读取完整数据（9 层 fallback）
        // L1-L3: _meta + IDB 主体
        for (const slot of slots) {
            result = await this._tryLoadFromSlot(slot);
            if (result) {
                if (slot !== 'main') {
                    this._log('WARN', '主档损坏/缺失，从 ' + slot + ' 自愈回写 main');
                }
                break;
            }
        }
        if (result) {
            this._log('LOAD', 'L1-L3 命中: slot=' + result.source);
        } else {
            this._log('LOAD', 'L1-L3 未命中（main/bak1/bak2 的 _meta+IDB 均无可用数据）');
        }

        // L4-L6: 直接读 IDB（无 _meta 时）
        if (!result && this._hasIDB) {
            for (const slot of slots) {
                result = await this._tryLoadFromIDBOnly(slot);
                if (result) {
                    this._log('WARN', '_meta 丢失，从 IDB ' + slot + ' 恢复');
                    break;
                }
            }
            if (result) {
                this._log('LOAD', 'L4-L6 命中: slot=' + result.source);
            } else {
                this._log('LOAD', 'L4-L6 未命中（IDB 直接读取也无数据）');
            }
        }

        // L7: 5 份历史快照（按时间倒序）
        if (!result) {
            result = await this._tryLoadFromHistory();
            if (result) this._log('WARN', '从历史快照恢复: ' + result.source);
            else this._log('LOAD', 'L7 历史快照未命中');
        }

        // L8: sessionStorage 紧急缓冲（新版）
        if (!result) {
            const buf = this._ssGetRaw(this.SESSION_BUFFER_KEY);
            if (buf) {
                try {
                    const parsed = JSON.parse(buf);
                    const normalized = this._normalizeToFullState(parsed);
                    if (normalized) {
                        this._decodeFundsInState(normalized.state);
                        const bytes = this._strToUtf8Bytes(buf);
                        const hash = this._hashDJB2(bytes);
                        result = { fullState: normalized, hash: hash, source: 'session_buffer', timestamp: Date.now() };
                        this._log('WARN', '从 sessionStorage 紧急缓冲恢复');
                    }
                } catch (e) {}
            }
            if (!result) this._log('LOAD', 'L8 sessionStorage 缓冲未命中');
        }

        // L8.5: 旧版存档迁移（localStorage 三副本 / 旧 IDB saves / 旧紧急缓冲 / 旧快照）
        // 这是升级后进度丢失的核心修复：新系统此前完全不读 ecommerce_sim_save*
        if (!result) {
            result = await this._tryLoadLegacySave();
            if (result) {
                this._migratedFromLegacy = true;
                this._log('WARN', '✓ 已从旧版存档迁移: source=' + result.source);
            } else {
                this._log('LOAD', 'L8.5 旧版存档未命中');
            }
        }

        // L9: 全部失败
        if (!result) {
            this._log('WARN', '⚠ 所有 fallback 均失败，使用全新初始状态');
            return null;
        }

        // 哈希说明：解码阶段已对解压字节做过校验；此处不再 JSON.stringify 重算，
        // 因为对象键序/属性顺序变化会导致假阳性「损坏」警告。
        if (result.hash && !result.corrupted) {
            this._log('LOAD', '✓ 完整性已在解码阶段确认 hash=' + result.hash + ' (source=' + result.source + ')');
        } else if (result.corrupted) {
            this._log('WARN', '存档标记为可疑，但仍尝试使用 source=' + result.source);
        }

        // 加载摘要
        const fs = result.fullState;
        const s = fs && fs.state;
        this._log('LOAD', '✓ 加载完成 source=' + result.source +
            ' day=' + (s && s.gameTime ? s.gameTime.day : '?') +
            ' funds=' + (s && s.shop ? s.shop.funds : '?') +
            ' orders=' + (s && Array.isArray(s.orders) ? s.orders.length : '?') +
            ' inventory=' + (s && Array.isArray(s.inventory) ? s.inventory.length : '?') +
            ' hasExpress=' + !!fs.express + ' hasWarehouse=' + !!fs.warehouse +
            (result.corrupted ? ' [哈希异常]' : ''));

        return result;
    }

    /** 从指定 slot 加载（_meta 验证存在 + IDB 主体） */
    async _tryLoadFromSlot(slot) {
        const meta = this._lsGetRaw(this.META_KEY_PREFIX + slot);
        if (!meta) return null;
        let parsedMeta;
        try { parsedMeta = JSON.parse(meta); } catch (e) { return null; }
        if (!parsedMeta || !parsedMeta.hash) return null;

        if (this._hasIDB) {
            const record = await this._idbGet('archives', slot);
            if (record && record.hash === parsedMeta.hash) {
                this._log('LOAD', '  slot=' + slot + ' IDB记录命中 hash匹配');
                return await this._decodeArchiveRecord(record, slot);
            }
            if (record && record.payload) {
                this._log('WARN', '  slot=' + slot + ' IDB有记录但hash不匹配 meta=' + parsedMeta.hash + ' idb=' + (record.hash || '?') + '，尝试软加载');
                const soft = await this._decodeArchiveRecord(record, slot);
                if (soft) {
                    soft.corrupted = true;
                    return soft;
                }
            }
        } else {
            // 降级：localStorage 主体（支持 gzip64 压缩）
            const enc = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + slot + '_enc') || 'raw';
            const raw = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + slot);
            if (raw) {
                try {
                    let fullState;
                    let hashBytes;
                    if (enc === 'gzip64' && this._hasCompression) {
                        const rawBytes = await this._gzipDecompress(this._base64ToBytes(raw));
                        hashBytes = rawBytes;
                        fullState = JSON.parse(this._utf8BytesToStr(rawBytes));
                    } else {
                        hashBytes = this._strToUtf8Bytes(raw);
                        fullState = JSON.parse(raw);
                    }
                    this._decodeFundsInState(fullState.state);
                    const hash = this._hashDJB2(hashBytes);
                    const corrupted = hash !== parsedMeta.hash;
                    if (corrupted) {
                        this._log('WARN', '  slot=' + slot + ' localStorage主体可解析但hash不匹配，软加载');
                    } else {
                        this._log('LOAD', '  slot=' + slot + ' localStorage主体命中 hash匹配 enc=' + enc);
                    }
                    return {
                        fullState: fullState,
                        hash: hash,
                        source: slot,
                        timestamp: parsedMeta.timestamp,
                        corrupted: corrupted
                    };
                } catch (e) {}
            }
        }
        return null;
    }

    /** 直接从 IDB 加载（无 _meta 验证，用于 _meta 丢失场景） */
    async _tryLoadFromIDBOnly(slot) {
        if (!this._hasIDB) return null;
        try {
            const record = await this._idbGet('archives', slot);
            if (record && record.payload) {
                return await this._decodeArchiveRecord(record, slot);
            }
        } catch (e) {}
        return null;
    }

    /** 从历史快照加载（按时间倒序，取最新可用的） */
    async _tryLoadFromHistory() {
        if (!this._hasIDB) return null;
        const snaps = [];
        for (let i = 0; i < this.HISTORY_MAX; i++) {
            try {
                const rec = await this._idbGet('archives', 'snap_' + i);
                snaps.push({ idx: i, ts: (rec && rec.timestamp) || 0, rec: rec });
            } catch (e) { snaps.push({ idx: i, ts: 0, rec: null }); }
        }
        // 按时间倒序
        snaps.sort((a, b) => b.ts - a.ts);
        for (const s of snaps) {
            if (s.rec && s.rec.payload) {
                const result = await this._decodeArchiveRecord(s.rec, 'snap_' + s.idx);
                if (result) return result;
            }
        }
        return null;
    }

    /** 解码存档记录：解压 + 反序列化 + 哈希校验 + 补充 express/warehouse */
    async _decodeArchiveRecord(record, source) {
        try {
            let bytes;
            if (record.format === 'gzip') {
                const compressed = new Uint8Array(record.payload);
                bytes = await this._gzipDecompress(compressed);
            } else {
                bytes = new Uint8Array(record.payload);
            }
            const jsonStr = this._utf8BytesToStr(bytes);
            const fullState = JSON.parse(jsonStr);
            this._decodeFundsInState(fullState.state);

            // 哈希校验（对解压后的字节）：不匹配仍软加载，标记 corrupted 供上层修复写回
            let corrupted = false;
            if (record.hash) {
                const actualHash = this._hashDJB2(bytes);
                if (actualHash !== record.hash) {
                    corrupted = true;
                    this._log('WARN', '  解码 ' + source + ' 哈希不匹配 expected=' + record.hash + ' actual=' + actualHash + '，软加载并标记 corrupted');
                }
            }

            // 补充 express / warehouse（若主记录里没带，从独立 store 读）
            if (!fullState.express && this._hasIDB) {
                try {
                    const ex = await this._idbGet('express', source);
                    if (ex) fullState.express = ex.data;
                } catch (e) {}
            }
            if (!fullState.warehouse && this._hasIDB) {
                try {
                    const wh = await this._idbGet('warehouse', source);
                    if (wh) fullState.warehouse = wh.data;
                } catch (e) {}
            }

            this._log('LOAD', '  解码 ' + source + (corrupted ? '（哈希异常软恢复）' : ' 成功') + ': format=' + record.format +
                ' decompressed=' + (bytes.length / 1024).toFixed(1) + 'KB' +
                ' hasExpress=' + !!fullState.express + ' hasWarehouse=' + !!fullState.warehouse);

            return {
                fullState: fullState,
                hash: record.hash,
                source: source,
                timestamp: record.timestamp,
                corrupted: corrupted
            };
        } catch (e) {
            this._log('ERR', '  解码 ' + source + ' 失败: ' + (e && e.message ? e.message : e), e);
            return null;
        }
    }


    // ==================== 旧版存档迁移（ecommerce_sim_save* / IDB saves） ====================

    /**
     * 启动时快速判断是否存在任何可恢复进度（含旧版 key）。
     * 供 index.html 决定是否跳过「新建店铺」流程。同步，不读 IDB。
     */
    hasAnySave() {
        // 新版 _meta
        for (const slot of ['main', 'bak1', 'bak2']) {
            if (this._lsGetRaw(this.META_KEY_PREFIX + slot)) return true;
        }
        // 新版降级主体
        for (const slot of ['main', 'bak1', 'bak2']) {
            if (this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + slot)) return true;
        }
        // 旧版三副本 + 紧急缓冲
        for (const k of this.LEGACY_KEYS) {
            if (this._lsGetRaw(k)) return true;
        }
        // 旧版历史快照
        for (let i = 0; i < 5; i++) {
            if (this._lsGetRaw(this.LEGACY_SNAP_PREFIX + i)) return true;
        }
        // 新版 session 缓冲
        if (this._ssGetRaw(this.SESSION_BUFFER_KEY)) return true;
        // 旧版 session 紧急缓冲
        if (this._ssGetRaw(this.LEGACY_SAVE_KEY + '_emergency')) return true;
        return false;
    }

    /** 异步探测 IndexedDB 是否有可恢复存档（新版 archives 或旧版 saves） */
    async probeIDBHasSave() {
        if (!this._hasIDB) return false;
        try {
            const db = await this._idbOpen();
            const checkStore = (storeName, slots) => new Promise((resolve) => {
                try {
                    if (!db.objectStoreNames.contains(storeName)) { resolve(false); return; }
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);
                    let pending = slots.length;
                    let found = false;
                    slots.forEach((slot) => {
                        const r = store.get(slot);
                        r.onsuccess = () => {
                            if (r.result) found = true;
                            pending--;
                            if (pending === 0) resolve(found);
                        };
                        r.onerror = () => {
                            pending--;
                            if (pending === 0) resolve(found);
                        };
                    });
                } catch (e) { resolve(false); }
            });
            if (await checkStore('archives', ['main', 'bak1', 'bak2', 'snap_0', 'snap_1'])) return true;
            if (await checkStore(this.LEGACY_IDB_STORE, ['main', 'backup'])) return true;
            return false;
        } catch (e) {
            return false;
        }
    }

    /** 拆解旧版 SAVE|v2|len|hash|stamp|json 签名头；兼容纯 JSON */
    _unwrapLegacySignedJSON(raw) {
        if (!raw || typeof raw !== 'string') return null;
        if (raw.indexOf('SAVE|v2|') === 0) {
            try {
                const firstPipe = raw.indexOf('|', 7);
                const second = raw.indexOf('|', firstPipe + 1);
                const third = raw.indexOf('|', second + 1);
                const fourth = raw.indexOf('|', third + 1);
                if (firstPipe < 0 || second < 0 || third < 0 || fourth < 0) return null;
                const len = parseInt(raw.substring(firstPipe + 1, second), 10);
                const hash = parseInt(raw.substring(second + 1, third), 10);
                const savedAt = parseInt(raw.substring(third + 1, fourth), 10);
                const json = raw.substring(fourth + 1);
                if (!isFinite(len) || !isFinite(hash) || json.length !== len) return null;
                // 旧版哈希按 charCode&0xff 计算，与本系统 UTF8 DJB2 不同，这里只校验长度；内容靠 JSON.parse+_isValidLegacyState
                return { json: json, savedAt: isFinite(savedAt) ? savedAt : 0 };
            } catch (e) { return null; }
        }
        const s = raw.trim();
        if ((s.charAt(0) === '{' || s.charAt(0) === '[') && s.length > 50) {
            return { json: raw, savedAt: 0 };
        }
        return null;
    }

    /** 旧版 state 合法性（字段比新版 _isValidState 稍宽，兼容残缺降级档） */
    _isValidLegacyState(obj) {
        if (!obj || typeof obj !== 'object') return false;
        // 新版包装格式
        if (obj.state && obj.state.shop && obj.state.gameTime) {
            return typeof obj.state.shop.funds === 'number' && typeof obj.state.gameTime.day === 'number';
        }
        // 旧版：直接就是 state
        if (!obj.shop || !obj.gameTime) return false;
        if (typeof obj.shop.funds !== 'number') return false;
        if (typeof obj.gameTime.day !== 'number') return false;
        return true;
    }

    /**
     * 把任意解析结果规范为新版 fullState: { state, express, warehouse, _saveMeta }
     * 支持：旧版裸 state、旧版带 expressData、新版 fullState
     */
    _normalizeToFullState(parsed) {
        if (!parsed || typeof parsed !== 'object') return null;
        // 已是新版包装
        if (parsed.state && parsed.state.shop && parsed.state.gameTime) {
            const state = parsed.state;
            this._decodeFundsInState(state);
            const sane = this._sanitizeLoadedState(state);   // 读档数值体检：NaN/负数/离谱值收口
            let express = parsed.express || null;
            if (!express && state.expressData) {
                express = state.expressData;
            }
            let warehouse = parsed.warehouse || null;
            if (!warehouse) {
                try {
                    const raw = this._lsGetRaw(this.OLD_WAREHOUSE_KEY);
                    if (raw) warehouse = JSON.parse(raw);
                } catch (e) {}
            }
            return {
                state: state,
                express: express,
                warehouse: warehouse,
                _saveMeta: Object.assign({}, parsed._saveMeta || {
                    gameVersion: (typeof GAME_STATE_VERSION !== 'undefined') ? GAME_STATE_VERSION : 7,
                    saveFormatVersion: this.SAVE_FORMAT_VERSION,
                    timestamp: Date.now(),
                    migrated: true
                }, sane.fixed.length ? { sanitized: sane.fixed } : {})
            };
        }
        // 旧版裸 state
        if (!this._isValidLegacyState(parsed)) return null;
        const state = parsed;
        this._decodeFundsInState(state);
        const saneLegacy = this._sanitizeLoadedState(state);   // 读档数值体检：NaN/负数/离谱值收口
        let express = null;
        if (state.expressData) {
            express = state.expressData;
        }
        let warehouse = null;
        try {
            const raw = this._lsGetRaw(this.OLD_WAREHOUSE_KEY);
            if (raw) warehouse = JSON.parse(raw);
        } catch (e) {}
        return {
            state: state,
            express: express,
            warehouse: warehouse,
            _saveMeta: Object.assign({
                gameVersion: state.version || 7,
                saveFormatVersion: this.SAVE_FORMAT_VERSION,
                timestamp: Date.now(),
                migrated: true
            }, saneLegacy.fixed.length ? { sanitized: saneLegacy.fixed } : {})
        };
    }

    /** 解析旧版 localStorage/sessionStorage 原始字符串 → fullState 结果 */
    _parseLegacyRaw(raw, source) {
        const unwrapped = this._unwrapLegacySignedJSON(raw);
        if (!unwrapped) return null;
        try {
            const parsed = JSON.parse(unwrapped.json);
            const fullState = this._normalizeToFullState(parsed);
            if (!fullState) return null;
            return {
                fullState: fullState,
                hash: null, // 旧档无新版哈希，跳过校验
                source: source,
                timestamp: unwrapped.savedAt || Date.now(),
                legacy: true
            };
        } catch (e) {
            return null;
        }
    }

    /** 从旧版 IndexedDB `saves` store 读取 main/backup */
    async _tryLoadLegacyIDB() {
        if (!this._hasIDB) return null;
        try {
            const db = await this._idbOpen();
            if (!db.objectStoreNames.contains(this.LEGACY_IDB_STORE)) return null;
            for (const slot of ['main', 'backup']) {
                try {
                    const rec = await new Promise((resolve, reject) => {
                        const tx = db.transaction(this.LEGACY_IDB_STORE, 'readonly');
                        const store = tx.objectStore(this.LEGACY_IDB_STORE);
                        const r = store.get(slot);
                        r.onsuccess = () => resolve(r.result || null);
                        r.onerror = () => reject(r.error);
                    });
                    if (!rec || !rec.data) continue;
                    const algo = (rec.header && rec.header.algo) || 'raw';
                    let bytes;
                    const payload = rec.data instanceof ArrayBuffer ? new Uint8Array(rec.data)
                        : (rec.data instanceof Uint8Array ? rec.data : new Uint8Array(rec.data));
                    if (algo === 'gzip') {
                        bytes = await this._gzipDecompress(payload);
                    } else {
                        bytes = payload;
                    }
                    const jsonStr = this._utf8BytesToStr(bytes);
                    const parsed = JSON.parse(jsonStr);
                    const fullState = this._normalizeToFullState(parsed);
                    if (!fullState) continue;
                    this._log('LOAD', '  旧版 IDB saves/' + slot + ' 解码成功 day=' +
                        (fullState.state.gameTime && fullState.state.gameTime.day));
                    return {
                        fullState: fullState,
                        hash: null,
                        source: 'legacy_idb_' + slot,
                        timestamp: (rec.header && rec.header.savedAt) || rec.updatedAt || Date.now(),
                        legacy: true
                    };
                } catch (e) {
                    this._log('WARN', '  旧版 IDB saves/' + slot + ' 读取失败: ' + (e && e.message ? e.message : e));
                }
            }
        } catch (e) {
            this._log('WARN', '旧版 IDB 迁移异常: ' + (e && e.message ? e.message : e));
        }
        return null;
    }

    /**
     * 旧版完整 fallback：
     * ls-main → ls-bak1 → ls-bak2 → IDB saves → 旧 snap_0..4 → 旧 session 紧急缓冲
     */
    async _tryLoadLegacySave() {
        const lsOrder = [
            { key: this.LEGACY_SAVE_KEY, source: 'legacy_ls_main' },
            { key: this.LEGACY_SAVE_KEY + '_backup', source: 'legacy_ls_bak1' },
            { key: this.LEGACY_SAVE_KEY + '_bak2', source: 'legacy_ls_bak2' }
        ];
        for (const item of lsOrder) {
            const raw = this._lsGetRaw(item.key);
            if (!raw) continue;
            const result = this._parseLegacyRaw(raw, item.source);
            if (result) {
                this._log('LOAD', '旧版 localStorage 命中: ' + item.source +
                    ' day=' + (result.fullState.state.gameTime && result.fullState.state.gameTime.day) +
                    ' funds=' + (result.fullState.state.shop && result.fullState.state.shop.funds));
                return result;
            }
        }

        const idbResult = await this._tryLoadLegacyIDB();
        if (idbResult) return idbResult;

        for (let i = 0; i < 5; i++) {
            const raw = this._lsGetRaw(this.LEGACY_SNAP_PREFIX + i);
            if (!raw) continue;
            const result = this._parseLegacyRaw(raw, 'legacy_snap_' + i);
            if (result) {
                this._log('LOAD', '旧版快照命中: snap_' + i);
                return result;
            }
        }

        const emg = this._ssGetRaw(this.LEGACY_SAVE_KEY + '_emergency');
        if (emg) {
            const result = this._parseLegacyRaw(emg, 'legacy_session_emergency');
            if (result) {
                this._log('LOAD', '旧版 session 紧急缓冲命中');
                return result;
            }
        }
        return null;
    }

    /** 迁移成功后清理旧 key（在已写入新版 main 之后调用，避免中途失败丢档） */
    _cleanupLegacyKeysAfterMigrate() {
        try {
            for (const k of this.LEGACY_KEYS) this._lsRemove(k);
            for (let i = 0; i < 5; i++) this._lsRemove(this.LEGACY_SNAP_PREFIX + i);
            if (this._safeSessionStorage()) {
                try { sessionStorage.removeItem(this.LEGACY_SAVE_KEY + '_emergency'); } catch (e) {}
            }
            this._log('INFO', '旧版 localStorage/session 存档 key 已清理（已迁移到新系统）');
        } catch (e) {}
    }


    // ==================== 快照管理 ====================

    /** 启动自动快照循环（游戏初始化后2分钟启动，之后每6分钟） */
    startSnapshotLoop() {
        if (this._snapshotStarted) return;
        this._snapshotStarted = true;
        this._log('SNAP', '启动快照循环: ' + (this.SNAPSHOT_INITIAL_DELAY / 1000) + 's 后首次，之后每 ' + (this.SNAPSHOT_INTERVAL / 60000) + 'min');
        setTimeout(() => {
            this._takeSnapshot();
            this._snapshotTimer = setInterval(() => {
                this._takeSnapshot();
            }, this.SNAPSHOT_INTERVAL);
        }, this.SNAPSHOT_INITIAL_DELAY);
    }

    stopSnapshotLoop() {
        if (this._snapshotTimer) { clearInterval(this._snapshotTimer); this._snapshotTimer = null; }
        this._snapshotStarted = false;
        this._log('SNAP', '快照循环已停止');
    }

    /** 取一份快照（保留最近 HISTORY_MAX 份，滚动覆盖最旧的） */
    async _takeSnapshot() {
        try {
            // 找最旧的快照 slot
            const snaps = [];
            for (let i = 0; i < this.HISTORY_MAX; i++) {
                let ts = 0;
                if (this._hasIDB) {
                    try { const rec = await this._idbGet('archives', 'snap_' + i); ts = (rec && rec.timestamp) || 0; } catch (e) {}
                }
                snaps.push({ idx: i, ts: ts });
            }
            snaps.sort((a, b) => a.ts - b.ts);
            const targetSlot = 'snap_' + snaps[0].idx;

            this._log('SNAP', '📸 开始快照 → ' + targetSlot + ' (覆盖最旧快照)');
            // 保存快照（复用 _archiveSave）
            const result = await this._archiveSave(targetSlot);
            if (result.success) {
                this._updateHistoryIndex(targetSlot, result);
                this._log('SNAP', '📸 快照完成 ' + targetSlot + ' hash=' + result.hash + ' size=' + (result.size / 1024).toFixed(1) + 'KB');
            }
            return result;
        } catch (e) {
            this._log('ERR', '快照失败: ' + (e && e.message ? e.message : e), e);
        }
    }

    _updateHistoryIndex(slot, result) {
        try {
            const idx = this._lsGetRaw(this.HISTORY_INDEX_KEY);
            let arr = idx ? JSON.parse(idx) : [];
            arr = arr.filter(x => x.slot !== slot);
            arr.push({ slot: slot, timestamp: Date.now(), hash: result.hash, size: result.size });
            arr = arr.slice(-this.HISTORY_MAX);
            this._lsPutRaw(this.HISTORY_INDEX_KEY, JSON.stringify(arr));
        } catch (e) {}
    }


    // ==================== 预警处理 ====================

    _checkArchiveWarn(rawSize) {
        if (rawSize > this.MAX_ARCHIVE_SIZE) {
            // 红色预警（超上限已被 _archiveSave 拒绝，此处兜底）
            this._handleArchiveWarn(rawSize, 2);
        } else if (rawSize > this.WARN_ARCHIVE_SIZE) {
            this._handleArchiveWarn(rawSize, 1);
        } else {
            // 恢复正常
            if (this._warnLevel > 0) this._warnLevel = 0;
        }
    }

    _handleArchiveWarn(rawSize, level) {
        const newLevel = level || 1;
        // 同等级仅提示一次，升级才重提示
        if (newLevel <= this._warnLevel) return;
        this._warnLevel = newLevel;

        const sizeMB = (rawSize / 1024 / 1024).toFixed(2);
        const pct = ((rawSize / this.MAX_ARCHIVE_SIZE) * 100).toFixed(1);
        console.warn('[SaveManager] 存档体积预警: ' + sizeMB + 'MB (' + pct + '% 上限)');

        if (typeof eventBus !== 'undefined' && eventBus.emit) {
            eventBus.emit('save:warm', { sizeMB: sizeMB, pct: pct, rawSize: rawSize, level: newLevel });
        }
        // 触发自动裁剪
        if (newLevel >= 1 && typeof gameState !== 'undefined' && gameState._pruneOldData) {
            try { gameState._pruneOldData(newLevel >= 2); } catch (e) {}
        }
    }


    // ==================== 存档信息查询 ====================

    async getArchiveInfo() {
        const info = {
            capability: this.capability,
            slots: {},
            history: [],
            totalSize: 0,
            lastSaveTs: 0,
            lastError: this._lastError ? this._lastError.message : null,
            status: this._status,
            warnLevel: this._warnLevel
        };

        // 主/备 slot 信息（从 _meta 读，无需解压）
        for (const slot of ['main', 'bak1', 'bak2']) {
            const meta = this._lsGetRaw(this.META_KEY_PREFIX + slot);
            if (meta) {
                try {
                    const m = JSON.parse(meta);
                    info.slots[slot] = m;
                    info.totalSize += m.compressedSize || m.rawSize || 0;
                    if (m.timestamp > info.lastSaveTs) info.lastSaveTs = m.timestamp;
                } catch (e) {}
            }
        }

        // 历史快照索引
        const hIdx = this._lsGetRaw(this.HISTORY_INDEX_KEY);
        if (hIdx) {
            try { info.history = JSON.parse(hIdx); } catch (e) {}
        }

        // IDB keys（诊断用）
        if (this._hasIDB) {
            try { info.idbKeys = await this._idbGetAllKeys('archives'); } catch (e) {}
        }

        return info;
    }


    // ==================== 清理操作 ====================

    async cleanupArchive(options) {
        options = options || {};
        const result = { cleanedSize: 0, details: {} };

        if (options.clearRedundant) {
            // 清理冗余：删除所有历史快照 + 备份（保留 main）
            for (let i = 0; i < this.HISTORY_MAX; i++) {
                const slot = 'snap_' + i;
                if (this._hasIDB) {
                    try {
                        const rec = await this._idbGet('archives', slot);
                        if (rec) {
                            result.cleanedSize += rec.compressedSize || 0;
                            await this._idbDelete('archives', slot);
                            await this._idbDelete('express', slot);
                            await this._idbDelete('warehouse', slot);
                        }
                    } catch (e) {}
                }
            }
            this._lsRemove(this.HISTORY_INDEX_KEY);
            result.details.snapshots = 'cleared';
        }

        if (options.clearOrders) {
            // 清理订单：对【当前内存】激进裁剪（勿从磁盘旧档覆盖内存，否则会丢进度）
            if (typeof gameState !== 'undefined' && gameState.state && typeof gameState._pruneOldData === 'function') {
                const before = (gameState.state.orders && gameState.state.orders.length) || 0;
                const pruned = gameState._pruneOldData(true) || {};
                // 再砍一轮：终态只留 1 天、最多 300 条
                const now = gameState.state.gameTime || { day: 1, hour: 0 };
                const terminal = new Set(['completed', 'cancelled', 'returned', 'refunded']);
                if (Array.isArray(gameState.state.orders)) {
                    gameState.state.orders = gameState.state.orders.filter(o => {
                        if (!o || !terminal.has(o.status)) return !!o;
                        const t = o.completeTime || o.cancelTime || o.createTime;
                        if (!t) return false;
                        const hours = (now.day - t.day) * 24 + (now.hour - (t.hour || 0));
                        return hours < 24;
                    });
                    const act = gameState.state.orders.filter(o => !terminal.has(o.status));
                    let done = gameState.state.orders.filter(o => terminal.has(o.status));
                    if (done.length > 300) done = done.slice(0, 300);
                    gameState.state.orders = act.concat(done);
                }
                const after = (gameState.state.orders && gameState.state.orders.length) || 0;
                result.details.orders = {
                    before: before,
                    after: after,
                    removed: before - after,
                    prunedOrdersBefore: pruned.ordersBefore,
                    prunedOrdersAfter: pruned.ordersAfter
                };
                result.cleanedSize = Math.max(0, before - after);
                const saveRes = await this._archiveSave('main');
                if (!saveRes || !saveRes.success) {
                    throw (saveRes && saveRes.error) || new Error('清理后保存失败');
                }
            }
        }

        if (options.deleteBackups) {
            // 删除备份档
            for (const slot of ['bak1', 'bak2']) {
                if (this._hasIDB) {
                    try {
                        await this._idbDelete('archives', slot);
                        await this._idbDelete('express', slot);
                        await this._idbDelete('warehouse', slot);
                    } catch (e) {}
                }
                this._lsRemove(this.META_KEY_PREFIX + slot);
                this._lsRemove(this.ARCHIVE_LS_KEY_PREFIX + slot);
            }
            result.details.backups = 'deleted';
        }

        if (options.forceSave) {
            await this._archiveSave('main');
            result.details.forceSave = 'done';
        }

        return result;
    }

    /** 完整重置：清空 IDB + localStorage 存档相关 key + sessionStorage buffer（供 _doResetGame 调用） */
    async fullReset() {
        this._log('WARN', '🔄 fullReset 完整重置存档系统');
        // 重置期间始终阻断，防止异步写入把旧档写回
        this._blockSaving = true;
        // 1. 停止快照循环
        this.stopSnapshotLoop();
        // 2. 取消待保存定时器 + 清空队列
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        while (this._saveQueue.length > 0) {
            const next = this._saveQueue.shift();
            try { next.resolve({ success: false, blocked: true, slot: next.slot }); } catch (_) {}
        }
        // 3. 清空 IDB
        await this._idbClearAll();
        // 4. 清空 localStorage 存档相关 key（含旧版 ecommerce_sim_save*）
        const prefixes = [this.META_KEY_PREFIX, this.ARCHIVE_LS_KEY_PREFIX, this.LEGACY_SNAP_PREFIX, this.LEGACY_SAVE_KEY];
        const exactKeys = [this.HISTORY_INDEX_KEY, this.SESSION_BUFFER_KEY, this.OLD_WAREHOUSE_KEY].concat(this.LEGACY_KEYS);
        if (this._safeLocalStorage()) {
            try {
                const toRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k) continue;
                    if (prefixes.some(p => k.startsWith(p)) || exactKeys.includes(k)) {
                        toRemove.push(k);
                    }
                }
                toRemove.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
            } catch (e) {}
        }
        // 5. 清空 sessionStorage buffer（含旧版紧急缓冲）
        if (this._safeSessionStorage()) {
            try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (e) {}
            try { sessionStorage.removeItem(this.LEGACY_SAVE_KEY + '_emergency'); } catch (e) {}
        }
        // 6. 重置运行时状态
        this._lastSaveTime = 0;
        this._lastFastHash = '';
        this._saveCount = 0;
        this._warnLevel = 0;
        this._phase1Meta = null;
        this._lastError = null;
        this._setStatus('pending');
        this._log('WARN', '🔄 fullReset 完成: IDB已清空 + localStorage存档key已清 + sessionBuffer已清');
        return true;
    }


    // ==================== 快速状态哈希（跳过未变存档） ====================

    /** 采样关键字段计算快速哈希，不序列化全量（性能优化） */
    _computeFastStateHash() {
        const gs = (typeof gameState !== 'undefined') ? gameState.state : null;
        if (!gs) return '';
        // 额外采样库存总量、上架价合计、订单状态签名，避免「数量不变但内容变了」漏存
        let invQty = 0;
        if (Array.isArray(gs.inventory)) {
            for (let i = 0; i < gs.inventory.length; i++) invQty += (gs.inventory[i].quantity || 0);
        }
        let listingPriceSum = 0;
        if (Array.isArray(gs.listings)) {
            for (let i = 0; i < gs.listings.length; i++) listingPriceSum += (gs.listings[i].price || 0);
        }
        let orderStatusSig = 0;
        if (Array.isArray(gs.orders) && gs.orders.length > 0) {
            const last = gs.orders[gs.orders.length - 1];
            orderStatusSig = (last.status || '').length + (last.id || '').length + gs.orders.length * 17;
        }
        let whPmSig = 0;
        const pm = gs.warehouse && gs.warehouse.packagingMaterials;
        if (pm && typeof pm === 'object') {
            for (const k of Object.keys(pm)) {
                const v = pm[k];
                whPmSig += (typeof v === 'number' ? v : (v && v.quantity) || 0);
            }
        }
        const sample = [
            gs.gameTime ? gs.gameTime.day : 0,
            gs.gameTime ? gs.gameTime.hour : 0,
            gs.gameTime ? (gs.gameTime.minute || 0) : 0,
            gs.shop ? gs.shop.funds : 0,
            gs.shop ? gs.shop.totalOrders : 0,
            gs.shop ? gs.shop.reputation : 0,
            Array.isArray(gs.orders) ? gs.orders.length : 0,
            Array.isArray(gs.inventory) ? gs.inventory.length : 0,
            invQty,
            Array.isArray(gs.employees) ? gs.employees.length : 0,
            Array.isArray(gs.listings) ? gs.listings.length : 0,
            Math.round(listingPriceSum * 100),
            orderStatusSig,
            Math.round(whPmSig * 100),
            (gs.gameTime && gs.gameTime.isPaused) ? 1 : 0,
            (gs.gameTime && gs.gameTime.speed) ? gs.gameTime.speed : 1
        ].join('|');
        return this._hashDJB2(this._strToUtf8Bytes(sample));
    }

    /** 根据数据规模计算动态保存间隔（5s~90s；大订单进一步拉长，避免频繁大序列化卡主线程） */
    _computeDynamicInterval() {
        const gs = (typeof gameState !== 'undefined') ? gameState.state : null;
        if (!gs) return this.SAVE_MIN_INTERVAL;
        const orderCount = Array.isArray(gs.orders) ? gs.orders.length : 0;
        const inventoryCount = Array.isArray(gs.inventory) ? gs.inventory.length : 0;
        const dataSize = orderCount + inventoryCount;
        // 用户交互中：尽量推迟大 JSON.stringify
        try {
            const uiRef = (typeof ui !== 'undefined') ? ui
                : (typeof window !== 'undefined' ? window.ui : null);
            if (orderCount >= 400 && uiRef && typeof uiRef._isUserInteracting === 'function' && uiRef._isUserInteracting()) {
                return Math.max(this.SAVE_MAX_INTERVAL, 60000);
            }
        } catch (_) {}
        if (dataSize < 500) return this.SAVE_MIN_INTERVAL;
        if (dataSize < 1500) return 15000;
        if (dataSize < 4000) return this.SAVE_MAX_INTERVAL;
        return Math.max(this.SAVE_MAX_INTERVAL, 90000);
    }


    // ==================== 状态灯与事件 ====================

    _setStatus(status) {
        this._status = status;
        this._listeners.forEach(fn => { try { fn(status); } catch (e) {} });
        if (typeof eventBus !== 'undefined' && eventBus.emit) {
            eventBus.emit('save:status', { status: status, lastError: this._lastError ? this._lastError.message : null });
        }
    }

    /** 注册状态变化监听器（供 UI 状态灯），返回取消订阅函数 */
    onStatusChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }


    // ==================== localStorage / sessionStorage 安全封装 ====================

    _safeLocalStorage() {
        try { return typeof localStorage !== 'undefined' && !!localStorage; }
        catch (e) { return false; }
    }

    _safeSessionStorage() {
        try { return typeof sessionStorage !== 'undefined' && !!sessionStorage; }
        catch (e) { return false; }
    }

    _lsPutRaw(key, value) {
        if (!this._safeLocalStorage()) return false;
        try { localStorage.setItem(key, value); return true; }
        catch (e) {
            console.warn('[SaveManager] localStorage 写入失败 ' + key + ':', e);
            return false;
        }
    }

    _lsGetRaw(key) {
        if (!this._safeLocalStorage()) return null;
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    _lsRemove(key) {
        if (!this._safeLocalStorage()) return;
        try { localStorage.removeItem(key); } catch (e) {}
    }

    _ssPutRaw(key, value) {
        if (!this._safeSessionStorage()) return false;
        try { sessionStorage.setItem(key, value); return true; }
        catch (e) {
            console.warn('[SaveManager] sessionStorage 写入失败 ' + key + ':', e);
            return false;
        }
    }

    _ssGetRaw(key) {
        if (!this._safeSessionStorage()) return null;
        try { return sessionStorage.getItem(key); } catch (e) { return null; }
    }


    // ==================== 手动存档槽位（存储增强 · 多槽位） ====================
    // 3 个用户手动槽位，与自动三副本（main/bak1/bak2）互相独立。
    // 复用 _archiveSave/_tryLoadFromSlot 的通用 slot 机制，格式与主档完全一致。

    getManualSlotIds() {
        return ['slot1', 'slot2', 'slot3'];
    }

    /** 列出 3 个手动槽位的状态（从 _meta 摘要读，同步、不解压） */
    listManualSlots() {
        const out = [];
        for (const id of this.getManualSlotIds()) {
            const raw = this._lsGetRaw(this.META_KEY_PREFIX + id);
            if (raw) {
                try {
                    out.push({ id, exists: true, meta: JSON.parse(raw) });
                    continue;
                } catch (_) {}
            }
            out.push({ id, exists: false, meta: null });
        }
        return out;
    }

    /** 把当前进度保存到手动槽位 n（1~3） */
    async saveToManualSlot(n) {
        n = Math.max(1, Math.min(3, parseInt(n, 10) || 1));
        const slot = 'slot' + n;
        this._log('SAVE', '▶ 手动存档 → ' + slot);
        return this._archiveSave(slot);
    }

    /** 载入手动槽位 n：复制到主档后整页重载（走标准启动加载路径，最稳妥） */
    async loadManualSlot(n) {
        n = Math.max(1, Math.min(3, parseInt(n, 10) || 1));
        const slot = 'slot' + n;
        const meta = this._lsGetRaw(this.META_KEY_PREFIX + slot);
        if (!meta) throw new Error('槽位 ' + n + ' 是空的，请先保存');
        this._log('LOAD', '▶ 手动载入 ' + slot + ' → 覆盖主档并重载');
        // 先让当前进度安全落盘，避免切换途中丢失
        try { await this.flushSave(); } catch (_) {}
        // 复制槽位内容到 main
        await this._copySlotRecords(slot, 'main');
        // 标记本次重载来源（UI 重载后可提示）
        try { sessionStorage.setItem('ecommerce_sim_slot_loaded', slot); } catch (_) {}
        return { success: true, slot };
    }

    /** 删除手动槽位 n */
    async deleteManualSlot(n) {
        n = Math.max(1, Math.min(3, parseInt(n, 10) || 1));
        const slot = 'slot' + n;
        if (this._hasIDB) {
            try { await this._idbDelete('archives', slot); } catch (_) {}
            try { await this._idbDelete('express', slot); } catch (_) {}
            try { await this._idbDelete('warehouse', slot); } catch (_) {}
        }
        this._lsRemove(this.META_KEY_PREFIX + slot);
        this._lsRemove(this.ARCHIVE_LS_KEY_PREFIX + slot);
        this._lsRemove(this.ARCHIVE_LS_KEY_PREFIX + slot + '_enc');
        this._log('INFO', '手动槽位已删除 ' + slot);
        return { success: true, slot };
    }

    /** 把一个槽位的全部记录复制到另一个槽位（IDB 三 store + localStorage 降级 + _meta） */
    async _copySlotRecords(from, to) {
        if (this._hasIDB) {
            for (const store of ['archives', 'express', 'warehouse']) {
                let rec = null;
                try { rec = await this._idbGet(store, from); } catch (_) {}
                if (rec) {
                    rec.slot = to;
                    await this._idbPut(store, rec);
                }
            }
        }
        const enc = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + from + '_enc');
        const raw = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + from);
        if (raw) {
            this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + to, raw);
            this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + to + '_enc', enc || 'raw');
        }
        const meta = this._lsGetRaw(this.META_KEY_PREFIX + from);
        if (meta) {
            // 仅当源槽位确实存在摘要时才覆盖目标（源为空时不动目标，防止误删主档摘要）
            this._lsPutRaw(this.META_KEY_PREFIX + to, meta);
        }
        // 清掉旧紧急缓冲，重载时按新主档的 _meta/IDB 走
        try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (_) {}
    }


    // ==================== 存档导出 / 导入（存储增强 · 便携备份） ====================
    // 导出 = 把压缩后的存档 payload（gzip/base64）+ 校验哈希打包成一段文本；
    // 可存网盘 / 发到另一台设备，导入后恢复进度。文本格式：ECS_SAVE_V1。

    /** 导出指定槽位（默认 main）为文本。返回 { text, sizeKB, meta } */
    async exportSaveText(slot) {
        slot = slot || 'main';
        let format = 'raw';
        let payloadB64 = '';
        let hash = '';
        let rawSize = 0;
        let compressedSize = 0;
        let metaText = '';

        const metaRaw = this._lsGetRaw(this.META_KEY_PREFIX + slot);
        if (metaRaw) {
            metaText = metaRaw;
            try {
                const pm = JSON.parse(metaRaw);
                hash = String(pm.hash || '');
                rawSize = pm.rawSize || 0;
                compressedSize = pm.compressedSize || 0;
            } catch (_) {}
        }

        let rec = null;
        if (this._hasIDB) {
            try { rec = await this._idbGet('archives', slot); } catch (_) {}
        }

        if (rec && rec.payload) {
            format = rec.format || 'raw';
            const bytes = new Uint8Array(rec.payload);
            payloadB64 = this._bytesToBase64(bytes);
            hash = String(rec.hash || hash || '');
            rawSize = rec.rawSize || rawSize;
            compressedSize = rec.compressedSize || bytes.length;
        } else {
            // localStorage 降级模式（或 IDB 中无记录）
            const enc = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + slot + '_enc') || 'raw';
            const raw = this._lsGetRaw(this.ARCHIVE_LS_KEY_PREFIX + slot);
            if (!raw) throw new Error('该槽位没有存档，请先保存');
            if (enc === 'gzip64') {
                format = 'gzip';
                payloadB64 = raw;
            } else {
                const bytes = this._strToUtf8Bytes(raw);
                payloadB64 = this._bytesToBase64(bytes);
                rawSize = bytes.length;
                compressedSize = bytes.length;
                if (!hash) hash = String(this._hashDJB2(bytes));
            }
        }

        const obj = {
            app: 'ecommerce_sim',
            fmt: 'ECS_SAVE_V2',
            version: 2,
            format,
            hash,
            payloadB64,
            meta: metaText
        };
        // 防伪签名：覆盖 payloadB64（改一个字符签名就对不上）
        obj.sig = this._signText(payloadB64);
        const text = JSON.stringify(obj);
        this._log('SAVE', '✓ 导出完成 slot=' + slot + ' format=' + format +
            ' sig=' + obj.sig + ' 文本=' + (text.length / 1024).toFixed(1) + 'KB');
        return { text, sizeKB: Math.round(text.length / 1024), meta: metaText ? JSON.parse(metaText) : {} };
    }

    /**
     * 导入存档文本：校验格式 + 解压 + 哈希校验 + 结构校验后写入主档。
     * 调用方负责确认覆盖提示；成功后应重载页面走标准加载流程。
     */
    async importSaveText(text) {
        if (!text) throw new Error('导入内容为空');
        let obj;
        try {
            obj = JSON.parse(String(text).trim());
        } catch (e) {
            throw new Error('内容不是有效的 JSON，请确认粘贴的是完整的导出文本');
        }
        if (!obj || (obj.fmt !== 'ECS_SAVE_V2' && obj.fmt !== 'ECS_SAVE_V1') || !obj.payloadB64) {
            throw new Error('不是本游戏的存档文件（格式标记不匹配）');
        }

        // 0. 防伪签名校验（必须在解压/落盘之前）：改过资金等字段的假档在这里被拒
        if (!obj.sig) {
            throw new Error('存档缺少防伪签名，无法确认完整性（可能是旧版本导出的文本或被手工修改过），已拒绝导入');
        }
        const expectSig = this._signText(String(obj.payloadB64));
        if (String(obj.sig) !== expectSig) {
            throw new Error('存档签名校验失败：内容已被修改或损坏，已拒绝导入');
        }

        // 1. base64 解码
        let bytes;
        try {
            bytes = this._base64ToBytes(obj.payloadB64);
        } catch (e) {
            throw new Error('存档数据解码失败，文本可能被截断');
        }

        // 2. gzip 解压（需要 CompressionStream；不支持则明确报错）
        let rawBytes = bytes;
        if (obj.format === 'gzip') {
            if (!this._hasCompression) {
                throw new Error('当前环境不支持 gzip 解压，无法导入压缩档（请换用新版浏览器/App）');
            }
            try {
                rawBytes = await this._gzipDecompress(bytes);
            } catch (e) {
                throw new Error('存档解压失败，文件可能已损坏');
            }
        }

        // 3. 哈希校验（对解压后的字节）
        const actualHash = this._hashDJB2(rawBytes);
        if (obj.hash && String(obj.hash) !== String(actualHash)) {
            throw new Error('存档校验失败：哈希不一致（文件可能已损坏或被修改）');
        }

        // 4. 结构校验 + 归一化（兼容新版包装与旧版裸 state）
        let fullState;
        try {
            fullState = JSON.parse(this._utf8BytesToStr(rawBytes));
        } catch (e) {
            throw new Error('存档解析失败，文件可能已损坏');
        }
        const normalized = this._normalizeToFullState(fullState);
        if (!normalized || !normalized.state || !normalized.state.shop || !normalized.state.gameTime) {
            throw new Error('存档内容缺少关键字段，无法导入');
        }

        // 4b. 经济字段体检：签名通过但数值异常（NaN/负数越界/离谱值）→ 重置该字段
        const saneImport = this._sanitizeLoadedState(normalized.state);
        const sanitizedFields = (normalized._saveMeta && normalized._saveMeta.sanitized) || saneImport.fixed;
        if (sanitizedFields.length) {
            this._log('WARN', '导入存档存在异常数值，已重置字段: ' + sanitizedFields.join('、'));
        }

        // 4c. 体检修复过字段时，用修复后的数据重新序列化后再落盘，
        //     避免"脏数据只是内存里被修好、存档里还是假档"。
        let storeBytes = bytes;          // 落盘 payload
        let storeRawBytes = rawBytes;    // 与之对应的解压后字节（哈希基准）
        if (sanitizedFields.length) {
            storeRawBytes = this._strToUtf8Bytes(this._stringifyFullState(normalized));
            if (obj.format === 'gzip' && this._hasCompression) {
                const recompressed = await this._gzipCompress(storeRawBytes);
                storeBytes = (recompressed && recompressed !== storeRawBytes) ? recompressed : storeRawBytes;
            } else {
                storeBytes = storeRawBytes;
            }
        }
        const finalHash = this._hashDJB2(storeRawBytes);

        // 5. 写入主档（与 _archiveSave 的记录结构一致，便于加载路径直接读取）
        const meta = this._buildMeta(normalized, finalHash, storeRawBytes.length, storeBytes.length);
        const record = {
            slot: 'main',
            format: obj.format === 'gzip' ? 'gzip' : 'raw',
            payload: storeBytes.buffer.slice(storeBytes.byteOffset, storeBytes.byteOffset + storeBytes.byteLength),
            hash: finalHash,
            rawSize: storeRawBytes.length,
            compressedSize: storeBytes.length,
            timestamp: Date.now(),
            gameVersion: (typeof GAME_STATE_VERSION !== 'undefined') ? GAME_STATE_VERSION : 7,
            saveFormatVersion: this.SAVE_FORMAT_VERSION,
            stateVersion: normalized.state.version,
            meta: meta
        };
        if (this._hasIDB) {
            await this._idbPut('archives', record);
            if (normalized.express) {
                await this._idbPut('express', { slot: 'main', data: normalized.express, hash: finalHash, timestamp: Date.now() });
            }
            if (normalized.warehouse) {
                await this._idbPut('warehouse', { slot: 'main', data: normalized.warehouse, hash: finalHash, timestamp: Date.now() });
            }
        } else {
            // localStorage 降级模式
            const lsPayload = (obj.format === 'gzip' && storeBytes === bytes)
                ? obj.payloadB64
                : this._utf8BytesToStr(storeRawBytes);
            const lsEnc = (obj.format === 'gzip' && storeBytes === bytes) ? 'gzip64' : 'raw';
            if (lsPayload.length > this.MAX_ARCHIVE_SIZE_LS) {
                throw new Error('导入的存档超过 localStorage 容量上限，无法在当前环境导入');
            }
            this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + 'main', lsPayload);
            this._lsPutRaw(this.ARCHIVE_LS_KEY_PREFIX + 'main' + '_enc', lsEnc);
        }
        this._lsPutRaw(this.META_KEY_PREFIX + 'main', JSON.stringify(meta));
        try { sessionStorage.removeItem(this.SESSION_BUFFER_KEY); } catch (_) {}

        this._log('SAVE', '✓ 导入成功并写入主档 day=' + (normalized.state.gameTime ? normalized.state.gameTime.day : '?') +
            ' raw=' + (storeRawBytes.length / 1024).toFixed(1) + 'KB' +
            (sanitizedFields.length ? '（已重置 ' + sanitizedFields.join('、') + '）' : ''));
        return { success: true, meta, sanitized: sanitizedFields };
    }
}

// 全局单例
const saveManager = new SaveManager();
