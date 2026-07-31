/**
 * 教你举报 - Cloudflare Worker API
 * 部署到 Cloudflare Workers 后绑定 D1 数据库
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,x-admin-token'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      let result;
      const isAdmin = path.startsWith('/api/admin/');

      // ====== 后台鉴权 ======
      if (isAdmin && path !== '/api/admin/captcha' && path !== '/api/admin/send-code' && path !== '/api/admin/login') {
        const token = request.headers.get('x-admin-token');
        if (!token) return r403(cors);
        const valid = await env.KV.get('token:' + token);
        if (!valid) return r403(cors);
      }

      // ====== 公开接口 ======
      if (path === '/api/public/stats') {
        const tr = await db.prepare('SELECT COUNT(*) as c FROM heatmap_data').first();
        const tu = await db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM heatmap_data').first();
        const tl = await db.prepare('SELECT COUNT(DISTINCT province||city||district) as c FROM heatmap_data').first();
        const re = await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE report_type='education'").first();
        const rm = await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE report_type='municipal'").first();
        result = { totalReports:tr.c, totalUsers:tu.c, totalLocations:tl.c, reportEdu:re.c, reportMun:rm.c };
      }

      else if (path === '/api/public/points') {
        const { results } = await db.prepare(
          'SELECT city, province, report_type, COUNT(*) as count FROM heatmap_data GROUP BY city ORDER BY count DESC'
        ).all();
        result = results;
      }

      else if (path === '/api/public/rank') {
        const { results } = await db.prepare(
          'SELECT province, city, report_type, COUNT(*) as count FROM heatmap_data GROUP BY city ORDER BY count DESC LIMIT 10'
        ).all();
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
        const page = parseInt(url.searchParams.get('page')||'1');
        const limit = 20;
        const offset = (page-1)*limit;
        
        const { results: data } = await db.prepare(
          `SELECT * FROM heatmap_data ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ).bind(...params).all();
        
        const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM heatmap_data ${where}`).bind(...params).first();
        result = { data, total: totalRow.total, page, limit };
      }

      // ====== 热力图提交（IP限流） ======
      else if (path === '/api/heatmap' && request.method === 'POST') {
        const { session_id, report_type, province, city, district, description } = await request.json();
        if (!session_id||!report_type||!province||!city||!district||!description)
          return r400(cors, '请完整填写所有字段');
        if (description.length > 200) return r400(cors, '描述不超过200字');
        
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const cnt = await db.prepare("SELECT COUNT(*) as c FROM heatmap_data WHERE ip=?1 AND date(created_at)=date('now')").bind(ip).first();
        if (cnt.c >= 10) return r429(cors, '今日提交已达上限(10次)');
        
        await db.prepare('INSERT INTO heatmap_data(session_id,report_type,province,city,district,description,ip) VALUES(?1,?2,?3,?4,?5,?6,?7)')
          .bind(session_id,report_type,province,city,district,description,ip).run();
        result = { success: true };
      }

      // ====== 访问 ======
      else if (path === '/api/visit' && request.method === 'POST') {
        const { session_id, page:pg, referrer, user_agent } = await request.json();
        await db.prepare('INSERT INTO visits(session_id,page,referrer,user_agent) VALUES(?1,?2,?3,?4)')
          .bind(session_id||'',pg||'/',referrer||'',user_agent||'').run();
        result = { success: true };
      }

      // ====== 身份 ======
      else if (path === '/api/user-type' && request.method === 'POST') {
        const { session_id, user_type } = await request.json();
        await db.prepare('INSERT OR REPLACE INTO users(session_id,user_type) VALUES(?1,?2)')
          .bind(session_id,user_type).run();
        result = { success: true };
      }

      // ====== 模式 ======
      else if (path === '/api/mode' && request.method === 'POST') {
        const { session_id, mode } = await request.json();
        await db.prepare('INSERT INTO mode_selections(session_id,mode) VALUES(?1,?2)')
          .bind(session_id,mode).run();
        result = { success: true };
      }

      // ====== AI生成 ======
      else if (path === '/api/ai-generate' && request.method === 'POST') {
        const { session_id, prompt, user_type } = await request.json();
        await db.prepare('INSERT INTO ai_usage(session_id,user_type) VALUES(?1,?2)')
          .bind(session_id,user_type||'').run();
        
        try {
          const ai = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer your-deepseek-api-key'},
            body: JSON.stringify({
              model:'deepseek-chat',
              messages:[
                {role:'system',content:'你是资深纪检监察举报信撰写专家...'},
                {role:'user',content:prompt}
              ],
              temperature:0.7,max_tokens:2000
            })
          });
          const d = await ai.json();
          result = { content: d.choices?.[0]?.message?.content || '生成失败' };
        } catch(e) {
          result = { content: 'AI服务暂不可用，请稍后再试' };
        }
      }

      // ====== 文本混淆 ======
      else if (path === '/api/text-obfuscate' && request.method === 'POST') {
        const { text } = await request.json();
        try {
          const my = await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(text.slice(0,500))+'&langpair=zh-CN|en');
          const md = await my.json();
          const en = md.responseData?.translatedText||text;
          const zy = await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(en.slice(0,500))+'&langpair=en|zh-CN');
          const zd = await zy.json();
          result = { original:text, obfuscated:zd.responseData?.translatedText||text };
        } catch(e) { result = { original:text, obfuscated:text }; }
      }

      // ====== 反馈 ======
      else if (path === '/api/feedback' && request.method === 'POST') {
        const { session_id, helpful } = await request.json();
        await db.prepare('INSERT INTO feedback(session_id,helpful) VALUES(?1,?2)')
          .bind(session_id,helpful).run();
        result = { success: true };
      }

      // ====== 完成 ======
      else if (path === '/api/complete' && request.method === 'POST') {
        const { session_id } = await request.json();
        await db.prepare('INSERT INTO completions(session_id) VALUES(?1)').bind(session_id).run();
        result = { success: true };
      }

      // ====== 后台：计算题 ======
      else if (path === '/api/admin/captcha') {
        const a = Math.floor(Math.random()*20)+1, b = Math.floor(Math.random()*20)+1;
        const ans = a+b;
        result = { question: a+' + '+b+' = ?', hash: await sha256(String(ans)) };
      }

      // ====== 后台：发送验证码 ======
      else if (path === '/api/admin/send-code' && request.method === 'POST') {
        const { email, password, captchaAnswer, captchaHash } = await request.json();
        if (!email||!password||captchaAnswer==null||!captchaHash) return r400(cors,'请完整填写');
        if (email !== 'your-admin-email@example.com') return r400(cors,'邮箱错误');
        if (password !== 'your-admin-password') return r400(cors,'密码错误');
        if ((await sha256(String(parseInt(captchaAnswer)))) !== captchaHash) return r400(cors,'计算题错误');
        
        const code = String(Math.floor(100000+Math.random()*900000));
        await env.KV.put('code:'+email, code, { expirationTtl: 300 });
        
        // 尝试发邮件，失败也返回验证码
        try {
          await fetch('https://api.mailchannels.net/tx/v1/send', {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({
              personalizations:[{to:[{email}]}],
              from:{email:'no-reply@jiaoni.pages.dev',name:'教你举报'},
              subject:'后台登录验证码',
              content:[{type:'text/plain',value:'验证码：'+code+'\n5分钟有效'}]
            })
          });
        } catch(e) {}
        result = { success:true, code };
      }

      // ====== 后台：验证码登录 ======
      else if (path === '/api/admin/login' && request.method === 'POST') {
        const { email, code } = await request.json();
        const stored = await env.KV.get('code:'+email);
        if (!stored || stored !== code) return r400(cors,'验证码错误');
        const token = crypto.randomUUID();
        await env.KV.put('token:'+token, '1', { expirationTtl: 86400 });
        result = { token };
      }

      // ====== 后台统计 ======
      else if (path === '/api/admin/stats') {
        const tv = (await db.prepare('SELECT COUNT(*) as c FROM users').first()).c;
        const tu = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE user_type='new'").first()).c;
        const tr = (await db.prepare('SELECT COUNT(*) as c FROM heatmap_data').first()).c;
        const ai = (await db.prepare('SELECT COUNT(*) as c FROM ai_usage').first()).c;
        const au = (await db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM ai_usage').first()).c;
        const td = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").first()).c;
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
        const table = path.includes('ai-trend')?'ai_usage':path.includes('heatmap-trend')?'heatmap_data':'visits';
        const col = path.includes('heatmap-trend')?'created_at':path.includes('ai-trend')?'created_at':'visit_date';
        const { results } = await db.prepare(
          `WITH RECURSIVE dates(d) AS (SELECT date('now','-30 days') UNION ALL SELECT date(d,'+1 day') FROM dates WHERE d<date('now')) SELECT d as date, COALESCE((SELECT COUNT(*) FROM ${table} WHERE date(${col})=d),0) as count FROM dates`
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
        const { results } = await db.prepare(
          "SELECT CAST(strftime('%H',created_at) AS INTEGER) as hour, COUNT(*) as count FROM users GROUP BY hour ORDER BY hour"
        ).all();
        result = results;
      }

      else if (path === '/api/admin/report-type-ratio') {
        const { results } = await db.prepare('SELECT report_type, COUNT(*) as count FROM heatmap_data GROUP BY report_type').all();
        result = results;
      }

      else if (path === '/api/admin/feedback-stats') {
        const { results } = await db.prepare('SELECT helpful, COUNT(*) as count FROM feedback GROUP BY helpful').all();
        result = results;
      }

      else if (path === '/api/admin/user-type-stats') {
        const { results } = await db.prepare('SELECT user_type, COUNT(*) as count FROM users GROUP BY user_type').all();
        result = results;
      }

      else if (path === '/api/admin/mode-stats') {
        const { results } = await db.prepare('SELECT mode, COUNT(*) as count FROM mode_selections GROUP BY mode').all();
        result = results;
      }

      else {
        return new Response('Not Found', { status:404, headers:cors });
      }

      return new Response(JSON.stringify(result), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });

    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function r400(cors,msg) { return new Response(JSON.stringify({error:msg}),{status:400,headers:{...cors,'Content-Type':'application/json'}}); }
function r403(cors) { return new Response(JSON.stringify({error:'未授权'}),{status:403,headers:{...cors,'Content-Type':'application/json'}}); }
function r429(cors,msg) { return new Response(JSON.stringify({error:msg}),{status:429,headers:{...cors,'Content-Type':'application/json'}}); }
