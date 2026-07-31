# SMTP 邮件中继方案参考

## 架构

```
CF Pages/Workers → HTTPS → nginx(reverse proxy) → Node.js(nodemailer) → SMTP → 邮箱
```

## 适用场景

- 服务部署在 Cloudflare Workers/Pages（无 `net` 模块，无法直接用 nodemailer）
- 需要一个 VPS 跑一个纯 HTTP 的邮件中继
- 中继不暴露在公网（通过 nginx 代理 + token 鉴权）

## 文件说明

| 文件 | 说明 |
|------|------|
| `relay-server.js` | 中继服务器主程序（Express + nodemailer） |
| `package.json` | 依赖配置 |
| `cf-caller.js` | Cloudflare 端调用示例（适配 CF Workers/Pages Functions） |
| `nginx-location.conf` | Nginx 反向代理配置片段 |

## 部署步骤

### 1. 中继服务器（VPS）

```bash
# 安装依赖
cd relay-server
npm install

# 启动（裸机）
node relay-server.js

# 保活（PM2）
pm2 start relay-server.js --name mail-relay
pm2 startup && pm2 save
```

### 2. Nginx 反向代理

把 `nginx-location.conf` 追加到你的站点配置的 `server` 块中：

```
server {
    listen 80;
    server_name your-domain.com;
    ...
    include /path/to/nginx-location.conf;
}
```

### 3. Cloudflare 端

从 `cf-caller.js` 中参考调用方式，在 CF Functions 中：

```js
await fetch('https://your-domain.com/mail-relay/send', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-relay-token': 'your-secret-token'
    },
    body: JSON.stringify({ to: 'user@example.com', code: '123456' })
});
```

## 安全

- 中继通过 `x-relay-token` 头鉴权（请求中携带）
- nginx 隐藏中继真实端口，只暴露 `/mail-relay/` 路径
- SMTP 授权码和 relay token 建议通过环境变量传入，不硬编码
