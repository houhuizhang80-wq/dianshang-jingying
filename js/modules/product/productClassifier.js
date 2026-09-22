/**
 * 商品识别与分类系统 (Product Recognition & Classification System)
 * ================================================================
 * 三大核心功能：
 *   1. 商品名称识别 (ProductNameRecognizer) - 基于商品名称的精准识别与匹配
 *   2. ABC等级分类 (QualityGradeClassifier) - 根据品质等级生成差异化视觉标识的图片
 *   3. 图片唯一性管理 (ProductImageManager) - 确保商品图片100%不重复，带指纹校验
 */

// ==================== ABC等级视觉特征定义 ====================
const QUALITY_GRADE_VISUALS = {
    A: {
        grade: 'A',
        name: 'A品',
        // 金属金色：高光→纯金→暗金
        primaryColor: '#FFD700',
        lightColor: '#FFF59D',
        darkColor: '#B8860B',
        badgeShape: 'star',        // 星形徽章（区别于B的圆形、C的方形）
        hasGlow: true,             // 带星芒发光效果
        hasStar: true,             // 徽章上方有小星星装饰
        borderStyle: 'double',     // 双线边框
        borderColor: '#FFD700',
        badgeScale: 1.15,          // 徽章稍大
        shineIntensity: 0.4,       // 更强的玻璃光泽
        stampAngle: -12,           // 印章旋转角度
        stampColor: 'rgba(255,215,0,0.12)',
        stampText: 'A级精品',
    },
    B: {
        grade: 'B',
        name: 'B品',
        // 橙银色：标准品质
        primaryColor: '#FF9800',
        lightColor: '#FFE0B2',
        darkColor: '#E65100',
        badgeShape: 'circle',      // 标准圆形徽章
        hasGlow: false,
        hasStar: false,
        borderStyle: 'solid',
        borderColor: '#FF9800',
        badgeScale: 1.0,
        shineIntensity: 0.28,
        stampAngle: 0,
        stampColor: 'rgba(255,152,0,0.08)',
        stampText: '合格',
    },
    C: {
        grade: 'C',
        name: 'C品',
        // 铜灰色：基础品质
        primaryColor: '#9E9E9E',
        lightColor: '#E0E0E0',
        darkColor: '#616161',
        badgeShape: 'shield',      // 盾形徽章（朴素，区别于A/B）
        hasGlow: false,
        hasStar: false,
        borderStyle: 'dashed',     // 虚线边框表示基础品
        borderColor: '#BDBDBD',
        badgeScale: 0.95,
        shineIntensity: 0.18,      // 哑光，低光泽
        stampAngle: 15,
        stampColor: 'rgba(158,158,158,0.08)',
        stampText: '普通品',
    }
};

