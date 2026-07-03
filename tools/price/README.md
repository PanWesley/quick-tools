# 真价助手

真价助手是 `tools/price/` 下的本地优先买前查价 PWA，用于解析商品详情页链接、记录本地历史价格、判断当前价格区间，并管理本地关注目标价。

## 已实现范围

- 本地优先，无需登录即可使用。
- 数据保存在 IndexedDB `zhenjiaAssistantDB`。
- 支持京东、淘宝、天猫、拼多多商品详情页链接解析。
- 支持示例商品体验完整流程，不依赖真实平台 API。
- 支持手动记录价格、查看本地价格曲线、生成真低价判断。
- 支持本地关注目标价，以及 JSON 导入导出备份。
- 接入独立 PWA manifest、Service Worker、根首页工具卡片和 Vercel 路由。
- 接入站点级匿名统计，只统计工具访问与活跃时长，不上传商品链接、价格记录或关注目标价。

## 判断口径

真价助手首版使用本地历史价格做区间判断：

- 记录少于 5 条或有效价格不足时，显示“数据不足”。
- 当前价不高于本地历史最低价时，显示“历史低价”。
- 当前价低于近 90 天 P20 分位时，显示“近期低价”。
- 当前价位于近 90 天 P20-P70 区间时，显示“价格一般”。
- 当前价高于近 90 天 P70 分位时，显示“偏贵”。

## 明确非目标

首版不实现真实采集、短链展开、优惠券抓取、CPS 转链、登录同步、邮件/短信/推送提醒。这些能力只作为后续演进方向，不会在当前本地工具里隐式启用。

站点级匿名统计只用于了解工具访问趋势，不采集用户输入的商品链接、价格、备注、关注目标价或导入导出内容。

## 本地验证

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
Get-ChildItem tools/price/js -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check tools/price/sw.js
node -e "const fs=require('fs'); ['tools/price/manifest.json','manifest.json','vercel.json'].forEach((f)=>JSON.parse(fs.readFileSync(f,'utf8')));"
git diff --check
```

浏览器验证建议使用新的本地端口访问 `/tools/price/`，避免旧 Service Worker 缓存影响结果。
