# 官方房源资料的离线审阅入口

此工具读取已经正常取得并获授权处理的 HAR、JSON 或 HTML。它不访问自如、不重放 HAR 请求、不执行网页 JavaScript，也不修改当前采集停止记录。输出是供核验的资料清单，不能自动当作全北京在租房源。

## 使用

项目已安装的 Scrapling 环境：

```bash
LZ_PY=/workspace/scratch/d26fdd117e22/scrapling_env/bin/python
LZ_ARCHIVE_TOOL=/workspace/scratch/d26fdd117e22/zlink_release/ops/tools/inspect_official_archive.py

# HAR 须包含已保存的响应正文。只有请求清单的 HAR 会明确报告缺正文。
"$LZ_PY" "$LZ_ARCHIVE_TOOL" --input /absolute/path/official.har \
  --output /absolute/path/archive-review.json

# 独立 JSON / HTML 必须提供对应官方来源 URL，保存时间未知时不要填写。
"$LZ_PY" "$LZ_ARCHIVE_TOOL" --input /absolute/path/saved-list.json \
  --source-url 'https://ditu.ziroom.com/map?city_code=110000&page_source=homepage_map' \
  --observed-at '2026-11-20T10:00:00+08:00' \
  --output /absolute/path/archive-review.json

"$LZ_PY" "$LZ_ARCHIVE_TOOL" --input /absolute/path/saved-detail.html \
  --source-url 'https://www.ziroom.com/x/810151211.html' \
  --output /absolute/path/detail-review.json
```

命令中的日期仅为格式示例，应替换为实际保存时间。来源 URL 是资料归属说明，不会被请求。JSON 扩展名的 HAR 可显式使用 `--format har`。ZIP 暂不支持。

## 输出契约

| 字段 | 含义 |
|---|---|
| `archive.sha256 / bytes / format` | 原始档案的摘要、大小、格式；不复制原始正文 |
| `engine` | Scrapling HTML 解析、标准库 JSON 解析；网络请求 0、脚本执行 false、请求重放 false |
| `knownTotal / isFullInventory / filterVerified` | 固定为 `null / false / false`，须在独立核验后另行决定 |
| `documents` | 每份响应的来源 URL、保存时间、正文 SHA、格式、北京城市参数（若实际出现） |
| `records` | 从明确字段别名发现的房源候选；保留字段值、逐字段出处、身份冲突、该记录自己的灵之标签和城市字段 |
| `listingLinks` | 实际出现的官方 `/x/<数字>.html` 详情链接及身份，不把 `/xiaoqu/` 小区 ID 当房源 ID |
| `references` | 明确标记的户型图或 VR 引用；是否关联详情身份单独记录；未下载、未目视核验、未用于建模 |
| `issues` | 缺响应正文、无官方来源、解析失败、超出限制等机器可读代码，不回显原始内容 |
| `summary` | 仅表示该资料包中观察到的记录与链接数量，绝不是城市库存总量 |

每条候选的 `fields` 是白名单值，`fieldEvidence.<字段>[]` 记录值与原始 JSON 路径、响应编号、来源 URL、保存时间；不同别名提供冲突值时列入 `conflictingFields`。非标准结构不会自动猜成正式台账。

支持的白名单包括：小区名、房源标题、声称的房源 ID、实际详情 URL、行政区、商圈、面积、居室数、户型描述、楼层、朝向、地铁信息、产品标签、房间标签、面积/居室范围及城市字段。价格图片、推断地址、未说明的设备实装不自动生成。

`identity.status`：

- `detail_url_observed`：该记录中实际出现唯一官方详情 URL；仍需核对记录内容和标签。
- `claimed_id_candidate`：只有明确 ID 字段或带房源信息的泛化 ID，不等于已核验真实房源。
- `identity_conflict`：详情链接或 ID 不一致，禁止自动合并。

页面/顶层响应的“灵之智能”字样不向每个子记录传播。记录自己的 `product / tags / listingLabel` 出现该标签才标记 `lingzhiLabelVisibleOnRecord:true`；这仍不等于全量筛选核验。城市 URL 参数与记录自身城市字段分开保存。

HTML 只解析实际链接属性，以及 `application/json` / `application/ld+json` 的字面 JSON。普通脚本、拼接接口、页面函数不会执行。列表页发现的户型/VR链接默认未关联，不能套到全部房源；详情响应中的引用也仍需目视确认。

## 数据最小化与限额

- HAR 只访问 `request.url`、响应状态、正文内容/格式/编码和保存时间。请求头、Cookie、请求正文、授权信息不会读取为业务数据或写入结果。
- JSON 中敏感键整棵跳过，输出不包含租客、业主、联系人或账户字段；白名单文本里的电话、邮箱和显式凭据字符串会移除。
- URL 只保留少量公开标识参数；授权或登录路径、含用户名密码的 URL、私网地址不会输出。任意未知查询参数均移除。
- 档案上限 64 MiB，单响应正文 8 MiB，HAR 最多 3,000 条，JSON 最深 24 层、总遍历 100,000 节点；记录/链接/引用均有数量上限。达到上限会标记 `truncated`。
- 输出原子写入，输入和输出不得同名；失败只输出概括错误，不回显内容。

该审阅工具不会修改 `source-access-status.json`、`crawl-status.json`、正式房源台账或官网。核验输出后，才可给现有 `adapt-json / adapt-html` 建立明确字段映射，并继续户型材料审阅与三维重建。