// ==================== 商品名称识别引擎 ====================
const ProductNameRecognizer = {
    // 停用词/修饰词表（匹配时忽略）
    _stopWords: new Set([
        '正品', '原装', '全新', '包邮', '限时', '特价', '秒杀', '爆款', '热销',
        '促销', '特惠', '折扣', '清仓', '亏本', '官方', '旗舰', '直营', '直供',
        '新款', '新品', '2024', '2025', '2026', '高档', '高端', '精品', '优质',
        '真', '纯', '正品', '正', '的', '了', '之', '和', '与', '级', '版',
        '装', '件', '个', '条', '只', '支', '瓶', '盒', '包', '套', '双', '本'
    ]),

    // 单位/数量词正则（用于提取规格信息）
    _quantityPatterns: [
        /(\d+(?:\.\d+)?)\s*(kg|g|ml|L|斤|两|米|cm|mm|寸|英寸|英尺)/gi,
        /(\d+)\s*(支|条|个|件|只|双|包|盒|瓶|套|本|卷|片|张|块|根|颗|粒|对)/g,
        /(\d+(?:\.\d+)?)\s*[万w千k]?[mMgGtT][bB]/g,  // 存储单位如128G、20000mAh
        /(\d+)ml/g, /(\d+)g/g, /(\d+)kg/g, /(\d+)L/g,
    ],

    // 品类关键词映射（用于消歧和精准匹配）
    _categoryKeywords: {
        daily: ['毛巾', '牙膏', '洗衣液', '垃圾袋', '清洁布', '保温杯', '洗脸巾', '沐浴露', '抽纸', '留香珠', '牙刷', '吹风机', '扫地机器人', '空气净化器'],
        digital: ['数据线', '手机壳', '快充头', 'U盘', '蓝牙耳机', '充电器', '充电宝', '键盘', '手表', '路由器', '摄像头', '平板', '相机', '笔记本', '手机', '耳机'],
        clothing: ['袜子', 'T恤', 't恤', '衬衫', '牛仔裤', '皮带', '卫衣', '连衣裙', '双肩包', '跑鞋', '运动鞋', '羽绒服', '外套', '毛衣', '围巾', '内裤', '内衣'],
        food: ['零食', '坚果', '饼干', '巧克力', '牛肉干', '辣条', '方便面', '牛奶', '饮料', '咖啡', '茶叶', '水果', '大米', '食用油', '酱油'],
        beauty: ['面膜', '口红', '粉底', '眼霜', '面霜', '精华液', '防晒霜', '洗面奶', '爽肤水', '乳液', '香水', '眼影', '睫毛膏', '眉笔'],
        home: ['台灯', '枕头', '被子', '床单', '被套', '靠垫', '收纳盒', '衣架', '拖鞋', '毛巾被', '凉席', '毛毯', '四件套', '水杯', '水壶'],
        outdoor: ['帐篷', '睡袋', '登山包', '水壶', '登山杖', '护膝', '运动服', '球拍', '篮球', '足球', '瑜伽垫', '哑铃', '跳绳']
    },

    // 商品关键词索引（初始化时构建）
    _keywordIndex: null,
    _productCache: null,

    /**
     * 初始化识别器，构建关键词索引
     */
    init(products) {
        this._productCache = products;
        this._keywordIndex = new Map();

        products.forEach(product => {
            const keywords = this.extractKeywords(product.name);
            // 为每个关键词建立倒排索引
            keywords.forEach(kw => {
                if (!this._keywordIndex.has(kw)) {
                    this._keywordIndex.set(kw, new Set());
                }
                this._keywordIndex.get(kw).add(product.id);
            });
        });
    },

    /**
     * 商品名称标准化
     * 去除修饰词、统一大小写、去除多余空格、提取规格
     */
    normalize(name) {
        if (!name) return { normalized: '', specs: [], core: '' };

        let str = String(name).trim();

        // 提取规格/数量信息
        const specs = [];
        this._quantityPatterns.forEach(pattern => {
            const matches = str.match(pattern);
            if (matches) {
                matches.forEach(m => specs.push(m.replace(/\s+/g, '')));
            }
        });

        // 去除规格字符串
        let normalized = str;
        this._quantityPatterns.forEach(pattern => {
            normalized = normalized.replace(pattern, ' ');
        });

        // 去除停用词/修饰词
        this._stopWords.forEach(word => {
            normalized = normalized.replace(new RegExp(word, 'g'), ' ');
        });

        // 去除特殊符号、多余空格
        normalized = normalized
            .replace(/[【】\[\]()（）《》""''!！?？,，.。、\/\\|@#$%^&*~`+=_-]/g, ' ')
            .replace(/\s+/g, '')
            .toLowerCase();

        return {
            original: str,
            normalized: normalized,
            specs: specs,
            core: normalized  // 核心名称（用于匹配）
        };
    },

    /**
     * 从商品名称提取关键词（用于索引和匹配）
     */
    extractKeywords(name) {
        const normalized = this.normalize(name);
        const keywords = new Set();
        const core = normalized.normalized;

        // 加入完整核心名
        if (core.length >= 2) keywords.add(core);

        // 提取2-gram到4-gram关键词
        const ngrams = [2, 3, 4];
        ngrams.forEach(n => {
            for (let i = 0; i <= core.length - n; i++) {
                const gram = core.substring(i, i + n);
                // 过滤掉太短或太常见的组合
                if (this._isMeaningfulGram(gram)) {
                    keywords.add(gram);
                }
            }
        });

        // 提取品类关键词
        Object.entries(this._categoryKeywords).forEach(([cat, words]) => {
            words.forEach(w => {
                if (core.includes(w.toLowerCase())) {
                    keywords.add(w.toLowerCase());
                }
            });
        });

        // 提取规格关键词
        normalized.specs.forEach(spec => {
            keywords.add(spec.toLowerCase());
        });

        return Array.from(keywords).filter(k => k.length >= 2);
    },

    /**
     * 判断n-gram是否有意义（避免纯数字、太通用的组合）
     */
    _isMeaningfulGram(gram) {
        // 纯数字或纯字母（太短）无意义
        if (/^\d+$/.test(gram) && gram.length < 3) return false;
        // 单个字母无意义
        if (/^[a-zA-Z]$/.test(gram)) return false;
        return true;
    },

    /**
     * 商品识别：根据输入名称识别匹配的商品
     * @param {string} inputName - 输入的商品名称
     * @param {Object} options - 选项 { category?, topK?, threshold? }
     * @returns {Array<{product, score, matchType}>} 匹配结果列表，按得分降序
     */
    recognize(inputName, options = {}) {
        if (!this._keywordIndex || !this._productCache) {
            console.warn('[ProductNameRecognizer] 未初始化，请先调用init(products)');
            return [];
        }

        const topK = options.topK || 5;
        const threshold = options.threshold || 0.3;
        const targetCategory = options.category;

        const normalized = this.normalize(inputName);
        const inputKeywords = this.extractKeywords(inputName);

        if (inputKeywords.length === 0) return [];

        // 候选商品打分
        const scores = new Map();

        inputKeywords.forEach(kw => {
            const productIds = this._keywordIndex.get(kw);
            if (!productIds) return;
            productIds.forEach(pid => {
                const product = this._productCache.find(p => p.id === pid);
                if (!product) return;
                // 品类过滤
                if (targetCategory && product.category !== targetCategory) return;

                const currentScore = scores.get(pid) || { product, score: 0, matchedKws: [] };
                // 关键词长度权重（越长的关键词权重越高）
                const weight = kw.length / Math.max(inputKeywords.reduce((m, k) => Math.max(m, k.length), 0), 2);
                currentScore.score += weight;
                currentScore.matchedKws.push(kw);
                scores.set(pid, currentScore);
            });
        });

        // 完全匹配加分
        if (normalized.normalized.length >= 2) {
            this._productCache.forEach(p => {
                const pn = this.normalize(p.name);
                if (pn.normalized === normalized.normalized) {
                    const s = scores.get(p.id) || { product: p, score: 0, matchedKws: [] };
                    s.score += 10;  // 完全匹配大幅加分
                    s.matchType = 'exact';
                    scores.set(p.id, s);
                } else if (pn.normalized.includes(normalized.normalized) || normalized.normalized.includes(pn.normalized)) {
                    const s = scores.get(p.id) || { product: p, score: 0, matchedKws: [] };
                    s.score += 5;  // 包含匹配加分
                    if (!s.matchType) s.matchType = 'contains';
                    scores.set(p.id, s);
                }
            });
        }

        // 归一化分数并排序
        const maxScore = Math.max(...Array.from(scores.values()).map(s => s.score), 1);
        const results = Array.from(scores.values())
            .map(s => ({
                product: s.product,
                score: s.score / maxScore,
                rawScore: s.score,
                matchType: s.matchType || 'keyword',
                matchedKeywords: s.matchedKws
            }))
            .filter(r => r.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        return results;
    },

    /**
     * 精准识别：返回最佳匹配商品，或null
     */
    recognizeBest(inputName, options = {}) {
        const results = this.recognize(inputName, { ...options, topK: 1, threshold: options.threshold || 0.5 });
        if (results.length === 0) return null;
        // 高置信度才认为识别成功
        if (results[0].score >= 0.5) return results[0];
        return null;
    },

    /**
     * 根据ID查找商品
     */
    findById(productId) {
        return this._productCache ? this._productCache.find(p => p.id === productId) : null;
    }
};

// ==================== 图片唯一性管理 ====================
const ProductImageManager = {
    // 图片缓存：key = productId|grade，value = dataURI
    _cache: new Map(),
    // 轻量缩略图缓存（无高斯模糊滤镜版本，列表页专用，大幅降低真机光栅化开销）
    _liteCache: new Map(),
    // 已使用图片的指纹集合（防止重复分配）
    _fingerprints: new Set(),
    // 图片使用记录：fingerprint -> {productId, grade, timestamp}
    _usageLog: new Map(),
    // 已注册的图片数量统计
    _stats: { total: 0, unique: 0, duplicates: 0 },

    /**
     * 生成图片唯一指纹（基于productId + grade + 视觉特征hash）
     */
    generateFingerprint(productId, grade) {
        // 确定性指纹：相同productId+grade永远相同，确保一致性
        // 同时加入视觉特征编码确保不同等级图片指纹不同
        const visual = QUALITY_GRADE_VISUALS[grade];
        const featureCode = [
            visual.primaryColor.replace('#', ''),
            visual.badgeShape[0].toUpperCase(),
            visual.hasGlow ? 'G' : 'g',
            visual.badgeScale.toFixed(2),
        ].join('');
        const raw = `${productId}|${grade}|${featureCode}`;
        return this._simpleHash(raw);
    },

    /**
     * 简单字符串哈希（djb2算法，确定性输出）
     */
    _simpleHash(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash; // 转32位整数
        }
        return 'img_' + Math.abs(hash).toString(36);
    },

    /**
     * 检查图片是否已存在（唯一性校验）
     */
    isDuplicate(fingerprint) {
        return this._fingerprints.has(fingerprint);
    },

    /**
     * 注册图片指纹（标记为已使用）
     * @returns {boolean} true=注册成功（新图片），false=重复图片
     */
    register(fingerprint, meta = {}) {
        if (this._fingerprints.has(fingerprint)) {
            this._stats.duplicates++;
            return false;
        }
        this._fingerprints.add(fingerprint);
        this._usageLog.set(fingerprint, {
            ...meta,
            timestamp: Date.now()
        });
        this._stats.total++;
        this._stats.unique++;
        return true;
    },

    /**
     * 获取缓存图片
     */
    getImage(productId, grade) {
        const key = `${productId}|${grade}`;
        return this._cache.get(key) || null;
    },

    /** 获取轻量缩略图缓存（key = productId|grade|lite） */
    getImageLite(productId, grade) {
        const key = `${productId}|${grade}|lite`;
        return this._liteCache.get(key) || null;
    },

    /** 存入轻量缩略图缓存（不占用指纹池：指纹唯一性只管正式图） */
    setImageLite(productId, grade, dataURI) {
        const key = `${productId}|${grade}|lite`;
        this._liteCache.set(key, {
            dataURI,
            grade,
            productId,
            createdAt: Date.now()
        });
    },

    /**
     * 存入图片缓存
     */
    setImage(productId, grade, dataURI, fingerprint) {
        const key = `${productId}|${grade}`;
        this._cache.set(key, {
            dataURI,
            fingerprint,
            grade,
            productId,
            createdAt: Date.now()
        });
        this.register(fingerprint, { productId, grade });
    },

    /**
     * 获取或生成商品图片（核心入口）
     * 如果该(商品,等级)组合已存在图片，直接返回缓存（确保唯一性）
     * 否则生成新图片
     */
    getOrCreateImage(product, grade, iconRenderer) {
        const fingerprint = this.generateFingerprint(product.id, grade);
        const cached = this.getImage(product.id, grade);
        if (cached && cached.fingerprint === fingerprint) {
            return { dataURI: cached.dataURI, fingerprint, cached: true };
        }
        // 生成新图片
        const dataURI = iconRenderer(product, grade, fingerprint);
        this.setImage(product.id, grade, dataURI, fingerprint);
        return { dataURI, fingerprint, cached: false };
    },

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this._stats,
            cacheSize: this._cache.size,
            fingerprintCount: this._fingerprints.size
        };
    },

    /**
     * 清空缓存（用于重新初始化）
     */
    reset() {
        this._cache.clear();
        this._liteCache.clear();
        this._fingerprints.clear();
        this._usageLog.clear();
        this._stats = { total: 0, unique: 0, duplicates: 0 };
    }
};

