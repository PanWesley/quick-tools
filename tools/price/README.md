# 真价助手

真价助手是 `tools/price/` 下的本地优先买前查价工具，用于解析商品链接、记录本地历史价格、判断当前价格区间，并管理本地关注目标价。

## 范围

- 本地优先，无需登录即可使用。
- 数据保存在 IndexedDB `zhenjiaAssistantDB`。
- 支持京东、淘宝、天猫、拼多多商品详情页链接解析。
- 支持示例商品、手动价格记录、本地关注和 JSON 导入导出。
- 真实采集、优惠券、CPS 转链、邮件提醒目前仅作为后续能力说明，不在首版启用。

## 本地验证

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
Get-ChildItem tools/price/js -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check tools/price/sw.js
git diff --check
```

使用新端口启动静态服务后访问 `/tools/price/`，避免旧 Service Worker 缓存影响验证。
