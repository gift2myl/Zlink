# 灵之数字员工远程运维 Demo · 官网部署

本版本替换 zlink.help 官网首页，使用现有 gift2myl/Zlink → Vercel lock 发布链路。

- 根目录 index.html 是新首页；应用模块、图片、数据、Three.js 均位于 ops/。
- 沿用原静态站部署，无构建步骤，无新增后端或外部 CDN。
- 旧版保留于备份分支 backup/zlink-before-ops-20261119；旧版提交 a2a736b1a77282da338a7aec4327217add4a19ac。
- 本地需从仓库根目录提供 HTTP 服务，例如 python3 -m http.server 8080；不能只服务 ops/。

## 范围与来源

2026-11-19自如北京地图“更多→灵之智能”筛选显示500+聚合标签、10个区域；本版仅收录10条房源样本。区级信标不是房屋精确坐标，未取得全量明细与实时接口。

望京路3号院（公开房源 https://www.ziroom.com/x/810151211.html）根据1张户型图、10张照片程序化建模。主要空间、家具和门窗有参考；部分尺寸、墙高与遮挡结构是推断，设备位置及遥测为演示。

设备报表来自用户运维截图，采样日期未知，实际可见7个型号、8条设备记录，不代表全局设备在线率。

4位数字员工展示监控、诊断、工单调度与经验蒸馏；4条事件可执行诊断→工单草稿→模拟复验，状态保存在当前浏览器localStorage。没有真实设备控制、实际派单、账号鉴权或共享后台数据库。CSV导入只更新本地台账，不能覆盖已核验公开样本ID，也不自动地图布点或生成三维。

WebGL为主要渲染路径，包含纹理、光照与阴影；无WebGL浏览器使用Three.js SVG兼容渲染，材质呈现能力有限。

img2threejs永久安装被自动安全审核拒绝；本版仅参考公开建模方法，未运行上游自动保真门禁。

地图边界：https://geo.datav.aliyun.com/areas_v3/bound/110000_full.json
房源来源：https://ditu.ziroom.com/map?city_code=110000&page_source=homepage_map
方法参考：https://github.com/img2threejs/img2threejs

## 发布与回退

本次通过GitHub提交与main分支更新触发现有Vercel自动发布。应分别检查 Vercel – lock 的部署状态；旧的 zlinkservice 项目状态不代表官网部署状态。回退应在保留当前main历史的前提下恢复备份内容，并等待生产部署成功。
