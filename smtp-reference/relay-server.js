/**
 * 邮件中继服务 — 独立运行，无框架依赖
 * 给 Cloudflare Workers/Pages Functions 发 API 调用来发邮件
 *
 * 安装：cd smtp-reference && npm install
 * 启动：node relay-server.js
 * PM2：npm run pm2
 */

const express = require('express');
const nodemailer = require('nodemailer');

// ===== 配置（建议通过环境变量覆写） =====
const PORT = process.env.RELAY_PORT || 3457;
const RELAY_TOKEN = process.env.RELAY_TOKEN || '替换成你的中继密钥';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = process.env.SMTP_PORT || 465;
const SMTP_USER = process.env.SMTP_USER || 'your-email@qq.com';
const SMTP_PASS = process.env.SMTP_PASS || '你的SMTP授权码';
const FROM_NAME = process.env.FROM_NAME || '你的产品名';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

// ===== SMTP 传输器 =====
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT),
  secure: SMTP_PORT === '465',
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// ===== Express 服务 =====
const app = express();
app.use(express.json({ limit: '64kb' }));

// 鉴权中间件
app.use((req, res, next) => {
  if (req.headers['x-relay-token'] !== RELAY_TOKEN) {
    return res.status(401).json({ error: '未授权' });
  }
  next();
});

// 发送验证码 / 通知邮件
app.post('/send', async (req, res) => {
  const { to, code, subject, text } = req.body;
  if (!to || !code) {
    return res.status(400).json({ error: '缺少必填参数: to, code' });
  }

  try {
    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: subject || '验证码',
      text: text || `你的验证码是：${code}\n有效期 5 分钟。如非本人操作请忽略。`
    });
    console.log('[OK]', to, code, info.messageId);
    res.json({ success: true, messageId: info.messageId });
  } catch (e) {
    console.error('[FAIL]', to, e.message);
    res.status(502).json({ error: e.message });
  }
});

// 健康检查
app.get('/ping', (req, res) => res.json({ pong: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log('Mail relay running on port ' + PORT);
  console.log('SMTP:', SMTP_HOST + ':' + SMTP_PORT);
});