// ==================== SVG图片生成器（带ABC等级差异化标识） ====================
/**
 * 从全局的 PRODUCT_ICONS 或 EMOJI_KEYWORD_MAP 智能获取商品专属emoji
 * @param {Object} product - 商品对象（至少包含id或name）
 * @returns {string} emoji字符
 */
function resolveProductEmoji(product) {
    if (!product) return '📦';
    const name = product.name || '';
    // 先按商品名匹配形态（旅行箱/公文包/相机等），未命中再走人工表
    if (typeof matchEmojiByProductName === 'function' && name) {
        const byName = matchEmojiByProductName(name);
        if (byName) return byName;
    } else if (typeof EMOJI_KEYWORD_MAP !== 'undefined' && name) {
        for (const [pattern, emoji] of EMOJI_KEYWORD_MAP) {
            try {
                if (pattern.test(name)) return emoji;
            } catch (e) { /* ignore regex error */ }
        }
    }
    if (typeof PRODUCT_ICONS !== 'undefined' && product.id && PRODUCT_ICONS[product.id]) {
        const cfg = PRODUCT_ICONS[product.id];
        if (cfg && cfg.emoji) return cfg.emoji;
    }
    const categoryDefaults = {
        daily: '🧺', digital: '📱', clothing: '👕', food: '🍱', luxury: '💎',
        beauty: '💄', home: '🏠', outdoor: '🏃',
        pet: '🐾', baby: '👶', stationery: '✏️', car: '🚗', others: '📦'
    };
    if (categoryDefaults[product.category]) return categoryDefaults[product.category];
    return '📦';
}

