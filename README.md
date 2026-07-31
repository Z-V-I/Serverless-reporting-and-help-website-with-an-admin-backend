# 教你举报 - 免费举报辅助平台

> 一个帮助普通人了解如何规范、安全地举报的公益工具站。
> **全程零服务器成本**，基于 Cloudflare 免费套餐搭建。

---

## 功能总览

### 主站 `/` — 7 步举报辅助流程
1. **渠道查询** — 选择举报类型（教育/综合政务）+ 省份，展示国家级 + 省级完整举报渠道
2. **常见问题** — 解答"身份泄露""已读不回"等担忧
3. **证据采集** — 录屏规范、录音取证、区块链存证指南
4. **保护自己** — 打印机暗记、网络隔离、身份保护
5. **热力地图** — 匿名提交举报地点，全国分布一目了然（每个 IP 每天 10 次限制）
6. **撰写举报书** — 三种模式：模板对照 / AI 生成（DeepSeek）/ 文本混淆
7. **完成页** — 祝福 + 反馈

### 热力地图展示页 `/heatmap`
- 全国举报热力图（红点 = 举报次数）
- Top 10 举报高发地排行榜
- 举报数据总表（20 条/页，支持按时间/类型/地点筛选）

### 后台管理 `/admin`
- 邮箱 + 密码 + 计算题 + 验证码 多因素登录
- 访问量趋势 / 365 天热力图 / 时段分布 / AI 使用统计
- 举报类型占比 / 反馈统计 / 用户类型分布

### 设计
- 深浅双主题切换
- PWA 可安装到桌面
- 极简设计，无 emoji，纯 CSS 图标

---

## 架构：零服务器

```
用户浏览器
   │
   ▼
Cloudflare Pages (免费)         ← 托管全部静态文件 + API
   ├── /           主站
   ├── /heatmap    热力图展示
   ├── /admin      后台
   └── functions/api/*   ← Pages Functions 处理所有后端逻辑
        │
        ├── D1 (免费)    ← SQLite 兼容数据库
        ├── KV (免费)    ← 验证码/登录Token
        └── [可选] 邮件中继 → VPS → SMTP
```

### 免费额度（Cloudflare 免费套餐）

| 资源 | 免费额度 | 说明 |
|------|---------|------|
| Pages | 无限请求/月 | 静态 + Functions |
| D1 | 500 万行读 / 10 万行写/天 | 足够个人项目 |
| KV | 10 万读 / 1000 写/天 | 验证码/Token 用 |
| Functions 请求 | 10 万次/天 | 远超个人使用 |

**真正意义上的免服务器**：不需要任何 VPS、不需要备案、不需要域名（可选）。

---

## 部署教程

### 前置准备
1. [注册 Cloudflare](https://dash.cloudflare.com)（免费）
2. 安装 [Node.js](https://nodejs.org)（>= 18）
3. （可选）[DeepSeek API Key](https://platform.deepseek.com) 用于 AI 生成举报书

### 第一步：安装 wrangler

```bash
npm install -g wrangler
```

### 第二步：登录 Cloudflare

```bash
wrangler login
# 浏览器弹出授权窗口，允许即可
```

### 第三步：创建 D1 数据库

```bash
wrangler d1 create jiubao-db
```

记录输出的 `database_id`，填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "jiubao-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← 你刚创建的
```

### 第四步：创建 KV 命名空间

```bash
wrangler kv namespace create jiubao-kv
```

同样把输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 第五步：初始化数据库表

```bash
wrangler d1 execute jiubao-db --file=cf-migration.sql --remote
```

### 第六步：配置环境变量

编辑 `wrangler.toml` 的 `[vars]` 部分：

```toml
[vars]
ADMIN_EMAIL = "你的管理员邮箱@example.com"     # 后台登录邮箱
ADMIN_PASSWORD = "你的后台密码"                # 后台登录密码
AI_API_KEY = "sk-你的deepseek密钥"             # AI 生成用
AI_MODEL = "deepseek-chat"
RELAY_TOKEN = "一个随机长字符串"               # 邮件中继鉴权（可选）
```

> **注意**：`AI_API_KEY`、`ADMIN_PASSWORD` 等敏感值也可以放到 Cloudflare Dashboard → Pages 项目 → Settings → Environment variables 中（推荐，不进 git）。

### 第七步：部署

```bash
wrangler pages deploy public --project-name=你的项目名
```

完成后你会得到类似 `https://xxx.pages.dev` 的地址。

### 第八步：日常更新

```bash
wrangler pages deploy public --project-name=你的项目名
```

---

## 可选：免费邮件验证码（SMTP 中继）

Cloudflare Functions 不支持 Node.js `net` 模块，无法直接用 nodemailer 发邮件。解决方案：

1. 找一个任意 VPS（最便宜几块钱/月）
2. 把 `smtp-reference/` 目录放上去，改配置后运行：

```bash
cd smtp-reference
npm install
node relay-server.js
```

3. 在 VPS 上配 nginx 反向代理（参考 `smtp-reference/nginx-location.conf`）
4. Cloudflare 端通过 `https://你的域名/mail-relay/send` 调用

**没有 VPS 也能用**：验证码会直接显示在页面上（`/api/admin/send-code` 的响应里）。

---

## AI 生成举报书

1. 申请 [DeepSeek API Key](https://platform.deepseek.com)（新用户有免费额度）
2. 填入 `AI_API_KEY`
3. 后台选择"AI 生成"模式，输入问题描述，AI 会按规范格式生成举报书

系统 Prompt 内置了：
- 法言法语、规范结构（标题/受理机构/事实/证据/诉求）
- 举报策略（拉高层级、引用《信访工作条例》）
- 证据要求（录屏完整性、区块链存证、录音原始载体）

---

## 数据安全

- 后台登录：邮箱 + 密码 + 计算题 + 邮箱验证码（多因素）
- IP 限流：热力图提交每个 IP 每天 10 次
- 审计日志：`admin_logins` 表记录每次登录尝试
- 数据备份：`backup-d1.js` 可导出全部数据到 GitHub 私有仓库

---

## 项目结构

```
├── public/                  # 静态文件
│   ├── index.html           # 主站（7 步流程）
│   ├── heatmap/index.html   # 热力图展示页
│   ├── admin/index.html     # 后台管理
│   ├── lib/echarts.min.js   # ECharts（本地化，无需 CDN）
│   ├── china-geo.json       # 中国地图 GeoJSON
│   └── manifest.json        # PWA 配置
├── functions/
│   └── api/[[route]].js     # 全部 API（Cloudflare Pages Functions）
├── cf-migration.sql         # D1 数据库迁移
├── wrangler.toml            # Cloudflare 配置
├── smtp-reference/          # 可选：邮件中继参考实现
└── backup-d1.js             # 数据备份脚本
```

---

## 免责声明

本工具仅提供信息整合与写作辅助，不构成法律意见。举报请依法依规进行，注意保护自身安全。

---

## 开源协议

MIT License

---

## 支持

- 本项目完全免费
- 有问题欢迎提 [Issue](https://github.com/your-name/jiubao/issues)
- 你的 Star 是最大的鼓励
