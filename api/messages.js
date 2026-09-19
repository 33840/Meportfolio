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

const https = require('https');
const { URL } = require('url');

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
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || '';
}

// 用 Node 内置 https 调用 Upstash REST API（兼容所有 Node 版本，不依赖全局 fetch）
function upstash(command) {
  return new Promise((resolve, reject) => {
    const fullUrl = process.env.UPSTASH_REDIS_REST_URL + '/' + command.map(encodeURIComponent).join('/');
    const u = new URL(fullUrl);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // 必须配置 Upstash Redis
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: '留言服务未配置数据库环境变量' }));
      return;
    }

    if (req.method === 'GET') {
      const items = await upstash(['lrange', REDIS_LIST_KEY, '0', String(MAX_MESSAGES - 1)]);
      const list = (items || []).map((raw) => {
        try { return JSON.parse(raw); } catch { return null; }
      }).filter(Boolean);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, data: list }));
      return;
    }

    if (req.method === 'POST') {
      let raw;
      try {
        raw = await readBody(req);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: '请求内容不合法' }));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(raw);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: '数据格式错误' }));
        return;
      }

      const name = cleanText(payload.name, MAX_NAME_LEN) || '匿名';
      const text = cleanText(payload.text, MAX_TEXT_LEN);
      if (!text) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: '留言内容不能为空' }));
        return;
      }

      // 同 IP 防刷：SET ... NX EX 10，返回 null 表示 10 秒内已提交过
      const ip = getClientIp(req);
      const rateOk = await upstash(['set', 'rate:' + ip, '1', 'nx', 'ex', String(POST_INTERVAL_SEC)]);
      if (rateOk === null) {
        res.statusCode = 429;
        res.end(JSON.stringify({ success: false, error: '留言太频繁，请稍后再试' }));
        return;
      }

      const msg = { name, text, time: Date.now() };
      await upstash(['lpush', REDIS_LIST_KEY, JSON.stringify(msg)]);
      await upstash(['ltrim', REDIS_LIST_KEY, '0', String(MAX_MESSAGES - 1)]);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, data: msg }));
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: '方法不允许' }));
  } catch (e) {
    console.error('api/messages 运行异常:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: '服务器内部错误' }));
  }
};
