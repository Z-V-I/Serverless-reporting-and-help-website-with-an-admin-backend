const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// QQ邮箱 SMTP
const transporter = nodemailer.createTransport({
  service: 'qq',
  auth: { user: 'your-sender-email@qq.com', pass: 'your-smtp-auth-code' }
});

// 验证码存储（内存，5分钟过期）
const verifyCodes = new Map();

// 生成简单数学题
function genCaptcha() {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  return { question: a + ' + ' + b + ' = ?', answer: a + b };
}

// 发送验证码邮件
async function sendVerifyCode(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  verifyCodes.set(email, { code, time: Date.now() });

  await transporter.sendMail({
    from: '"教你举报" <your-sender-email@qq.com>',
    to: email,
    subject: '后台登录验证码',
    text: '你的验证码是：' + code + '\n有效期 5 分钟。如非本人操作请忽略。'
  });

  return true;
}

// 验证码校验
function checkVerifyCode(email, code) {
  const record = verifyCodes.get(email);
  if (!record) return false;
  if (Date.now() - record.time > 300000) { verifyCodes.delete(email); return false; }
  return record.code === code;
}

// 登录Token
function genToken() { return crypto.randomBytes(32).toString('hex'); }
const adminTokens = new Map();

// 中间件
router.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/send-code' || req.path === '/captcha') return next();
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: '未授权' });
  next();
});

// 获取计算题
router.get('/captcha', (req, res) => {
  const c = genCaptcha();
  res.json({ question: c.question, hash: crypto.createHash('md5').update(String(c.answer)).digest('hex') });
});

// 发送验证码（先验证邮箱+密码+计算题）
router.post('/send-code', async (req, res) => {
  const { email, password, captchaAnswer, captchaHash } = req.body;
  if (!email || !password || captchaAnswer == null || !captchaHash) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  // 验证邮箱和密码
  if (email !== process.env.ADMIN_EMAIL) return res.status(400).json({ error: '邮箱错误' });
  if (password !== process.env.ADMIN_PASSWORD) return res.status(400).json({ error: '密码错误' });

  // 验证计算题
  const hash = crypto.createHash('md5').update(String(parseInt(captchaAnswer))).digest('hex');
  if (hash !== captchaHash) return res.status(400).json({ error: '计算题答案错误，请重新计算' });

  try {
    await sendVerifyCode(email);
    res.json({ success: true, msg: '验证码已发送到 ' + email });
  } catch (e) {
    // 邮件发送失败，返回本地验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    verifyCodes.set(email, { code, time: Date.now() });
    res.json({ success: true, localCode: code, msg: '邮件发送失败（SMTP不可用），本地验证码：' + code + '，有效期5分钟' });
  }
});

// 登录（验证码校验）
router.post('/login', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: '请输入邮箱和验证码' });
  if (email !== process.env.ADMIN_EMAIL) return res.status(400).json({ error: '邮箱错误' });
  if (!checkVerifyCode(email, code)) return res.status(400).json({ error: '验证码错误或已过期' });

  verifyCodes.delete(email);
  const token = genToken();
  adminTokens.set(token, Date.now());
  res.json({ token, success: true });
});

// ========== 总统计 ==========
router.get('/stats', (req, res) => {
  const totalVisits = db.get('SELECT COUNT(*) as count FROM users').count;
  const totalUsers = db.get("SELECT COUNT(*) as count FROM users WHERE user_type='new'").count;
  const totalReports = db.get('SELECT COUNT(*) as count FROM heatmap_data').count;
  const totalAiUsage = db.get('SELECT COUNT(*) as count FROM ai_usage').count;
  const aiUsers = db.get('SELECT COUNT(DISTINCT session_id) as count FROM ai_usage').count;
  const totalCompletions = db.get('SELECT COUNT(*) as count FROM completions').count;
  const todayVisits = db.get("SELECT COUNT(*) as count FROM users WHERE date(created_at)=date('now')").count;
  const totalFeedback = db.get('SELECT COUNT(*) as count FROM feedback').count;
  const totalLocations = db.get('SELECT COUNT(DISTINCT province || city || district) as count FROM heatmap_data').count;
  const heatmapUsers = db.get('SELECT COUNT(DISTINCT session_id) as count FROM heatmap_data').count;

  res.json({ totalVisits, totalUsers, totalReports, totalAiUsage, aiUsers, totalCompletions, todayVisits, totalFeedback, totalLocations, heatmapUsers });
});

