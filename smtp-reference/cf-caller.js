/**
 * Cloudflare Workers/Pages Functions 调用邮件中继的示例
 *
 * 在 send-code 接口中调用此函数，将验证码通过中继发送
 */

// 配置
const RELAY_URL = 'https://your-domain.com/mail-relay/send';
const RELAY_TOKEN = '替换成你的中继密钥';

/**
 * 通过中继发送邮件
 * @param {string} to      收件人邮箱
 * @param {string} code    验证码
 * @param {object} [env]   CF 环境变量对象（传入后优先读 env 配置）
 */
export async function sendViaRelay(to, code, env) {
  const relayUrl = env?.RELAY_URL || RELAY_URL;
  const relayToken = env?.RELAY_TOKEN || RELAY_TOKEN;

  try {
    const resp = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-relay-token': relayToken
      },
      body: JSON.stringify({ to, code })
    });
    if (!resp.ok) {
      console.error('Relay returned', resp.status, await resp.text());
    }
  } catch (e) {
    console.error('Relay error:', e.message);
  }
}

/**
 * 使用示例（在 CF Functions 中的 send-code 流程里）
 */
export async function handleSendCode(request, env) {
  const { email } = await request.json();

  // 生成验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // 存入 KV（5分钟过期）
  await env.KV.put('code:' + email, code, { expirationTtl: 300 });

  // 发送邮件（异步，不影响返回）
  await sendViaRelay(email, code, env);

  return new Response(JSON.stringify({ success: true, code }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
