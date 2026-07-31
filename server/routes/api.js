const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');

function genSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

router.use(async (req, res, next) => {
  try { await db.getDb(); next(); }
  catch (e) { res.status(500).json({ error: '数据库初始化失败' }); }
});

// ========== 通用接口 ==========
router.post('/visit', (req, res) => {
  const { session_id, page, referrer, user_agent } = req.body;
  const sid = session_id || genSessionId();
  db.query('INSERT INTO visits (session_id, page, referrer, user_agent) VALUES (?, ?, ?, ?)', [sid, page || '/', referrer || '', user_agent || '']);
  res.json({ session_id: sid });
});

router.post('/user-type', (req, res) => {
  const { session_id, user_type } = req.body;
  if (!session_id || !user_type) return res.status(400).json({ error: '参数不完整' });
  db.query('DELETE FROM users WHERE session_id = ?', [session_id]);
  db.query('INSERT INTO users (session_id, user_type) VALUES (?, ?)', [session_id, user_type]);
  res.json({ success: true });
});

router.post('/mode-select', (req, res) => {
  const { session_id, mode } = req.body;
  if (!session_id || !mode) return res.status(400).json({ error: '参数不完整' });
  db.query('INSERT INTO mode_selections (session_id, mode) VALUES (?, ?)', [session_id, mode]);
  res.json({ success: true });
});

// ========== 热力地图提交（IP限流: 每个IP每天10次） ==========
const ipCounter = new Map(); // 内存计数器: ip_date -> count

router.post('/heatmap', (req, res) => {
  // 获取IP
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || 'unknown';
  const today = new Date().toISOString().slice(0,10);
  const key = ip + '_' + today;
  const count = (ipCounter.get(key) || 0) + 1;
  if (count > 10) return res.status(429).json({ error: '今日提交次数已达上限(10次)，请明天再试' });
  ipCounter.set(key, count);

  // 同时也从数据库检查该IP今天提交数
  const dbCount = db.get("SELECT COUNT(*) as c FROM heatmap_data WHERE ip=? AND date(created_at)=date('now')", [ip]).c;
  if (dbCount >= 10) return res.status(429).json({ error: '今日提交次数已达上限(10次)' });

  const { session_id, report_type, province, city, district, description } = req.body;
  if (!session_id || !report_type || !province || !city || !district || !description) {
    return res.status(400).json({ error: '请完整填写所有字段' });
  }
  if (description.length > 200) return res.status(400).json({ error: '问题描述不超过200字' });

  db.query('INSERT INTO heatmap_data (session_id, report_type, province, city, district, description, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [session_id, report_type, province, city, district, description, ip]);
  res.json({ success: true });
});

// ========== 公开访问接口（热力地图展示页使用） ==========
// 总统计数据
router.get('/public/stats', (req, res) => {
  const totalReports = db.get('SELECT COUNT(*) as count FROM heatmap_data').count;
  const totalUsers = db.get('SELECT COUNT(DISTINCT session_id) as count FROM heatmap_data').count;
  const totalLocations = db.get('SELECT COUNT(DISTINCT province || city || district) as count FROM heatmap_data').count;
  const education = db.get("SELECT COUNT(*) as count FROM heatmap_data WHERE report_type='education'").count;
  const municipal = db.get("SELECT COUNT(*) as count FROM heatmap_data WHERE report_type='municipal'").count;
  res.json({ totalReports, totalUsers, totalLocations, education, municipal });
});

// 排行榜（按 省+市+区 统计）
router.get('/public/rank', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const rows = db.query(`
    SELECT province, city, district, COUNT(*) as count
    FROM heatmap_data
    GROUP BY province, city, district
    ORDER BY count DESC
    LIMIT ?
  `, [limit]);
  res.json(rows);
});

// 地图点数据：按 省+市 聚合，用于在地图上显示标记
router.get('/public/points', (req, res) => {
  const rows = db.query(`
    SELECT province, city, report_type, COUNT(*) as count
    FROM heatmap_data
    GROUP BY province, city, report_type
    ORDER BY count DESC
  `);
  res.json(rows);
});

