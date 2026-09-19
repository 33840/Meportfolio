/**
 * Vercel Serverless Function: /api/messages
 *
 * 替代本地 Python server.py，使部署在 Vercel 上的留言板也能跨访客共享。
 * 使用 Upstash Redis（免费云端 Redis）的 REST API 存储留言。
 *
 * 环境变量（在 Vercel 项目 Settings -> Environment Variables 中配置）：
 *   UPSTASH_REDIS_REST_URL    例如 https://xxxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN  Upstash 控制台提供的 token
 *
 * 接口契约（与原 Python 后端一致）：
 *   GET  /api/messages  -> { success: true, data: [{name,text,time}, ...] }  最新在前，最多 100 条
 *   POST /api/messages  -> { success: true, data: {name,text,time} }          body: { name?, text }
 */

const MAX_NAME_LEN = 20;
const MAX_TEXT_LEN = 500;
const MAX_BODY_BYTES = 8192;
const POST_INTERVAL_SEC = 10; // 同一 IP 10 秒内只能提交一次
const MAX_MESSAGES = 100;
const REDIS_LIST_KEY = 'messages';

function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function getClientIp(req) {
  // Vercel 会把真实 IP 放在 x-forwarded-for
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

async function upstash(command) {
  // command 示例：['lrange', 'messages', '0', '99']
  const url = process.env.UPSTASH_REDIS_REST_URL + '/' + command.map(encodeURIComponent).join('/');
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN },
  });
  const json = await res.json();
  return json.result;
}

module.exports = async function handler(req, res) {
  // 必须配置 Upstash Redis
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ success: false, error: '留言服务未配置数据库环境变量' });
  }

  // 允许跨域（如需）
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      // 读取最新 100 条（LRANGE 返回从左到右，LPUSH 把最新的放左边，所以 0..99 就是最新 100 条）
      const items = await upstash(['lrange', REDIS_LIST_KEY, '0', String(MAX_MESSAGES - 1)]);
      const list = (items || []).map((raw) => {
        try { return JSON.parse(raw); } catch { return null; }
      }).filter(Boolean);
      return res.status(200).json({ success: true, data: list });
    } catch (e) {
      console.error('读取留言失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  if (req.method === 'POST') {
    // 限制请求体大小
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        return res.status(400).json({ success: false, error: '请求内容不合法' });
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');

    let payload;
    try {
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    } catch {
      return res.status(400).json({ success: false, error: '数据格式错误' });
    }

    const name = cleanText(payload.name, MAX_NAME_LEN) || '匿名';
    const text = cleanText(payload.text, MAX_TEXT_LEN);
    if (!text) {
      return res.status(400).json({ success: false, error: '留言内容不能为空' });
    }

    // 同 IP 防刷：SET ... NX EX 10，返回 null 表示 10 秒内已提交过
    const ip = getClientIp(req);
    const rateKey = 'rate:' + ip;
    const rateOk = await upstash(['set', rateKey, '1', 'nx', 'ex', String(POST_INTERVAL_SEC)]);
    if (rateOk === null) {
      return res.status(429).json({ success: false, error: '留言太频繁，请稍后再试' });
    }

    const msg = { name, text, time: Date.now() };

    try {
      // LPUSH 把新留言放到列表最前
      await upstash(['lpush', REDIS_LIST_KEY, JSON.stringify(msg)]);
      // 列表只保留最新 100 条，避免无限增长
      await upstash(['ltrim', REDIS_LIST_KEY, '0', String(MAX_MESSAGES - 1)]);
      return res.status(200).json({ success: true, data: msg });
    } catch (e) {
      console.error('保存留言失败:', e);
      return res.status(500).json({ success: false, error: '保存失败，请稍后再试' });
    }
  }

  // 其他方法
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: '方法不允许' });
}