const ProductIconRenderer = {
    _mixColor(color1, color2, ratio) {
        const clamp = v => Math.max(0, Math.min(255, v | 0));
        const hex = s => {
            s = s.replace('#', '');
            if (s.length === 3) s = s.split('').map(c => c + c).join('');
            return [parseInt(s.substring(0, 2), 16), parseInt(s.substring(2, 4), 16), parseInt(s.substring(4, 6), 16)];
        };
        const [r1, g1, b1] = hex(color1);
        const [r2, g2, b2] = hex(color2);
        const r = clamp(r1 + (r2 - r1) * ratio);
        const g = clamp(g1 + (g2 - g1) * ratio);
        const b = clamp(b1 + (b2 - b1) * ratio);
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    },

    /**
     * 渲染等级徽章SVG路径
     */
    _renderBadgeShape(visual, uid) {
        const s = visual.badgeScale;
        const r = 11 * s;
        const cx = 78, cy = 78;

        switch (visual.badgeShape) {
            case 'star':
                // A品：五角星徽章（更醒目）
                return this._starPath(cx, cy, r, r * 0.45, 5);
            case 'shield':
                // C品：盾形徽章（朴素）
                return this._shieldPath(cx, cy, r);
            case 'circle':
            default:
                // B品：标准圆形
                return `<circle r="${r}" fill="url(#badge_${uid})"
                        stroke="#FFFFFF" stroke-width="1.5" opacity="0.97"/>`;
        }
    },

    _starPath(cx, cy, outerR, innerR, points) {
        const path = [];
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? outerR : innerR;
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            path.push((i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1));
        }
        path.push('Z');
        return `<path d="${path.join(' ')}" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round" opacity="0.98"/>`;
    },

    _shieldPath(cx, cy, r) {
        const w = r * 1.05, h = r * 1.25;
        const top = cy - h;
        const bottom = cy + h * 0.7;
        return `<path d="M${cx - w},${top} L${cx + w},${top} L${cx + w},${cy + h * 0.15} 
                Q${cx + w * 0.85},${bottom - h * 0.1} ${cx},${bottom} 
                Q${cx - w * 0.85},${bottom - h * 0.1} ${cx - w},${cy + h * 0.15} Z"
                stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round" opacity="0.95"/>`;
    },

    /**
     * 渲染A品特有的星芒发光效果
     */
    _renderGlow(visual, uid) {
        if (!visual.hasGlow) return '';
        return `
        <!-- A品星芒光环 -->
        <circle cx="78" cy="78" r="18" fill="url(#glow_${uid})" opacity="0.6"/>
        <!-- 小星星装饰（A品专属） -->
        <text x="86" y="66" font-size="7" fill="${visual.lightColor}" opacity="0.9">★</text>
        <text x="66" y="88" font-size="5" fill="${visual.primaryColor}" opacity="0.7">★</text>
        `;
    },

    /**
     * 渲染品质水印印章（对角半透明）
     */
    _renderStamp(visual) {
        if (!visual.stampText) return '';
        const angle = visual.stampAngle;
        return `
        <g transform="translate(50,50) rotate(${angle})">
            <rect x="-28" y="-8" width="56" height="16" rx="3" ry="3"
                  fill="none" stroke="${visual.stampColor.replace(/[\d.]+\)$/, '0.25)')}" stroke-width="1.2"/>
            <text y="3" text-anchor="middle" font-size="9" font-weight="bold"
                  fill="${visual.stampColor.replace(/[\d.]+\)$/, '0.3)')}" letter-spacing="2">${visual.stampText}</text>
        </g>`;
    },

    /**
     * 生成带等级标识的商品图片（高级 UI：圆角渐变底 + 橙金描边 + 右下品质标）
     * 视觉对齐货源列表中的精品图标风格
     */
    render(product, grade, fingerprint) {
        const icon = resolveProductEmoji(product);
        const material = (typeof resolveProductMaterial === 'function')
            ? resolveProductMaterial(product.name) : null;
        let colors = (typeof CATEGORY_COLORS !== 'undefined' && CATEGORY_COLORS[product.category])
            ? CATEGORY_COLORS[product.category]
            : { primary: '#7C4DFF', secondary: '#1565C0' };
        if (material && material.color) {
            colors = {
                primary: this._mixColor(material.color, colors.primary, 0.35),
                secondary: this._mixColor(material.color, colors.secondary || colors.primary, 0.2)
            };
        }

        const visual = QUALITY_GRADE_VISUALS[grade] || QUALITY_GRADE_VISUALS.B;
        const gradeColors = {
            primary: visual.primaryColor,
            secondary: visual.darkColor
        };
        const uid = (product.id + '_' + grade + '_' + fingerprint).replace(/[^a-zA-Z0-9]/g, '_');
        const shineOpacity = Math.max(0.22, visual.shineIntensity);
        // 外框高亮：A金 / B橙金 / C银灰
        const frameColor = visual.grade === 'A' ? '#FFD54F'
            : (visual.grade === 'C' ? '#CFD8DC' : '#FFB300');
        const frameGlow = visual.grade === 'A' ? '#FFE082'
            : (visual.grade === 'C' ? '#ECEFF1' : '#FF9800');
        const auraColor = visual.grade === 'A' ? 'rgba(255,215,0,0.45)'
            : (visual.grade === 'C' ? 'rgba(158,158,158,0.35)' : 'rgba(255,82,82,0.55)');

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
        <linearGradient id="bg_${uid}" x1="18%" y1="0%" x2="82%" y2="100%">
            <stop offset="0%"  stop-color="${this._mixColor(colors.primary, '#FFFFFF', 0.12)}"/>
            <stop offset="42%" stop-color="${colors.primary}"/>
            <stop offset="100%" stop-color="${this._mixColor(colors.secondary, '#0D1B4C', 0.35)}"/>
        </linearGradient>
        <linearGradient id="top_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#FFFFFF" stop-opacity="0.42"/>
            <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bot_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="#000000" stop-opacity="0"/>
            <stop offset="70%" stop-color="#000000" stop-opacity="0.08"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.32"/>
        </linearGradient>
        <linearGradient id="shine_${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>
            <stop offset="46%"  stop-color="#FFFFFF" stop-opacity="${shineOpacity}"/>
            <stop offset="58%"  stop-color="#FFFFFF" stop-opacity="${(shineOpacity * 0.35).toFixed(2)}"/>
            <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="frame_${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${this._mixColor(frameColor, '#FFFFFF', 0.35)}"/>
            <stop offset="55%" stop-color="${frameColor}"/>
            <stop offset="100%" stop-color="${frameGlow}"/>
        </linearGradient>
        <linearGradient id="badge_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stop-color="${this._mixColor(gradeColors.primary, '#FFFFFF', 0.42)}"/>
            <stop offset="48%" stop-color="${gradeColors.primary}"/>
            <stop offset="100%" stop-color="${this._mixColor(gradeColors.secondary, '#000000', 0.22)}"/>
        </linearGradient>
        <filter id="drop_${uid}" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2.4"/>
            <feOffset dx="0" dy="3.2" result="offsetblur"/>
            <feFlood flood-color="#000000" flood-opacity="0.30"/>
            <feComposite in2="offsetblur" operator="in"/>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="emoji_shadow_${uid}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.1"/>
            <feOffset dx="0" dy="2.2"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="aura_${uid}" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        <filter id="frameglow_${uid}" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        ${visual.hasGlow ? `
        <radialGradient id="glow_${uid}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${visual.lightColor}" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="${visual.primaryColor}" stop-opacity="0"/>
        </radialGradient>` : ''}
    </defs>

    <!-- 底板 + 投影 -->
    <rect x="4" y="4" width="92" height="92" rx="20" ry="20"
          fill="url(#bg_${uid})" filter="url(#drop_${uid})"/>
    <rect x="4" y="4" width="92" height="44" rx="20" ry="20" fill="url(#top_${uid})"/>
    <rect x="4" y="4" width="92" height="92" rx="20" ry="20" fill="url(#bot_${uid})"/>
    <rect x="4" y="4" width="92" height="92" rx="20" ry="20" fill="url(#shine_${uid})"/>

    <!-- 主体后方光框（科技感） -->
    <rect x="24" y="22" width="52" height="48" rx="10" ry="10"
          fill="none" stroke="${auraColor}" stroke-width="2.2"
          filter="url(#aura_${uid})" opacity="0.95"/>
    <rect x="27" y="25" width="46" height="42" rx="8" ry="8"
          fill="none" stroke="${auraColor}" stroke-width="1" opacity="0.55"/>

    <!-- Emoji 主图标（略放大，居中偏上） -->
    <text x="50" y="52" text-anchor="middle" dominant-baseline="middle"
          font-size="44" filter="url(#emoji_shadow_${uid})">${icon}</text>
    ${material ? `<text x="22" y="78" text-anchor="middle" font-size="12">${material.emoji}</text>
    <text x="22" y="90" text-anchor="middle" font-size="7" fill="#FFFFFF" font-weight="700">${material.label}</text>` : ''}

    ${this._renderGlow(visual, uid)}

    <!-- 右下角品质徽章（大圆标） -->
    <circle cx="78" cy="78" r="13.5" fill="url(#badge_${uid})"
            stroke="#FFFFFF" stroke-width="2.2" filter="url(#drop_${uid})"/>
    <text x="78" y="79.5" text-anchor="middle" dominant-baseline="middle"
          font-size="14" font-weight="800" fill="#FFFFFF"
          style="paint-order: stroke; stroke: rgba(0,0,0,0.28); stroke-width: 0.8px; font-family: Arial, sans-serif;">${visual.grade}</text>

    <!-- 左上角白色圆环 -->
    <circle cx="14" cy="14" r="5.2" fill="none" stroke="#FFFFFF" stroke-width="2.1" opacity="0.95"/>
    <circle cx="14" cy="14" r="2" fill="#FFFFFF" opacity="0.55"/>

    <!-- 橙金外描边（截图同款高亮边） -->
    <rect x="4" y="4" width="92" height="92" rx="20" ry="20"
          fill="none" stroke="url(#frame_${uid})" stroke-width="2.6"
          filter="url(#frameglow_${uid})" opacity="0.98"/>
    <rect x="6.2" y="6.2" width="87.6" height="87.6" rx="18" ry="18"
          fill="none" stroke="#FFFFFF" stroke-width="0.8" opacity="0.22"/>
</svg>`;
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    },

    /**
     * 生成列表缩略图专用轻量 SVG（无任何 feGaussianBlur 滤镜）
     * ==========================================================
     * 原版每张图带 5 个高斯模糊滤镜（投影/发光/描边光晕），在移动端 WebView
     * 每次整页重绘都要重新解析+光栅化，订单多时是列表卡顿的主要来源之一。
     * 轻量版视觉结构一致（渐变底 + emoji + 品质角标 + 描边），仅：
     *   - 投影改为偏移纯色圆角矩形（无模糊）
     *   - 去掉 aura / frameglow / emoji_shadow / glow 等全部 filter
     * 50px 缩略图下肉眼几乎无差别，但体积约 -60%、光栅化开销约 -90%。
     */
    renderLite(product, grade, fingerprint) {
        const icon = resolveProductEmoji(product);
        const material = (typeof resolveProductMaterial === 'function')
            ? resolveProductMaterial(product.name) : null;
        let colors = (typeof CATEGORY_COLORS !== 'undefined' && CATEGORY_COLORS[product.category])
            ? CATEGORY_COLORS[product.category]
            : { primary: '#7C4DFF', secondary: '#1565C0' };
        if (material && material.color) {
            colors = {
                primary: this._mixColor(material.color, colors.primary, 0.35),
                secondary: this._mixColor(material.color, colors.secondary || colors.primary, 0.2)
            };
        }
        const visual = QUALITY_GRADE_VISUALS[grade] || QUALITY_GRADE_VISUALS.B;
        const uid = (product.id + '_' + grade + '_' + fingerprint + '_lite').replace(/[^a-zA-Z0-9]/g, '_');
        const frameColor = visual.grade === 'A' ? '#FFD54F'
            : (visual.grade === 'C' ? '#CFD8DC' : '#FFB300');

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<defs>
    <linearGradient id="lgbg_${uid}" x1="18%" y1="0%" x2="82%" y2="100%">
        <stop offset="0%"  stop-color="${this._mixColor(colors.primary, '#FFFFFF', 0.12)}"/>
        <stop offset="42%" stop-color="${colors.primary}"/>
        <stop offset="100%" stop-color="${this._mixColor(colors.secondary, '#0D1B4C', 0.35)}"/>
    </linearGradient>
    <linearGradient id="lgtop_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"  stop-color="#FFFFFF" stop-opacity="0.42"/>
        <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
</defs>

<!-- 轻量投影（无模糊的偏移色块） -->
<rect x="5" y="7" width="92" height="92" rx="20" ry="20" fill="rgba(0,0,0,0.18)"/>

<!-- 底板 -->
<rect x="4" y="4" width="92" height="92" rx="20" ry="20" fill="url(#lgbg_${uid})"/>
<rect x="4" y="4" width="92" height="44" rx="20" ry="20" fill="url(#lgtop_${uid})"/>

<!-- Emoji 主图标 -->
<text x="50" y="52" text-anchor="middle" dominant-baseline="middle" font-size="44">${icon}</text>
${material ? `<text x="22" y="78" text-anchor="middle" font-size="12">${material.emoji}</text>
<text x="22" y="90" text-anchor="middle" font-size="7" fill="#FFFFFF" font-weight="700">${material.label}</text>` : ''}
${visual.hasGlow ? `<text x="86" y="66" font-size="7" fill="${visual.lightColor}" opacity="0.9">★</text>` : ''}

<!-- 右下角品质徽章 -->
<circle cx="78" cy="78" r="13.5" fill="${visual.primaryColor}" stroke="#FFFFFF" stroke-width="2.2"/>
<text x="78" y="79.5" text-anchor="middle" dominant-baseline="middle"
      font-size="14" font-weight="800" fill="#FFFFFF" style="font-family: Arial, sans-serif;">${visual.grade}</text>

<!-- 左上角白色圆环 -->
<circle cx="14" cy="14" r="5.2" fill="none" stroke="#FFFFFF" stroke-width="2.1" opacity="0.95"/>
<circle cx="14" cy="14" r="2" fill="#FFFFFF" opacity="0.55"/>

<!-- 外描边 -->
<rect x="4" y="4" width="92" height="92" rx="20" ry="20"
      fill="none" stroke="${frameColor}" stroke-width="2.6" opacity="0.98"/>
<rect x="6.2" y="6.2" width="87.6" height="87.6" rx="18" ry="18"
      fill="none" stroke="#FFFFFF" stroke-width="0.8" opacity="0.22"/>
</svg>`;
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    }
};

