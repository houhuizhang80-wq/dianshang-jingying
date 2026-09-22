// ============================================================================
// 用户协议与隐私政策 - 唯一内容源
// ----------------------------------------------------------------------------
// 本文件是协议正文的【唯一权威来源】：
//   - h5Body          → index.html 的 #privacyPolicyBody（浏览器弹窗 / 个人中心「查看协议」）
//   - androidMessage  → androidPrivacy.json 的 message（App 原生启动弹窗 / 商店页隐私链接）
//
// 修改协议请只改本文件，然后运行：
//   node tools/sync-privacy.js          # 重新生成 androidPrivacy.json
//   node tools/sync-privacy.js --check  # 仅校验两份是否一致
//
// 注意：H5 与原生渲染器不同（H5 支持 <p>，原生弹窗只支持 <br/> 拼接），
//       因此同一份正文需要两种格式，但文字内容保持一致。
// ============================================================================

const PRIVACY_POLICY = {

    // ==================== H5 弹窗正文（index.html #privacyPolicyBody） ====================
    h5Body: `
        <p class="privacy-welcome">欢迎使用《电商经营模拟器》！请审慎阅读并充分理解本政策全部条款。未勾选并点击「同意并进入」前，无法进入游戏，我们也不会初始化广告 SDK 或收集下述设备信息。</p>

        <p class="privacy-section-title">特别告知：收集读取 IMSI</p>
        <p class="privacy-text"><b>本应用存在收集、读取 IMSI（国际移动用户识别码）的行为。</b>在你点击「同意」之前，我们不会收集读取 IMSI。点击「同意」即表示你已知悉：收集类型为 IMSI；目的为广告投放、反作弊与故障分析；方式为通过设备与 SIM 卡相关接口读取；不用于识别真实身份、不向无关第三方出售。若不同意，请点击「不同意并退出」，将无法进入游戏。</p>

        <p class="privacy-section-title">一、本应用自身收集的信息</p>
        <p class="privacy-text">本游戏主要为单机经营模拟玩法。为提供游戏存档、激励广告与基础统计分析服务，<b>仅在你点击「同意」之后</b>，本应用自身可能收集以下设备标识信息：<b>Android ID、OAID（匿名设备标识符）、IMEI、IMSI、DEVICE_ID、IDFA</b>。上述信息用于广告投放、反作弊与故障分析，不会用于识别你的真实身份，也不会强制收集姓名、身份证号等个人身份信息。</p>

        <p class="privacy-section-title">二、数据存储</p>
        <p class="privacy-text">游戏进度、存档等数据主要保存在你的设备本地（含本地存储 / IndexedDB 等）。完整存档不会上传到自有服务器。清除应用数据或卸载应用可能导致存档丢失，请自行备份重要进度。</p>

        <p class="privacy-section-title">三、第三方服务与 SDK</p>
        <p class="privacy-text">本游戏基于 DCloud uni-app(5+ App/Wap2App) 引擎运行，并集成 uni-ad 聚合广告。下列 SDK <b>仅在你同意本政策之后才会初始化</b>，并可能读取所列信息用于广告投放、监测归因、反作弊与统计分析。详情还可阅读 <a href="https://dcloud.io/license/appprivacy.html" target="_blank" rel="noopener">《DCloud App引擎隐私政策》</a> 与 <a href="https://dcloud.io/license/uni-ad.html" target="_blank" rel="noopener">《uni-AD 隐私政策》</a>。</p>
        <p class="privacy-text"><b>1. DCloud / uni-AD 原生广告 SDK</b><br/>开发者：数字天堂（北京）网络技术有限公司。<br/>收集信息：设备品牌/型号/系统版本、应用包名与版本、网络信息，以及可选的 Android ID、OAID、IMEI、IMSI、MAC 地址、传感器信息、应用安装列表。<br/>目的：广告聚合、投放、反作弊与故障分析。</p>
        <p class="privacy-text"><b>2. 孛樊 SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、IMEI、IMSI、传感器信息、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。</p>
        <p class="privacy-text"><b>3. 泛连广告 SDK（Funlink）</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、IMEI、IMSI、MAC 地址、传感器信息、应用安装列表</b>。<br/>目的：广告投放、监测归因、摇一摇等交互广告与反作弊。仅在你同意本政策后初始化。<br/>隐私政策：<a href="https://www.adfunlink.com/doc/privacy.pdf" target="_blank" rel="noopener">https://www.adfunlink.com/doc/privacy.pdf</a></p>
        <p class="privacy-text"><b>4. Octopus 广告 SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。<br/>隐私政策：<a href="https://doc.adintl.cn/docs/SDK%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96/UsePrivacy/" target="_blank" rel="noopener">Octopus SDK 隐私政策</a></p>
        <p class="privacy-text"><b>5. 倍孜 AdScope SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。</p>

        <p class="privacy-section-title">四、权限说明</p>
        <p class="privacy-text">为实现存储、网络访问、广告等功能，应用可能申请网络、存储、设备信息等系统权限。你可以在系统设置中管理授权；拒绝非必要权限可能影响对应功能，但不影响你浏览本政策。</p>

        <p class="privacy-section-title">五、未成年人保护</p>
        <p class="privacy-text">我们重视未成年人保护。若你是未成年人，请在监护人陪同下阅读本政策并使用本游戏；监护人同意后方可点击「同意」。</p>

        <p class="privacy-section-title">六、协议更新</p>
        <p class="privacy-text">我们可能适时更新本政策。更新后将在应用内公布；若涉及重大变更，将再次征得你的同意。你继续使用本游戏即表示理解并接受更新后的政策。</p>

        <p class="privacy-section-title">七、联系我们</p>
        <p class="privacy-text">如对本政策有疑问，请通过应用商店评价或游戏内反馈与我们联系。</p>

        <p class="privacy-contact">点击「同意」即表示你已阅读并同意本《用户协议与隐私政策》全部内容。</p>
    `.replace(/^\s+|\s+$/g, '').replace(/\n\s*/g, '\n').trim(),

    // ==================== App 原生启动弹窗正文（androidPrivacy.json message） ====================
    // 原生弹窗不支持 <p>，统一用 <br/> 拼接；IMSI「特别告知」为安卓应用商店合规要求，仅原生端需要。
    androidMessage: '欢迎使用《电商经营模拟器》！请你务必审慎阅读、充分理解本《用户协议与隐私政策》全部条款后再决定是否同意。未点击「同意」前，我们不会初始化广告 SDK，也不会收集下述设备信息。<br/><br/><b>特别告知：收集读取 IMSI</b><br/><b>本应用存在收集、读取 IMSI（国际移动用户识别码）的行为。</b>在你点击「同意」之前，我们不会收集读取 IMSI。点击「同意」即表示你已知悉并同意以下内容：<br/>1. 收集的个人信息类型：IMSI（国际移动用户识别码）。<br/>2. 目的：广告投放、反作弊与故障分析。<br/>3. 方式：通过设备与 SIM 卡相关接口读取 IMSI。<br/>4. 范围：仅用于上述目的，不用于识别你的真实身份，不向无关第三方出售。<br/>5. 若你不同意收集读取 IMSI，请点击「不同意并退出」。不同意将无法进入游戏。<br/><br/><b>一、本应用自身收集的信息</b><br/>本游戏主要为单机经营模拟玩法。为提供游戏存档、激励广告与基础统计分析服务，仅在你点击「同意」之后，本应用自身可能收集以下设备标识信息：<b>Android ID、OAID（匿名设备标识符）、IMEI、IMSI、DEVICE_ID、IDFA</b>。上述信息用于广告投放、反作弊与故障分析，不会用于识别你的真实身份，也不会强制收集姓名、身份证号等个人身份信息。<br/><br/><b>二、数据存储</b><br/>游戏进度、存档等数据主要保存在你的设备本地（含本地存储 / IndexedDB 等）。完整存档不会上传到自有服务器。清除应用数据或卸载应用可能导致存档丢失，请自行备份重要进度。<br/><br/><b>三、第三方服务与 SDK</b><br/>本游戏基于 DCloud uni-app(5+ App/Wap2App) 引擎运行，并集成 uni-ad 聚合广告。下列 SDK 仅在你同意本政策之后才会初始化，并可能读取所列信息用于广告投放、监测归因、反作弊与统计分析。详情还可阅读：<a href="https://dcloud.io/license/appprivacy.html">《DCloud App引擎隐私政策》</a>、<a href="https://dcloud.io/license/uni-ad.html">《uni-AD 隐私政策》</a>。<br/><br/><b>1. DCloud / uni-AD 原生广告 SDK</b><br/>开发者：数字天堂（北京）网络技术有限公司。<br/>收集信息：设备品牌/型号/系统版本、应用包名与版本、网络信息，以及可选的 Android ID、OAID、IMEI、IMSI、MAC 地址、传感器信息、应用安装列表。<br/>目的：广告聚合、投放、反作弊与故障分析。<br/><br/><b>2. 孛樊 SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、IMEI、IMSI、传感器信息、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。<br/><br/><b>3. 泛连广告 SDK（Funlink）</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、IMEI、IMSI、MAC 地址、传感器信息、应用安装列表</b>。<br/>目的：广告投放、监测归因、摇一摇等交互广告与反作弊。仅在你同意本政策后初始化。<br/>隐私政策：<a href="https://www.adfunlink.com/doc/privacy.pdf">https://www.adfunlink.com/doc/privacy.pdf</a><br/><br/><b>4. Octopus 广告 SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。<br/>隐私政策：<a href="https://doc.adintl.cn/docs/SDK%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96/UsePrivacy/">Octopus SDK 隐私政策</a><br/><br/><b>5. 倍孜 AdScope SDK</b><br/>用途：广告投放。<br/>收集信息：<b>Android ID、OAID、应用安装列表</b>。<br/>目的：广告投放、监测归因与反作弊。仅在你同意本政策后初始化。<br/><br/><b>四、权限说明</b><br/>为实现存储、网络访问、广告等功能，应用可能申请网络、存储、设备信息等系统权限。你可以在系统设置中管理授权；拒绝非必要权限可能影响对应功能，但不影响你浏览本政策。<br/><br/><b>五、未成年人保护</b><br/>我们重视未成年人保护。若你是未成年人，请在监护人陪同下阅读本政策并使用本游戏；监护人同意后方可点击「同意」。<br/><br/><b>六、协议更新</b><br/>我们可能适时更新本政策。更新后将在应用内公布；若涉及重大变更，将再次征得你的同意。你继续使用本游戏即表示理解并接受更新后的政策。<br/><br/><b>七、联系我们</b><br/>如对本政策有疑问，请通过应用商店评价或游戏内反馈与我们联系。<br/><br/>点击「同意」即表示你已阅读并同意本《用户协议与隐私政策》全部内容。'
};
