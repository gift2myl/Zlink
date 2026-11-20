// Extracted from the user-supplied PDF; see assets/device-configuration-301.json.
// Pure rules: no network, no assumed installed inventory or live telemetry.
const CONFIG_DATA = {"schemaVersion":1,"source":{"id":"xin-she-3.0.1-device-rules","title":"心舍3.0.1灵之解决方案简介","version":"3.0.1","sourceKind":"user_supplied_pdf","sourcePages":[4,6,7,8,9],"pageCount":10,"sha256":"8b6c7b430eba3b90e877bd665849f0ca3b14f98488a605a8ed72bac381cd766a","versionNote":"文件名及第7—8页标题为3.0.1；第6页标题写作3.0.11（1月版）。本规则按第7页数量规则并结合第4、6、8、9页解释，不据此虚构另一版本。","interpretation":"这是方案配置规则，不是任一房源的竣工设备清单；型号族、规格和设备实装须分别确认。","placementNote":"设备空间为可视化规划位置。实际点位、安装高度、燃气类型、回路与轨道长度须依据对应深化图和验收资料。","quantityNote":"设备清单只计数量规则明确的设备与用户显式选择的规划项；按需、窗长、房间是否存在等未知条件另列，不填成已安装数量。"},"categories":["场景光照","灵动控制","安全守护","全时自洁","智能窗帘","环保5恒/7恒"],"catalog":[{"id":"door-lock","name":"智能密码锁","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"安全守护","sourceCategory":"安全守护","formFactor":"door-lock","specification":"密码解锁；具体锁体型号未提供","defaultProfile":"base","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/door-lock.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["基础数量1；未提供可与设备平台SKU精确匹配的型号"]},{"id":"max1","name":"Max1网关","model":"Max1","modelStatus":"named_model","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"安全守护","formFactor":"gateway","specification":"网关、路由器合一","defaultProfile":"base","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/max1.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["Max1为本方案明确型号；不得与Max2、MAXIII或其他运维快照网关型号视为同一设备","第7页将网关排在安全守护栏；后台统一按灵动控制归类并保留原分类"]},{"id":"ztouch-1s-4","name":"Z-touch 1S面屏","model":"Z-touch 1S","modelStatus":"named_model","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"control-panel","specification":"4寸；触屏与语音控制","defaultProfile":"base","sourcePages":[6,7,8],"thumbnail":"./ops/assets/device-catalog/ztouch-1s-4.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["基础1个；Plus另按每卧室1个","第6页Plus规格包含4寸/6.9寸，第7页数量规则写Z-touch1S，本预览默认4寸，不把6.9寸自动配到房源"]},{"id":"ztouch-6.9","name":"Z-touch 6.9寸面屏","model":"Z-touch（6.9寸）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"control-panel","specification":"6.9寸，具体SKU待确认","defaultProfile":"optional","sourcePages":[6],"thumbnail":"./ops/assets/device-catalog/ztouch-1s-4.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["独立可选规格，不能与4寸Z-touch1S精确型号混同","缩略图是文档同一产品族示意，非6.9寸实物尺寸照片"]},{"id":"lingji-switch","name":"凌极开关","model":"凌极开关（键数待确认）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"wall-switch","specification":"一键/二键；连接智能灯","defaultProfile":"conditional","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/lingji-switch.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["按实际回路与设计需求确定数量，不默认每屋一只"]},{"id":"smart-switch","name":"智能开关","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"wall-switch","specification":"一键/二键/三键；连接非智能灯","defaultProfile":"conditional","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/smart-switch.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["按非智能灯回路确定；不与凌极开关混算"]},{"id":"ceiling-24w","name":"智能吸顶灯24W","model":"智能吸顶灯（24W）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"ceiling-light","specification":"24W；亮度、色温无极调节","defaultProfile":"base","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/ceiling-light.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["每卧室1盏；24W是功率规格，非精确SKU"]},{"id":"ceiling-45w","name":"智能吸顶灯45W","model":"智能吸顶灯（45W）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"ceiling-light","specification":"45W；亮度、色温无极调节","defaultProfile":"base","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/ceiling-light.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["客厅1盏；45W是功率规格，非精确SKU"]},{"id":"surface-spot-12w","name":"智能明装射灯","model":"智能明装射灯（12W）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"surface-spotlight","specification":"12W；可调亮度、色温","defaultProfile":"conditional","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/surface-spot-12w.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["玄关1、过道1；阳台长度≤3米配1、>3米配2，须先确认对应空间及长度"]},{"id":"smoke-sensor","name":"烟雾传感器","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"安全守护","sourceCategory":"安全守护","formFactor":"smoke-sensor","specification":"小巧；文档标注免换电池","defaultProfile":"plus","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/smoke-sensor.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["Plus数量1；实际安装位置及物业原配置需核验"]},{"id":"gas-sensor","name":"燃气传感器","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"安全守护","sourceCategory":"安全守护","formFactor":"gas-sensor","specification":"嵌入式、超薄；文档标注免换电池","defaultProfile":"plus","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/gas-sensor.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["Plus数量1；燃气类型、点位及物业已有设备需确认；不根据外观代入品牌SKU"]},{"id":"curtain-motor","name":"智能水平开合帘电机","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"智能窗帘","sourceCategory":"场景光照","formFactor":"curtain-motor","specification":"隐藏式水平开合","defaultProfile":"conditional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/curtain-motor.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["每条轨道1个电机；轨道数未确认时不自动生成数量"]},{"id":"curtain-track","name":"智能开合帘轨道","model":"轨道规格待窗长确认","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"智能窗帘","sourceCategory":"场景光照","formFactor":"curtain-track","specification":"伸缩轨1.95–3.6米/2.45–4.6米；另有定制轨","defaultProfile":"conditional","sourcePages":[6,7],"thumbnail":"./ops/assets/device-catalog/curtain-track.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["选伸缩轨或定制轨需窗长和异形结构；文档第7页第一轨道规格简写为1.95–3.6米，第6页完整说明可用范围"]},{"id":"usb-socket","name":"智能插座带USB","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"socket","specification":"智能通断；USB与Type-C接口","defaultProfile":"upgrade","sourcePages":[6,8,9],"thumbnail":"./ops/assets/device-catalog/usb-socket.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["选配，推荐床头；新版不作为电视智能控制的标配插座"]},{"id":"cob-strip","name":"智能COB灯带与电源","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"light-strip","specification":"普通/防水；无极调亮度和色温","defaultProfile":"conditional","sourcePages":[6,7,8,9],"thumbnail":"./ops/assets/device-catalog/cob-strip.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["升级方案建议各屋窗帘盒配置，长度与电源数量待深化图确认"]},{"id":"recessed-spot-8w","name":"智能暗装射灯","model":"智能暗装射灯（8W）","modelStatus":"specification_only","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"recessed-spotlight","specification":"8W/防水8W","defaultProfile":"optional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/recessed-spot-8w.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["按无主灯与吊顶方案选配，不由居室数推定数量"]},{"id":"magnetic-track","name":"智能磁吸轨道灯","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"场景光照","sourceCategory":"场景光照","formFactor":"magnetic-track-light","specification":"泛光、射灯、格栅、折叠格栅灯头可选","defaultProfile":"optional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/magnetic-track.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["轨道、电源、灯头规格与数量待照明深化方案"]},{"id":"roller-blind","name":"智能卷帘","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"智能窗帘","sourceCategory":"场景光照","formFactor":"roller-blind","specification":"智能开合；北京/上海/深圳可选","defaultProfile":"optional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/roller-blind.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":[]},{"id":"venetian-blind","name":"智能百叶帘","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"智能窗帘","sourceCategory":"场景光照","formFactor":"venetian-blind","specification":"智能开合、角度控制；北京/上海/深圳可选","defaultProfile":"optional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/venetian-blind.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":[]},{"id":"m20","name":"M20暖通控制器","model":"M20","modelStatus":"named_model","exactSku":null,"skuStatus":"not_provided","category":"环保5恒/7恒","sourceCategory":"环保五恒","formFactor":"hvac-controller","specification":"控中央空调；可接地暖温控器","defaultProfile":"optional","sourcePages":[7,9],"thumbnail":"./ops/assets/device-catalog/hvac-controller.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["限北京/上海/深圳方案范围；须核验空调接口及品牌兼容性","第6页缩略图是暖通控制器族示意，未证明为M20精确外观"]},{"id":"a20z","name":"A20Z暖通控制器","model":"A20Z","modelStatus":"named_model","exactSku":null,"skuStatus":"not_provided","category":"环保5恒/7恒","sourceCategory":"环保五恒","formFactor":"hvac-controller","specification":"控风管机","defaultProfile":"optional","sourcePages":[7,9],"thumbnail":"./ops/assets/device-catalog/hvac-controller.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["限北京/上海/深圳；第6页缩略图为控制器族示意，未证明为A20Z精确外观"]},{"id":"environment-5in1","name":"五合一环境传感器","model":"型号待确认","modelStatus":"unspecified","exactSku":null,"skuStatus":"not_provided","category":"环保5恒/7恒","sourceCategory":"环保五恒","formFactor":"environment-sensor","specification":"温度、湿度、CO₂、PM2.5、PM10","defaultProfile":"optional","sourcePages":[6,7,9],"thumbnail":"./ops/assets/device-catalog/environment-5in1.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["推荐两、三居，推荐不等于标配；未提供设备型号编码"]},{"id":"wall-ac","name":"智能空调挂机","model":"美的/海尔（具体型号待确认）","modelStatus":"brand_and_specification","exactSku":null,"skuStatus":"not_provided","category":"环保5恒/7恒","sourceCategory":"环保5恒/7恒","formFactor":"wall-ac","specification":"1P/1.5P","defaultProfile":"appliance","sourcePages":[6],"thumbnail":"./ops/assets/device-catalog/wall-ac.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["家电套组单列，不由灵之智能标签推定已安装；需原家电订单或设备台账"]},{"id":"floor-ac","name":"智能空调柜机","model":"美的/海尔（具体型号待确认）","modelStatus":"brand_and_specification","exactSku":null,"skuStatus":"not_provided","category":"环保5恒/7恒","sourceCategory":"环保5恒/7恒","formFactor":"floor-ac","specification":"2P","defaultProfile":"appliance","sourcePages":[6],"thumbnail":"./ops/assets/device-catalog/floor-ac.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["家电套组单列；第6页该行文字重复写挂机，配图为柜机，按2P与柜机图保留疑义","未核验具体型号，不替换为已知故障统计中的美的KFR型号"]},{"id":"smart-tv","name":"智能电视","model":"海信/TCL（具体型号待确认）","modelStatus":"brand_and_specification","exactSku":null,"skuStatus":"not_provided","category":"灵动控制","sourceCategory":"灵动控制","formFactor":"television","specification":"55/65/75寸","defaultProfile":"appliance","sourcePages":[6],"thumbnail":"./ops/assets/device-catalog/smart-tv.png","sourceImagePage":6,"appearanceEvidence":"PDF第6页产品图，仅用于型号族外观参考；不证明该房源已安装","notes":["家电套组单列，不能从房源标签推定品牌尺寸；空调电视不计入第8页溢价范围"]}],"rules":[{"id":"base-house","profile":"base","pages":[7],"text":"整套方案基础：门锁1、Max1网关1、Z-touch1S 1、每卧室24W灯1、客厅45W灯1。","requires":["居室数量","客厅存在需对应户型确认"],"countKind":"rule_projection"},{"id":"base-switch","profile":"base","pages":[6,7],"text":"凌极开关用于智能灯，智能开关用于非智能灯；按回路需求确定数量。","countKind":"conditional"},{"id":"base-spot","profile":"base","pages":[6,7],"text":"明装射灯：玄关1、过道1；阳台≤3米1、>3米2。","countKind":"conditional"},{"id":"plus-safety","profile":"plus","pages":[6,7,9],"text":"Plus烟感1、燃气1；已有物业配置与房况可调整，不等于真实设备清单。","countKind":"rule_projection"},{"id":"plus-panels","profile":"plus","pages":[7,8],"text":"Plus每卧室增加Z-touch1S 1；基础面屏不重复设到玄关。","countKind":"rule_projection"},{"id":"plus-curtain","profile":"plus","pages":[6,7,8,9],"text":"每条窗帘轨道配置电机1；单/双轨和长度须依据房况；未给轨道数不生成数量。","countKind":"conditional"},{"id":"upgrade-socket","profile":"upgrade","pages":[8,9],"text":"升级选配建议床头USB插座1，按卧室数作规划；不将电视插座作为标配。","countKind":"rule_projection"},{"id":"upgrade-light-strip","profile":"upgrade","pages":[8,9],"text":"升级建议各屋窗帘盒灯带；长度、回路和电源需深化图确认。","countKind":"conditional"},{"id":"remove-water","profile":"all","pages":[4,8],"text":"新版取消水浸标配；第8页灰色3.0历史方案不可当作3.0.1配置。","countKind":"excluded"},{"id":"remove-entry-screen","profile":"all","pages":[4,7,8],"text":"玄关Z-touch暂取消；文档提到后续Z-switch，但未给本版具体型号或数量，不能自动补成已配。","countKind":"excluded"},{"id":"shared-bedroom","profile":"all","pages":[7],"text":"合租单间只对该卧室推演灯、Plus面屏及升级插座；整套公共设备单列待核，不扩展为两居整套。","countKind":"scope_guard"},{"id":"category-normalization","profile":"all","pages":[6,7,9],"text":"统一六类后台口径；窗帘归智能窗帘、网关归灵动控制，保留文档原类别。全文未给全时自洁配置，不补造清洁设备。","countKind":"category_mapping"}],"profiles":[{"id":"base","label":"基础智能","pages":[6,7]},{"id":"plus","label":"基础 + Plus","pages":[6,7,8]},{"id":"upgrade","label":"基础 + Plus + 升级选配","pages":[6,7,8,9]}]};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
export const CONFIG_SOURCE = deepFreeze(CONFIG_DATA.source);
export const CONFIG_CATALOG = deepFreeze(CONFIG_DATA.catalog);
export const CONFIG_CATEGORIES = deepFreeze(CONFIG_DATA.categories);
export const RULES = deepFreeze(CONFIG_DATA.rules);
export const CONFIG_PROFILES = deepFreeze(CONFIG_DATA.profiles);
const CATALOG_BY_ID = new Map(CONFIG_CATALOG.map(item => [item.id, item]));
export function getCatalogItem(id) { return CATALOG_BY_ID.get(id) || null; }

function isSharedBedroom(property) {
  return property.areaScope === 'listed_bedroom' || Boolean(property.roomLabel) || /合租/.test(String(property.product || ''));
}
function validCount(value, max = 12) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}
function cleanRoom(roomId, bedroomCount, shared, roomLabel) {
  if (roomId === 'bedroom') return {id: roomId, name: shared ? String(roomLabel || '出租卧室') : bedroomCount > 1 ? '卧室1' : '卧室'};
  const match = /^bedroom-(\d+)$/.exec(roomId);
  if (match && Number(match[1]) >= 2 && Number(match[1]) <= bedroomCount && !shared) return {id: roomId, name: '卧室' + match[1]};
  if (shared) return null;
  const labels = {living:'客厅 / 起居厅',entry:'玄关',kitchen:'厨房',bathroom:'卫生间',corridor:'过道','south-balcony':'阳台','north-balcony':'洗衣阳台'};
  return labels[roomId] ? {id:roomId,name:labels[roomId]} : null;
}
function applicabilityFor(property, shared) {
  const declared = String(property.configurationVersion || property.product || '');
  if (/3\.0\.1(?:\D|$)/.test(declared)) return {status:'scheme_version_matches', label:'方案版本相符 · 实装待核', reason:'房源声明包含3.0.1；仍需实际订单、竣工点位和设备台账确认型号、数量与安装。'};
  if (shared) return {status:'bedroom_only_projection', label:'合租卧室配置推演', reason:'当前记录是一个出租卧室；所属整套户型仅作背景，公共区域设备不计入该卧室的设备数。'};
  if (declared) return {status:'cross_version_projection', label:'跨版本配置推演', reason:`当前房源产品为「${declared}」，本次按3.0.1文档推演；不证明该房源实际采用3.0.1或已安装这些设备。`};
  return {status:'version_unconfirmed', label:'方案版本待确认', reason:'房源产品版本未提供；仅展示3.0.1配置规则，须用订单、竣工点位和设备台账核对。'};
}

/**
 * Expand only explicit document quantities into proposed device instances.
 * All generated instances remain unverified/unknown, including when a source
 * property happens to have a matching product version or a floorplan.
 * curtainTracks is an explicit USER planning choice, never a measured value.
 */
export function buildDeviceConfiguration(property = {}, options = {}) {
  const allowedProfiles = new Set(['base', 'plus', 'upgrade']);
  const profile = allowedProfiles.has(options.profile) ? options.profile : 'base';
  const plus = profile === 'plus' || profile === 'upgrade';
  const shared = isSharedBedroom(property);
  const rawBedrooms = validCount(property.bedrooms);
  const bedroomCount = shared ? 1 : rawBedrooms;
  const devices = [], conditionalRules = [], notes = [];
  const serials = new Map();
  const room = id => cleanRoom(id, bedroomCount || 0, shared, property.roomLabel);
  const addRule = (id, label, reason, pages, catalogIds = [], extra = {}) => {
    conditionalRules.push({id, label, reason, sourcePages: pages, catalogIds, quantity: null, status: 'needs_confirmation', ...extra});
  };
  const add = (catalogId, roomId, quantityBasis, pages, extra = {}) => {
    const catalog = getCatalogItem(catalogId), target = room(roomId);
    if (!catalog || !target) return;
    const prefix = catalogId + '--' + roomId, serial = (serials.get(prefix) || 0) + 1;
    serials.set(prefix, serial);
    devices.push({
      id: prefix + '--' + serial, catalogId, name: catalog.name, model: catalog.model,
      modelStatus: catalog.modelStatus, exactSku: null, category: catalog.category,
      roomId, roomName: target.name, formFactor: catalog.formFactor, quantity: 1,
      specification: catalog.specification, thumbnail: catalog.thumbnail,
      configurationSource: {id: CONFIG_SOURCE.id, title: CONFIG_SOURCE.title, version: CONFIG_SOURCE.version, pages},
      quantityBasis, countKind: quantityBasis === '用户选择规划' ? 'user_planning_choice' : 'document_rule_projection',
      installationStatus: 'unverified', placementStatus: 'proposed', telemetryStatus: 'unknown',
      stateLabel: '运行状态未接入', locationNote: '房间分配为规划点位，须以对应深化图确认。', ...extra
    });
  };

  if (shared) {
    addRule('shared-common-equipment', '公共区域设备另行核对', '该记录仅覆盖出租卧室，门锁、网关、客厅面屏、公共照明、烟感和燃气不计为该卧室独有设备。', [7], ['door-lock','max1','ztouch-1s-4','ceiling-45w','smoke-sensor','gas-sensor']);
  } else {
    add('door-lock', 'entry', '文档基础整套1个', [6,7]);
    add('max1', 'living', '文档基础整套1个', [6,7]);
    add('ztouch-1s-4', 'living', '文档基础整套1个', [6,7], {locationNote:'规划在起居区；玄关不再额外增加第二块Z-touch。'});
    if (options.livingPresent !== false && bedroomCount !== 0) {
      add('ceiling-45w', 'living', '文档客厅1盏 · 客厅存在待户型确认', [6,7]);
      if (options.livingPresent !== true) notes.push('客厅45W灯按整套方案作规划；是否有独立客厅及实际照明方案仍需对应户型确认。');
    } else {
      addRule('living-light-layout', '开间 / 起居空间照明待定', '未确认独立客厅，不叠加客厅45W灯；需结合实际起居区域与灯光方案确定。', [7], ['ceiling-45w','ceiling-24w']);
    }
  }

  if (bedroomCount === null) {
    addRule('bedroom-count', '卧室数量待确认', '房源未提供有效卧室数；不按面积猜卧室数，也不生成卧室灯或面屏数量。', [7], ['ceiling-24w','ztouch-1s-4']);
  } else if (bedroomCount === 0) {
    addRule('studio-lighting', '开间照明点位待确认', '文档第8页存在开间档，但第7页卧室与客厅规则不能直接叠加到同一空间。', [7,8], ['ceiling-24w','ceiling-45w','ztouch-1s-4']);
  } else {
    for (let i = 1; i <= bedroomCount; i++) {
      const bedroomId = i === 1 ? 'bedroom' : 'bedroom-' + i;
      add('ceiling-24w', bedroomId, shared ? '文档规则投射至该出租卧室1盏' : '文档每卧室1盏', [6,7]);
      if (plus) add('ztouch-1s-4', bedroomId, shared ? 'Plus规则投射至该出租卧室1个' : '文档Plus每卧室1个', [7,8]);
      if (profile === 'upgrade') add('usb-socket', bedroomId, '升级方案床头1个 · 按卧室规划', [8,9]);
    }
  }

  addRule('switch-circuits', '开关数量按灯光回路配置', '凌极开关控制智能灯，智能开关控制非智能灯；键数和数量需回路图，当前未计数量。', [6,7], ['lingji-switch','smart-switch']);
  if (!shared) {
    if (options.entryPresent === true) add('surface-spot-12w', 'entry', '用户选择规划', [6,7], {locationNote:'用户确认预览玄关1盏射灯，实际点位仍待深化图。'});
    else if (options.entryPresent !== false) addRule('entry-spot', '玄关射灯1盏（空间待确认）', '先确认有玄关空间；未确认时不生成数量。', [7], ['surface-spot-12w']);
    if (options.corridorPresent === true) add('surface-spot-12w', 'corridor', '用户选择规划', [6,7], {locationNote:'用户确认预览过道1盏射灯，实际点位仍待深化图。'});
    else if (options.corridorPresent !== false) addRule('corridor-spot', '过道射灯1盏（空间待确认）', '先确认有独立过道；未确认时不生成数量。', [7], ['surface-spot-12w']);
    const length = Number(options.balconyLength);
    if (options.balconyLength !== null && options.balconyLength !== undefined && options.balconyLength !== '' && Number.isFinite(length) && length > 0 && length <= 30) {
      const count = length <= 3 ? 1 : 2;
      for (let i = 0; i < count; i++) add('surface-spot-12w', 'south-balcony', '用户选择规划', [6,7], {planningInput: {balconyLength: length}, locationNote:`按输入阳台长度${length}米规划${count}盏；未测量确认。`});
    } else if (options.balconyPresent !== false) {
      addRule('balcony-spot', '阳台射灯数量待长度确认', '阳台长≤3米配1盏、>3米配2盏；未提供长度，不生成射灯数量。', [7], ['surface-spot-12w']);
    }
  }

  if (plus) {
    if (!shared) {
      add('smoke-sensor', 'living', '文档Plus整套1个', [6,7,9], {locationNote:'空间仅作安防规划示意，实际烟感点位须核对设计与物业已有配置。'});
      add('gas-sensor', 'kitchen', '文档Plus整套1个', [6,7,9], {locationNote:'厨房规划点位；燃气类型、安装高度和物业已有设备须核验。'});
      addRule('safety-existing', '安防配置先核对物业已有设备', '烟感、燃气是文档Plus规则；是否已有、是否使用燃气及实际安装点位需核验，不能据方案推定已实装。', [7,9], ['smoke-sensor','gas-sensor']);
    }
    const tracks = options.curtainTracks;
    let acceptedTracks = 0, rejectedRooms = 0;
    if (tracks && typeof tracks === 'object' && !Array.isArray(tracks)) {
      for (const [roomId, value] of Object.entries(tracks).sort(([a],[b]) => a.localeCompare(b))) {
        const target = room(roomId), quantity = validCount(value, 4);
        const allowed = target && (roomId === 'living' || /^bedroom(?:-\d+)?$/.test(roomId) || /balcony$/.test(roomId));
        if (!allowed || quantity === null) { rejectedRooms++; continue; }
        for (let i = 0; i < quantity; i++) {
          const planning = {planningInput:{roomId, curtainTracks:quantity}, locationNote:'用户选择的轨道配置预览；轨长、窗型、位置及是否实装均待确认。'};
          add('curtain-motor', roomId, '用户选择规划', [6,7,8,9], planning);
          add('curtain-track', roomId, '用户选择规划', [6,7,8], planning);
          acceptedTracks++;
        }
      }
    }
    if (!acceptedTracks) addRule('curtain-track-count', '窗帘电机与轨道数量待定', '每条轨道1个电机；未给出轨道数，不从居室数自动补造。可显式选择按每屋单轨作方案预览。', [6,7,8,9], ['curtain-motor','curtain-track']);
    else addRule('curtain-track-specification', '已选轨道方案，轨长 / 窗型仍待确认', `当前为用户规划的${acceptedTracks}条轨道，不是实测数量。伸缩轨1.95–3.6米、2.45–4.6米或定制轨需按窗长选择。`, [6,7], ['curtain-track'], {plannedTrackCount:acceptedTracks});
    if (rejectedRooms) notes.push(`${rejectedRooms}项轨道规划因房间不属于该出租范围或数量无效而未生成设备。`);
  }
  if (profile === 'upgrade') addRule('upgrade-strip-length', '窗帘盒灯带与电源待长度 / 回路确认', '第8页升级建议各屋窗帘盒配置灯带；未给长度和回路，灯带米数与电源数量不生成。', [7,8,9], ['cob-strip']);
  addRule('optional-hvac-environment', '暖通、环境与家电按实际选配核对', 'M20、A20Z、五合一环境传感器、空调与电视不能仅凭灵之标签推定实装；北京在文档可选城市范围内。', [6,7,9], ['m20','a20z','environment-5in1','wall-ac','floor-ac','smart-tv']);
  notes.push('水浸未列入新版默认配置；玄关不额外添加Z-touch；Z-switch仅为后续策略，不生成本版实装项。');
  notes.push('型号族外观与方案数量均非该房源竣工证据；所有设备运行状态保持未接入。');

  const byCategory = Object.fromEntries(CONFIG_CATEGORIES.map(category => [category, 0]));
  const byRoom = {};
  for (const device of devices) {
    byCategory[device.category]++;
    if (!byRoom[device.roomId]) byRoom[device.roomId] = {roomId:device.roomId,roomName:device.roomName,count:0};
    byRoom[device.roomId].count++;
  }
  const summary = {
    countLabel: '配置规划设备项', totalDevices: devices.length, plannedDeviceCount: devices.length,
    documentRuleDeviceCount: devices.filter(device => device.countKind === 'document_rule_projection').length,
    userPlannedDeviceCount: devices.filter(device => device.countKind === 'user_planning_choice').length,
    installedConfirmedCount: 0, onlineConfirmedCount: 0, offlineConfirmedCount: 0,
    unknownTelemetryCount: devices.length, unknownQuantityRuleCount: conditionalRules.length,
    byCategory, byRoom, scope: shared ? 'listed_bedroom_only' : 'entire_property_projection',
    bedroomCount, actualInstalledCount: null, wholeHomeStatus: 'unknown', wholeHomeStatusLabel: '真实运行状态未接入'
  };
  return {
    schemaVersion:1, propertyId:String(property.id || ''), profile,
    profileLabel:CONFIG_PROFILES.find(item => item.id === profile).label,
    applicability:applicabilityFor(property,shared), devices, conditionalRules, summary,
    source:CONFIG_SOURCE, notes, planningOnly:true
  };
}