// ==================== 统一对外API ====================
const ProductClassifier = {
    nameRecognizer: ProductNameRecognizer,
    imageManager: ProductImageManager,
    iconRenderer: ProductIconRenderer,
    visuals: QUALITY_GRADE_VISUALS,

    /** 本地正式资源路径（assetManifest），缺失则 null */
    _localAssetPath(productId) {
        try {
            if (typeof getProductAssetPath === 'function') {
                const p = getProductAssetPath(productId);
                if (p) return p;
            }
            if (typeof ASSET_MANIFEST !== 'undefined' && ASSET_MANIFEST.products) {
                return ASSET_MANIFEST.products[productId] || null;
            }
        } catch (_) {}
        return null;
    },

    _hasFormalAssets() {
        try {
            return !!(typeof ASSET_MANIFEST !== 'undefined'
                && ASSET_MANIFEST.products
                && Object.keys(ASSET_MANIFEST.products).length > 0);
        } catch (_) {
            return false;
        }
    },

    /**
     * 初始化整个商品识别与分类系统
     */
    init(products) {
        // 1. 初始化名称识别器（构建关键词索引），同时为每个商品注入emoji/icon（保证图标正确显示）
        products.forEach(p => {
            const emoji = resolveProductEmoji(p);
            p.icon = emoji;
            p.emoji = emoji;
        });
        ProductNameRecognizer.init(products);
        ProductImageManager.reset();
        // 2. 预生成全部商品×等级 SVG（界面统一此风格）；正式 jpg 仅用于扩包，不参与展示
        products.forEach(product => {
            ['A', 'B', 'C'].forEach(grade => {
                ProductImageManager.getOrCreateImage(product, grade, (p, g, fp) => {
                    return ProductIconRenderer.render(p, g, fp);
                });
            });
        });
        console.log('[ProductClassifier] 商品识别系统初始化完成', {
            ...ProductImageManager.getStats(),
            formalAssets: this._hasFormalAssets()
        });
    },

    /**
     * 获取商品指定等级的图片（统一高级 SVG 风格：圆角渐变 + 描边 + 品质角标）
     * 本地 jpg 仅作正式包体资源；界面显示始终用 SVG，保证 A/B/C 徽章正确且风格一致
     */
    getProductImage(productId, grade = 'B') {
        const g = (grade === 'A' || grade === 'C') ? grade : 'B';
        const badId = productId == null || productId === ''
            || String(productId) === 'undefined'
            || String(productId) === 'null'
            || String(productId) === 'NaN';
        let product = badId ? null : ProductNameRecognizer.findById(productId);
        if (!product) {
            // 识别器未命中：无效 ID 用中性占位，避免默认成手机图
            product = {
                id: badId ? 'unknown' : productId,
                name: badId ? '未知商品' : String(productId),
                category: 'others'
            };
        }
        const result = ProductImageManager.getOrCreateImage(product, g, (p, gg, fp) => {
            return ProductIconRenderer.render(p, gg, fp);
        });
        return result.dataURI;
    },

    /**
     * 获取商品轻量缩略图（列表/订单卡片专用）：无高斯模糊滤镜版 SVG，
     * 视觉与正式图一致但真机重绘开销大幅下降。生成失败时回退正式图。
     */
    getProductImageLite(productId, grade = 'B') {
        const g = (grade === 'A' || grade === 'C') ? grade : 'B';
        const badId = productId == null || productId === ''
            || String(productId) === 'undefined'
            || String(productId) === 'null'
            || String(productId) === 'NaN';
        let product = badId ? null : ProductNameRecognizer.findById(productId);
        if (!product) {
            product = {
                id: badId ? 'unknown' : productId,
                name: badId ? '未知商品' : String(productId),
                category: 'others'
            };
        }
        const cached = ProductImageManager.getImageLite(product.id, g);
        if (cached && cached.dataURI) return cached.dataURI;
        try {
            const dataURI = ProductIconRenderer.renderLite(product, g,
                ProductImageManager.generateFingerprint(product.id, g));
            ProductImageManager.setImageLite(product.id, g, dataURI);
            return dataURI;
        } catch (e) {
            // 兜底：任何异常都回退正式图，绝不让列表丢图
            return this.getProductImage(productId, grade);
        }
    },

    /**
     * 识别商品名称
     */
    recognize(inputName, options) {
        return ProductNameRecognizer.recognize(inputName, options);
    },

    recognizeBest(inputName, options) {
        return ProductNameRecognizer.recognizeBest(inputName, options);
    },

    /**
     * 获取品质等级视觉配置
     */
    getGradeVisual(grade) {
        return QUALITY_GRADE_VISUALS[grade] || QUALITY_GRADE_VISUALS.B;
    },

    getStats() {
        return ProductImageManager.getStats();
    }
};

// 导出到全局作用域
if (typeof window !== 'undefined') {
    window.ProductClassifier = ProductClassifier;
    window.ProductNameRecognizer = ProductNameRecognizer;
    window.ProductImageManager = ProductImageManager;
    window.QUALITY_GRADE_VISUALS = QUALITY_GRADE_VISUALS;
}
