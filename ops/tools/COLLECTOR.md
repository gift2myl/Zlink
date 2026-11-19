# 北京灵之智能公开房源采集器

## 当前可运行范围

隔离环境：`/workspace/scratch/d26fdd117e22/scrapling_env`。安装 Scrapling 0.5.1 和 curl_cffi 0.17.0。Scrapling Selector 可解析公开 HTML/JSON 中显式指定的房源字段。

原生 `scrapling.fetchers.Fetcher` 导入需要 patchright 等额外依赖。补装 patchright/browserforge 的操作被自动审批拒绝，原因是超出“普通公开 HTTP，不安装自动浏览器或启用隐匿身份功能”的范围。未重试、未执行 `scrapling install`、未下载或调用自动浏览器。当前备用传输为标准库 `urllib.request`，状态中如实标记 `engine.transport: "urllib"`、`fetcherAvailable: false`，不称为原生 Fetcher 可用。

官方参考：[PyPI](https://pypi.org/project/scrapling/0.5.1/)、[官方文档](https://scrapling.readthedocs.io/en/latest/)、[官方 HTTP 实现](https://github.com/D4Vinci/Scrapling/blob/main/scrapling/engines/static.py)。原生 Fetcher 默认有浏览器模拟，未来仅在授权范围允许其依赖时才可选 `--transport native`，代码已显式禁用模拟与隐匿请求头。

## 结果文件

- `assets/crawl-status.json`：引擎、范围、时间、状态、筛选验证、请求页数、本次有效采集去重数（`uniqueCount`，可能与历史重叠）、终止原因、HTTP 状态、内容长度、SHA-256 及简短挑战标记。
- `assets/crawled-properties.json`：归一化公开房源字段与来源；ID 是字符串，采集不会把 `modelReady` 设为 true。
- `tools/runs/<时间>/manifest.json`：抓取清单。不保存原始挑战串、Cookie、凭据、响应头或个人联系方式。

零新记录不会覆盖既有采集记录，也不会修改原 `assets/properties.json` 的 10 条样本。部分采集按真实 ID 合并历史记录；只有筛选、分页和精确总量均有证据且一致时才可能标记 complete。页面“500+”不是精确总数，不可作为总量校验。

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

`adapt-json --input <公开清单.json> --config <字段映射.json>` 不发送网络请求。城市须为北京，筛选和字段映射须已核验并使用 JSON 布尔值 `true`，字符串 `"true"` / `"false"` 均不视为已核验；离线清单适配不要求分页核验。配置的 `extraction.format` 为 `json`，`recordPath` 指向清单数组（根数组用空字符串），`fields` 将输出字段映射为输入的点分隔路径，例如 `{"id":"house_id","name":"community_name"}`。仅允许房源字段白名单，未知字段不输出。此适配器不会自动把导入清单声明为全量或当前在租。

分页采集支持经核验的 HTML 下一页链接，或经核验的 GET 页码参数；没有实现、调用或宣称任何自如隐藏 API。读取失败、校验、登录或频率限制会停止；不会执行 JavaScript、登录、解验证码、轮换代理或发送真实设备/工单操作。

退出码：0 表示有证据的 complete，2 表示 blocked，3 表示 partial。
