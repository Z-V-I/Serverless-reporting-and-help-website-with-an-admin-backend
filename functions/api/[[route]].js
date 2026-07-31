export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  const kv = env.KV;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,x-admin-token' } });
  }

  if (!db) return r({ error: 'DB未绑定' }, 200, cors);

  try {
    let result = null;

    // ========== 公开接口 ==========
    if (path === '/api/public/stats') {
      const tr = (await db.prepare('SELECT COUNT(*) as c FROM heatmap_data').first()).c;
      const tu = (await db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM heatmap_data').first()).c;
      const tl = (await db.prepare('SELECT COUNT(DISTINCT province||city||district) as c FROM heatmap_data').first()).c;
      const re = (await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE report_type='education'").first()).c;
      const rm = (await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE report_type='municipal'").first()).c;
      result = { totalReports:tr, totalUsers:tu, totalLocations:tl, reportEdu:re, reportMun:rm };
    }
    else if (path === '/api/public/points') {
      const { results } = await db.prepare('SELECT city, province, report_type, COUNT(*) as count FROM heatmap_data GROUP BY city ORDER BY count DESC').all();
      result = results;
    }
    else if (path === '/api/public/rank') {
      const { results } = await db.prepare('SELECT h.province, h.city, h.district, h.report_type, r.cnt as count FROM heatmap_data h INNER JOIN (SELECT city, COUNT(*) as cnt FROM heatmap_data GROUP BY city ORDER BY cnt DESC LIMIT 10) r ON h.city=r.city GROUP BY h.city ORDER BY r.cnt DESC').all();
      result = results;
    }
    else if (path === '/api/public/list') {
      const params = [];
      let where = 'WHERE 1=1';
      const t = url.searchParams.get('type'); if (t) { where += ' AND report_type=?'; params.push(t); }
      const p = url.searchParams.get('province'); if (p) { where += ' AND province=?'; params.push(p); }
      const c = url.searchParams.get('city'); if (c) { where += ' AND city=?'; params.push(c); }
      const df = url.searchParams.get('dateFrom'); if (df) { where += ' AND date(created_at)>=?'; params.push(df); }
      const dt = url.searchParams.get('dateTo'); if (dt) { where += ' AND date(created_at)<=?'; params.push(dt); }
      const page = parseInt(url.searchParams.get('page')||'1'), limit=20, offset=(page-1)*limit;
      const { results:data } = await db.prepare('SELECT * FROM heatmap_data ' + where + ' ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset).bind(...params).all();
      const totalRow = await db.prepare('SELECT COUNT(*) as total FROM heatmap_data ' + where).bind(...params).first();
      result = { data, total: totalRow.total, page, limit };
    }

    // ========== 热力图提交 ==========
    else if (path === '/api/heatmap' && method === 'POST') {
      const { session_id, report_type, province, city, district, description } = await request.json();
      if (!session_id||!report_type||!province||!city||!district||!description) return r({ error:'请完整填写' }, 400, cors);
      if (description.length > 200) return r({ error:'描述不超过200字' }, 400, cors);
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const cnt = await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE ip=?1 AND date(created_at)=date('now','+8 hours')").bind(ip).first();
      if (cnt.c >= 10) return r({ error:'今日提交已达上限(10次)' }, 429, cors);
      await db.prepare("INSERT INTO heatmap_data(session_id,report_type,province,city,district,description,ip,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,datetime('now','+8 hours'))")
        .bind(session_id,report_type,province,city,district,description,ip).run();
      result = { success: true };
    }

    // ========== 基础操作 ==========
    else if (path === '/api/visit' && method === 'POST') {
      const { session_id, page:pg, referrer, user_agent } = await request.json();
      await db.prepare("INSERT INTO visits(session_id,page,referrer,user_agent,visit_time,visit_date) VALUES(?1,?2,?3,?4,datetime('now','+8 hours'),date('now','+8 hours'))").bind(session_id||'',pg||'/',referrer||'',user_agent||'').run();
      result = { success: true };
    }
    else if (path === '/api/user-type' && method === 'POST') {
      const { session_id, user_type } = await request.json();
      await db.prepare("INSERT OR REPLACE INTO users(session_id,user_type,created_at) VALUES(?1,?2,datetime('now','+8 hours'))").bind(session_id,user_type).run();
      result = { success: true };
    }
    else if (path === '/api/mode' && method === 'POST') {
      const { session_id, mode } = await request.json();
      await db.prepare("INSERT INTO mode_selections(session_id,mode,created_at) VALUES(?1,?2,datetime('now','+8 hours'))").bind(session_id,mode).run();
      result = { success: true };
    }
    else if (path === '/api/feedback' && method === 'POST') {
      const { session_id, helpful } = await request.json();
      await db.prepare("INSERT INTO feedback(session_id,helpful,created_at) VALUES(?1,?2,datetime('now','+8 hours'))").bind(session_id,helpful).run();
      result = { success: true };
    }
    else if (path === '/api/complete' && method === 'POST') {
      const { session_id } = await request.json();
      await db.prepare("INSERT INTO completions(session_id,completed_at) VALUES(?1,datetime('now','+8 hours'))").bind(session_id).run();
      result = { success: true };
    }

    // ========== AI 生成 ==========
    else if (path === '/api/ai-generate' && method === 'POST') {
      const { session_id, prompt, user_type } = await request.json();
      await db.prepare("INSERT INTO ai_usage(session_id,user_type,created_at) VALUES(?1,?2,datetime('now','+8 hours'))").bind(session_id,user_type||'').run();
      try {
        const ai = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer ' + (env.AI_API_KEY || 'your-deepseek-api-key')},
          body: JSON.stringify({
            model:'deepseek-chat',
            messages:[
              {role:'system',content:'你是资深纪检监察举报信撰写专家...'},
              {role:'user',content:prompt}
            ],temperature:0.7,max_tokens:2000
          })
        });
        const d = await ai.json();
        result = { content: d.choices?.[0]?.message?.content || 'AI生成失败' };
      } catch(e) { result = { content: 'AI服务暂不可用' }; }
    }

    // ========== 文本混淆（三重翻译API备份） ==========
    else if (path === '/api/text-obfuscate' && method === 'POST') {
      const { text } = await request.json();
      const en = await tryTranslate(text, 'zh', 'en');
      if (en) {
        const back = await tryTranslate(en, 'en', 'zh');
        if (back && back !== text) { result = { original:text, obfuscated:back }; }
        else { result = { original:text, obfuscated:scrambleText(text) }; }
      } else {
        result = { original:text, obfuscated:scrambleText(text) };
      }
    }

    // ========== 后台 ==========
    else if (path === '/api/admin/captcha') {
      const a = Math.floor(Math.random()*20)+1, b = Math.floor(Math.random()*20)+1;
      const ans = a+b;
      result = { question:a+' + '+b+' = ?', hash: await sha256(String(ans)) };
    }
    else if (path === '/api/admin/send-code' && method === 'POST') {
      const adminEmail = env.ADMIN_EMAIL || 'your-admin-email@example.com';
      const adminPwd = env.ADMIN_PASSWORD || 'your-admin-password';
      const relayToken = env.RELAY_TOKEN || 'your-relay-secret-token';
      const { email, password, captchaAnswer, captchaHash } = await request.json();
      if (!email||!password||captchaAnswer==null||!captchaHash) return r({ error:'请完整填写' }, 400, cors);
      if (email !== adminEmail) return r({ error:'邮箱错误' }, 400, cors);
      if (password !== adminPwd) return r({ error:'密码错误' }, 400, cors);
      if ((await sha256(String(parseInt(captchaAnswer)))) !== captchaHash) return r({ error:'计算题错误' }, 400, cors);
      const code = String(Math.floor(100000+Math.random()*900000));
      await kv.put('code:'+email, code, { expirationTtl: 300 });
      try {
        await fetch('https://your-domain.com/mail-relay/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-relay-token': relayToken },
          body: JSON.stringify({ to: email, code })
        });
      } catch(e) { console.error('Relay error:', e.message); }
      result = { success:true, code };
    }
    else if (path === '/api/admin/login' && method === 'POST') {
      const { email, code } = await request.json();
      const ip = request.headers.get('cf-connecting-ip') || '';
      const ua = request.headers.get('user-agent') || '';
      const stored = await kv.get('code:'+email);
      if (!stored || stored !== code) {
        try { await db.prepare('INSERT INTO admin_logins(email,ip,user_agent,success) VALUES(?1,?2,?3,0)').bind(email,ip,ua).run(); } catch(e) {}
        return r({ error:'验证码错误' }, 400, cors);
      }
      const token = crypto.randomUUID();
      await kv.put('token:'+token, '1', { expirationTtl: 86400 });
      try { await db.prepare('INSERT INTO admin_logins(email,ip,user_agent,success) VALUES(?1,?2,?3,1)').bind(email,ip,ua).run(); } catch(e) {}
      result = { token };
    }

    // ========== 后台统计（需鉴权） ==========
    else if (path.startsWith('/api/admin/') && path !== '/api/admin/captcha' && path !== '/api/admin/send-code' && path !== '/api/admin/login') {
      const token = request.headers.get('x-admin-token');
      if (!token) return r({ error:'未授权' }, 403, cors);
      const valid = await kv.get('token:'+token);
      if (!valid) return r({ error:'未授权' }, 403, cors);

      if (path === '/api/admin/stats') {
        const tv = (await db.prepare('SELECT COUNT(*) as c FROM users').first()).c;
        const tu = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE user_type='new'").first()).c;
        const tr = (await db.prepare('SELECT COUNT(*) as c FROM heatmap_data').first()).c;
        const ai = (await db.prepare('SELECT COUNT(*) as c FROM ai_usage').first()).c;
        const au = (await db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM ai_usage').first()).c;
        const td = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now','+8 hours')").first()).c;
        const fb = (await db.prepare('SELECT COUNT(*) as c FROM feedback').first()).c;
        const lo = (await db.prepare('SELECT COUNT(DISTINCT province||city||district) as c FROM heatmap_data').first()).c;
        const hu = (await db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM heatmap_data').first()).c;
        result = { totalVisits:tv, totalUsers:tu, totalReports:tr, totalAiUsage:ai, aiUsers:au, todayVisits:td,
          totalFeedback:fb, totalLocations:lo, heatmapUsers:hu };
      }
      else if (path === '/api/admin/reports') {
        const page = parseInt(url.searchParams.get('page')||'1'), limit=20, offset=(page-1)*limit;
        const { results:data } = await db.prepare('SELECT * FROM heatmap_data ORDER BY created_at DESC LIMIT ?1 OFFSET ?2').bind(limit,offset).all();
        const total = (await db.prepare('SELECT COUNT(*) as c FROM heatmap_data').first()).c;
        result = { data, total, page, limit };
      }
      else if (path === '/api/admin/visit-trend' || path === '/api/admin/ai-trend' || path === '/api/admin/heatmap-trend') {
        const table = path.includes('ai')?'ai_usage':path.includes('heatmap')?'heatmap_data':'users';
        const col = path.includes('heatmap')?'created_at':path.includes('ai')?'created_at':'created_at';
        const { results } = await db.prepare(
          "WITH RECURSIVE dates(d) AS (SELECT date('now','-30 days') UNION ALL SELECT date(d,'+1 day') FROM dates WHERE d<date('now')) SELECT d as date, COALESCE((SELECT COUNT(*) FROM " + table + " WHERE date(" + col + ")=d),0) as count FROM dates"
        ).all();
        result = results;
      }
      else if (path === '/api/admin/visit-heatmap') {
        const { results } = await db.prepare(
          "WITH RECURSIVE dates(d) AS (SELECT date('now','-365 days') UNION ALL SELECT date(d,'+1 day') FROM dates WHERE d<date('now')) SELECT d as date, COALESCE((SELECT COUNT(*) FROM users WHERE date(created_at)=d),0) as count FROM dates"
        ).all();
        result = results;
      }
      else if (path === '/api/admin/hour-distribution') {
        const { results } = await db.prepare("SELECT CAST(strftime('%H',created_at) AS INTEGER) as hour, COUNT(*) as count FROM users GROUP BY hour ORDER BY hour").all();
        result = results;
      }
      else if (path === '/api/admin/report-type-ratio') {
        const rows = await db.prepare('SELECT report_type, COUNT(*) as count FROM heatmap_data GROUP BY report_type').all();
        var map = {}; rows.results.forEach(function(r){ map[r.report_type] = r.count; });
        result = { education: map.education || 0, municipal: map.municipal || 0 };
      }
      else if (path === '/api/admin/feedback-stats') {
        const rows = await db.prepare('SELECT helpful, COUNT(*) as count FROM feedback GROUP BY helpful').all();
        var map = {}; rows.results.forEach(function(r){ map[r.helpful] = r.count; });
        result = { yes: map.yes || 0, no: map.no || 0 };
      }
      else if (path === '/api/admin/user-type-stats') {
        const rows = await db.prepare('SELECT user_type, COUNT(*) as count FROM users GROUP BY user_type').all();
        var map = {}; rows.results.forEach(function(r){ map[r.user_type] = r.count; });
        result = { new: map.new || 0, returning: map.returning || 0 };
      }
      else if (path === '/api/admin/mode-stats') {
        const rows = await db.prepare('SELECT mode, COUNT(*) as count FROM mode_selections GROUP BY mode').all();
        var map = {}; rows.results.forEach(function(r){ map[r.mode] = r.count; });
        result = { guided: map.guided || 0, free: map.free || 0 };
      }
    }

    if (result === null) return r({ error:'not found' }, 404, cors);
    return new Response(JSON.stringify(result), { headers: cors });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function tryTranslate(text, from, to) {
  // API-1: Google Translate
  try {
    const resp = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl='+from+'&tl='+to+'&dt=t&q='+encodeURIComponent(text.slice(0,800)));
    if (resp.ok) { const d = await resp.json(); const r = d[0]?.map(x=>x[0]||'').join(''); if (r && r !== text) return r; }
  } catch(e) {}
  // API-2: MyMemory (250chars/day free)
  try {
    const resp = await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(text.slice(0,200))+'&langpair='+from+'|'+to);
    if (resp.ok) { const d = await resp.json(); if (d.responseData?.translatedText && !d.responseData.translatedText.includes('MYMEMORY')) return d.responseData.translatedText; }
  } catch(e) {}
  // API-3: LibreTranslate (public mirror)
  try {
    const resp = await fetch('https://trans.zillyhuhn.com/translate', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({q:text.slice(0,300),source:from,target:to,format:'text'}) });
    if (resp.ok) { const d = await resp.json(); if (d.translatedText) return d.translatedText; }
  } catch(e) {}
  return null;
}

function scrambleText(text) {
  var result = text;
  // 同义词替换
  var map = {'举报':'检举','检举':'投诉','投诉':'申诉','腐败':'贪腐','勾结':'串通','收受':'获取','威胁':'胁迫','变相':'间接'};
  for (var k in map) { var re = new RegExp(k, 'g'); result = result.replace(re, map[k]); }
  // 句子重排
  var s = result.split(/(?<=[。！？\n])/).filter(Boolean);
  if (s.length >= 3) { var f = s.shift(); for (var i=s.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=s[i];s[i]=s[j];s[j]=t;} result = f + s.join(''); }
  return result || text;
}

function fallbackObfuscate(text) { return scrambleText(text); }

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function r(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers || {'Content-Type':'application/json'} });
}