router.get('/user-type-stats', (req, res) => {
  const rows = db.query('SELECT user_type, COUNT(*) as count FROM users GROUP BY user_type');
  const newUsers = rows.find(r => r.user_type === 'new')?.count || 0;
  const returning = rows.find(r => r.user_type === 'returning')?.count || 0;
  res.json({ new: newUsers, returning, total: newUsers + returning });
});

router.get('/mode-stats', (req, res) => {
  const rows = db.query('SELECT mode, COUNT(*) as count FROM mode_selections GROUP BY mode');
  const guided = rows.find(r => r.mode === 'guided')?.count || 0;
  const free = rows.find(r => r.mode === 'free')?.count || 0;
  res.json({ guided, free, total: guided + free });
});

router.get('/visit-trend', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const rows = db.query(`SELECT visit_date as date, COUNT(*) as count FROM visits WHERE visit_date >= date('now', ?) GROUP BY visit_date ORDER BY visit_date ASC`, [`-${days} days`]);
  res.json(rows);
});

router.get('/visit-heatmap', (req, res) => {
  const rows = db.query(`SELECT visit_date as date, COUNT(*) as count FROM visits WHERE visit_date >= date('now', '-365 days') GROUP BY visit_date ORDER BY visit_date ASC`);
  res.json(rows);
});

router.get('/hour-distribution', (req, res) => {
  const rows = db.query(`SELECT CAST(strftime('%H', visit_time) AS INTEGER) as hour, COUNT(*) as count FROM visits GROUP BY hour ORDER BY hour`);
  res.json(rows);
});

router.get('/report-type-ratio', (req, res) => {
  const education = db.get("SELECT COUNT(*) as count FROM heatmap_data WHERE report_type='education'").count;
  const municipal = db.get("SELECT COUNT(*) as count FROM heatmap_data WHERE report_type='municipal'").count;
  res.json({ education, municipal });
});

router.get('/feedback-stats', (req, res) => {
  const yes = db.get("SELECT COUNT(*) as count FROM feedback WHERE helpful='yes'").count;
  const no = db.get("SELECT COUNT(*) as count FROM feedback WHERE helpful='no'").count;
  res.json({ yes, no, total: yes + no });
});

router.get('/ai-trend', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const rows = db.query(`SELECT date(created_at) as date, COUNT(*) as count, COUNT(DISTINCT session_id) as users FROM ai_usage WHERE created_at >= datetime('now', ?) GROUP BY date(created_at) ORDER BY date ASC`, [`-${days} days`]);
  res.json(rows);
});

router.get('/heatmap-trend', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const rows = db.query(`SELECT date(created_at) as date, COUNT(*) as count, COUNT(DISTINCT session_id) as users FROM heatmap_data WHERE created_at >= datetime('now', ?) GROUP BY date(created_at) ORDER BY date ASC`, [`-${days} days`]);
  res.json(rows);
});

router.get('/reports', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const { type, province, city, start_date, end_date } = req.query;
  const offset = (page - 1) * limit;
  let where = [], params = [];
  if (type) { where.push('report_type=?'); params.push(type); }
  if (province) { where.push('province=?'); params.push(province); }
  if (city) { where.push('city=?'); params.push(city); }
  if (start_date) { where.push("created_at>=?"); params.push(start_date); }
  if (end_date) { where.push("created_at<=?"); params.push(end_date + ' 23:59:59'); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) as count FROM heatmap_data ${wc}`, params).count;
  const data = db.query(`SELECT * FROM heatmap_data ${wc} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

module.exports = router;