// 列表数据：分页 + 筛选
router.get('/public/list', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const { type, province, city, district, start_date, end_date, keyword } = req.query;
  const offset = (page - 1) * limit;
  let where = [];
  let params = [];
  if (type) { where.push('report_type=?'); params.push(type); }
  if (province) { where.push('province=?'); params.push(province); }
  if (city) { where.push('city=?'); params.push(city); }
  if (district) { where.push('district=?'); params.push(district); }
  if (start_date) { where.push("created_at>=?"); params.push(start_date); }
  if (end_date) { where.push("created_at<=?"); params.push(end_date + ' 23:59:59'); }
  if (keyword) { where.push('description LIKE ?'); params.push('%' + keyword + '%'); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) as count FROM heatmap_data ${whereClause}`, params).count;
  const data = db.query(
    `SELECT id, report_type, province, city, district, description, created_at
     FROM heatmap_data ${whereClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

// 地图筛选的省/市/区列表
router.get('/public/provinces', (req, res) => {
  res.json(db.query(`SELECT DISTINCT province FROM heatmap_data ORDER BY province`));
});

router.get('/public/cities', (req, res) => {
  const { province } = req.query;
  if (!province) return res.json([]);
  res.json(db.query(`SELECT DISTINCT city FROM heatmap_data WHERE province=? ORDER BY city`, [province]));
});

// ========== AI 生成（API Key 完全在后端） ==========
router.post('/ai-generate', async (req, res) => {
  const { session_id, prompt, user_type } = req.body;
  if (!session_id || !prompt) return res.status(400).json({ error: '参数不完整' });
  db.query('INSERT INTO ai_usage (session_id, user_type) VALUES (?, ?)', [session_id, user_type || '']);

  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'deepseek-chat';

  if (!apiKey || apiKey === 'your_api_key_here') {
    return res.json({
      content: `尊敬的上级纪检监察机关/教育主管部门：\n\n关于 "${prompt}" 一事，现依法依规向贵单位进行实名检举控告。\n\n一、被举报人基本情况\n（请填写被举报人姓名、单位及职务）\n\n二、主要违法违纪事实\n1. （请在此详细描述具体违规行为，包括时间、地点、人物、经过）\n2. （请列举相关证据，如微信聊天记录、转账凭证、录音录像等）\n\n三、举报诉求\n恳请上级机关依据相关规定，启动提级办理与挂牌督办程序，彻查上述违法违纪行为，维护公平正义。\n\n四、证据清单\n1. 微信聊天记录录屏文件\n2. 转账记录截图\n3. 现场录音文件\n\n举报人：（您的姓名或匿名）\n联系电话：（您的联系方式）\n日期：${new Date().toLocaleDateString('zh-CN')}\n\n（温馨提示：以上为AI生成的举报信模板，请根据实际情况修改完善后使用。）`
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0.7, max_tokens: 2000,
        messages: [
          { role: 'system', content: `你是一名资深纪检监察举报信撰写专家，精通中国法律法规和举报实务。你的任务是根据用户提供的证据或描述，生成一份正式、规范、可直接提交的检举控告书。

【核心原则】
- 使用法言法语，严肃客观，不掺杂个人情绪
- 拉高举报层级：倾向引用省级/国家级纪检监察部门的受理口径
- 结构完整，逻辑清晰
- 证据导向：所有指控必须附具体证据说明

【格式要求】
一、标题：[被举报人姓名/单位]涉嫌[违法违纪类型]的检举控告
二、呈送受理机构：[建议的省级纪委监委/省教育厅纪检监察组]
三、被举报人基本信息（姓名、单位、职务、政治面貌及职级）
四、违法违纪事实（按时间线详细描述，包含时间、地点、人物、金额、经过）
五、证据清单（逐条列出证据类型、内容摘要、获取方式、是否已上链存证）
六、核心诉求（引用《信访工作条例》《纪检监察机关处理检举控告工作规则》等法规，恳请启动提级办理、挂牌督办程序）

【关键提示】
- 属地举报易被推诿，材料中应明确要求上级机关介入
- 电子证据必须注明录屏完整性（从第一条记录开始、展示对方个人信息页等）
- 如有区块链存证，注明哈希值和存证平台
- 录音证据须注明"未剪辑、原始载体保存"
- 提醒举报人注意打印机暗记、网络隔离、身份保护等安全事项

只输出举报信正文，不输出解释、说明或额外内容。` },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '生成失败，请重试';
    res.json({ content });
  } catch (err) {
    console.error('AI生成失败:', err.message);
    res.json({ content: `关于 "${prompt}" 一事\n\n（AI服务暂时不可用，请参考网站模板手动撰写）` });
  }
});

// ========== 文本混淆 ==========
router.post('/text-obfuscate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: '请提供文本' });

  async function translate(q, sl, tl) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q.slice(0,500))}&langpair=${sl}|${tl}`, { signal: c.signal });
      clearTimeout(t);
      if (r.ok) { const d = await r.json(); if (d.responseData?.translatedText) return d.responseData.translatedText; }
    } catch(e) {}
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch('https://libretranslate.de/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, source: sl, target: tl }),
        signal: c.signal
      });
      clearTimeout(t);
      if (r.ok) { const d = await r.json(); if (d.translatedText) return d.translatedText; }
    } catch(e) {}
    return null;
  }

  try {
    const enText = await translate(text, 'zh-CN', 'en');
    if (!enText) { res.json({ original: text, obfuscated: text }); return; }
    const result = await translate(enText, 'en', 'zh-CN');
    res.json({ original: text, obfuscated: result || text });
  } catch (err) {
    res.json({ original: text, obfuscated: text });
  }
});

router.post('/complete', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: '参数不完整' });
  db.query('INSERT INTO completions (session_id) VALUES (?)', [session_id]);
  res.json({ success: true });
});

router.post('/feedback', (req, res) => {
  const { session_id, helpful } = req.body;
  if (!session_id || !helpful) return res.status(400).json({ error: '参数不完整' });
  db.query('INSERT INTO feedback (session_id, helpful) VALUES (?, ?)', [session_id, helpful]);
  res.json({ success: true });
});

module.exports = router;