# 北京灵之智能公开房源采集器

## 当前可运行范围

隔离环境：`/workspace/scratch/d26fdd117e22/scrapling_env`。安装 Scrapling 0.5.1 和 curl_cffi 0.17.0。Scrapling Selector 可解析公开 HTML/JSON 中显式指定的房源字段。

原生 `scrapling.fetchers.Fetcher` 导入需要 patchright 等额外依赖。补装 patchright/browserforge 的操作被自动审批拒绝，原因是超出“普通公开 HTTP，不安装自动浏览器或启用隐匿身份功能”的范围。未重试、未执行 `scrapling install`、未下载或调用自动浏览器。当前备用传输为标准库 `urllib.request`，状态中如实标记 `engine.transport: "urllib"`、`fetcherAvailable: false`，不称为原生 Fetcher 可用。

官方参考：[PyPI](https://pypi.org/project/scrapling/0.5.1/)、[官方文档](https://scrapling.readthedocs.io/en/latest/)、[官方 HTTP 实现](https://github.com/D4Vinci/Scrapling/blob/main/scrapling/engines/static.py)。原生 Fetcher 默认有浏览器模拟，未来仅在授权范围允许其依赖时才可选 `--transport native`，代码已显式禁用模拟与隐匿请求头。

## 结果文件

- `assets/crawl-status.json`：引擎、范围、时间、状态、筛选验证、请求页数、本次有效采集去重数（`uniqueCount`，可能与历史重叠）、终止原因、HTTP 状态、内容长度、SHA-256 及简短挑战标记。
- `assets/crawled-properties.json`：归一化公开房源字段与来源；ID 是字符串，采集不会把 `modelReady` 设为 true。
- `tools/runs/<时间>/manifest.json`：抓取清单。不保存原始挑战串、Cookie、凭据、响应头或个人联系方式。

零新记录不会覆盖既有采集记录，也不会修改原 `assets/properties.json` 的 10 条样本。所有成功采集均累计合并：优先按真实 ID 或原始详情链接去重，缺失时使用来源批次与本地索引。即使后续运行已完整，旧记录也保留，以 `seenInLatestRun` 区分本次可见记录；未再次出现不自动认定为下架。只有全北京范围、筛选、分页、真实身份和精确总量均有证据且一致时才可能标记 complete。页面“500+”不是精确总数，不可作为总量校验。

## 使用

```bash
PY=/workspace/scratch/d26fdd117e22/scrapling_env/bin/python
COLLECTOR=/workspace/scratch/d26fdd117e22/zlink_release/ops/tools/collect_ziroom_lingzhi.py
CONFIG=/workspace/scratch/d26fdd117e22/zlink_release/ops/tools/ziroom-lingzhi.config.json
"$PY" "$COLLECTOR" collect --config "$CONFIG"
```

当前配置故意保留 `verified: false` 及未知选择器，运行会输出 configuration_unverified，**不发请求**。只有取得正常公开页面或获授权公开清单，确认“灵之智能”筛选参数、房源字段、真实 ID 和分页语义后，才能填写并启用。不得根据默认地图猜测筛选 ID，也不能因收到校验页而改试隐蔽接口、Cookie 或模拟身份。

`probe` 仅支持用户原始地图 URL 的一次普通 GET，用于记录状态，不提取、不翻页、不跟随跳转。当前地址已出现访问校验；不要重复探测，需等待可公开访问的数据路径或用户提供清单。

## 合法清单适配入口

`adapt-json --input <公开清单.json> --config <字段映射.json>` 与 `adapt-html --input <保存页面.html> --config <字段映射.json>` 均不发送网络请求。城市须为北京，筛选和字段映射须已核验并使用 JSON 布尔值 `true`，字符串 `"true"` / `"false"` 均不视为已核验；离线清单适配不要求分页核验。配置的 `extraction.format` 为 `json`，`recordPath` 指向清单数组（根数组用空字符串），`fields` 将输出字段映射为输入的点分隔路径，例如 `{"id":"house_id","name":"community_name"}`。仅允许房源字段白名单，未知字段不输出。此适配器不会自动把导入清单声明为全量或当前在租。

分页采集支持经核验的 HTML 下一页链接，或经核验的 GET 页码参数；没有实现、调用或宣称任何自如隐藏 API。读取失败、校验、登录或频率限制会停止；不会执行 JavaScript、登录、解验证码、轮换代理或发送真实设备/工单操作。

退出码：0 表示有证据的 complete，2 表示 blocked，3 表示 partial。


## 累计房源登记册（本轮已生成）

`assets/inventory-registry.json` 是可重复生成的计数与分组快照，原始来源文件保持原样：

- `sourceScope`：北京、原地图 URL、`更多 → 灵之智能 → 确定`，明确 URL 不保存筛选状态。
- `totals`：累计收录 10、确认商圈 1、商圈待核验房源 9、小区 10、行政区 5（4 已确认、1 待核验）。
- `groups.businessAreas / bedrooms / districts`：每组都有 `key / label / count / propertyIds`；商圈候选不混为官方确认商圈。
- `totals.bedrooms`：`1:4 / 2:4 / 3+:1 / shared:1 / unknown:0`；合租卧室不使用母户型的居室数重复计套。
- `properties`：逐条保留真实身份或本地索引、来源、首次/末次观察时间、配置/户型资料缺口；在租状态和真实设备状态均保持未知。
- `referenceCoverage`：1 套有实际户型与照片、9 套待补；已核验 VR 0、实测尺寸 0。没有把通用户型或地图点算成真实户型。
- `knownTotal:null / isFullInventory:false`：北京全量未知；原页面的 `500+` 不转换为精确总数。
- `latestAttempt`：沿用 2026-11-20 北京时间 10:55:06 的真实访问校验记录。`builtAt` 只是登记册生成时间，不是新抓取时间。

```bash
LZ_PY=/workspace/scratch/d26fdd117e22/scrapling_env/bin/python
"$LZ_PY" ops/tools/build_inventory_registry.py
```

生成器只读取本地 `properties.json`、`crawled-properties.json`、字段核验记录和三维资料记录，不调用网络。

`assets/source-access-status.json` 保存当前来源停止状态。`probe` 与 `collect` 会先检查它；存在已确认访问校验时返回 `prior_source_challenge`、`networkRequests:0`，不重复请求或探测其他路径。恢复采集需要正常可访问来源及对应证据，不能靠删除停止记录、改身份或改路径处理。

## 本地 HTML 与 VR／户型链接发现

使用已获授权、正常取得的公开官网 HTML 可以离线提取实际链接：

```bash
"$LZ_PY" ops/tools/collect_ziroom_lingzhi.py inspect-html \
  --input /absolute/path/official-detail.html \
  --source-url https://www.ziroom.com/x/810151211.html \
  --observed-at 2026-11-19 \
  --output /absolute/path/reference-links.json
```

此入口使用 Scrapling Selector 读取实际 `a / img / iframe` 上的链接及标签，不执行网页脚本、不构造隐藏 API、不下载素材。只有带明确“户型 / floorplan”或“VR / 全景”等标签的引用才分类；地图列表页找到的引用保持 `unassigned_list_reference`，不跨房源嫁接。详情页引用也仅说明“页面出现了这个链接”，`downloaded / visuallyVerified / usableForReconstruction` 初始均为 false。VR 播放入口不等于三维几何或工程尺寸。

`adapt-html` 仍要求经核验的字段映射，示意结构为：

```json
{
  "cityCode": "110000",
  "startUrl": "https://ditu.ziroom.com/map?city_code=110000&page_source=homepage_map",
  "capture": {"observedAt": "实际保存页面的日期或时间"},
  "filter": {"name": "灵之智能", "verified": true, "evidence": "实际保存的筛选证据"},
  "extraction": {
    "format": "html",
    "verified": true,
    "recordCss": "从正常页面核验后的房源行选择器",
    "fields": {"id": "经核验的ID选择器", "name": "经核验的小区名选择器", "sourceUrl": "经核验的详情链接选择器"}
  }
}
```

这只是适配契约，**不是自如真实 DOM 选择器**，不能直接启用。JSON 对应 `recordPath / fields`。未提供 `capture.observedAt` 时，房源观察时间为 null，不用离线处理时间伪装抓取时间。

## 完整性门槛与增量保留

在线收集必须同时满足：已核验北京城市与灵之筛选、正常非校验页、分页无重复/失败、精确总数与去重记录数一致、每条身份可靠。还须有 `coverage.citywideVerified:true`、`citywideEvidence` 与 `viewportLimited:false`，证明总数覆盖全北京而非地图视窗或某个区域。

字段映射中的 `id` 不因看起来像数字就自动当真实房源 ID。可以由实际详情 URL 确认，或使用经核验的 `extraction.idType:"ziroom_property_id"` 与 `identityEvidence`。身份仍待核验的记录保留，但不能帮助声明全量。

本次离线验证覆盖：真实身份合并、空运行保持文件字节不变、完整运行仍保留历史、HTML 字段映射、实际户型/VR链接发现、挑战页停止、分类与前端口径一致、旧访问时间保持。测试样例只存在临时目录，没有写入正式房源。原始 4 个数据文件 SHA-256 保持一致。实际网络请求为 0。
