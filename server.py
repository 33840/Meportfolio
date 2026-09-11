# -*- coding: utf-8 -*-
"""
留言板后端服务（仅使用 Python 标准库，无需安装任何第三方包）
功能：
  1. 提供静态网站服务（把整个作品集目录作为网站根目录）
  2. SQLite 数据库保存留言（data/messages.db），所有访客共享、持久保存
  3. GET  /api/messages  获取留言列表（最新在前，最多 100 条）
  4. POST /api/messages  发表留言（JSON：{"name": "昵称", "text": "留言内容"}）
启动：双击「启动留言板服务器.bat」，然后浏览器访问 http://localhost:8000/
"""
import json
import os
import sqlite3
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

# ======================== 配置 ========================
ROOT = os.path.dirname(os.path.abspath(__file__))          # 网站根目录（本文件所在目录）
DB_DIR = os.path.join(ROOT, 'data')                        # 数据库目录
DB_PATH = os.path.join(DB_DIR, 'messages.db')              # SQLite 数据库文件
HOST = '127.0.0.1'                                         # 仅本机访问；如需局域网访问可改为 '0.0.0.0'
PORT = 8000                                                # 服务端口
MAX_BODY_BYTES = 8192                                      # 请求体大小上限（防刷）
MAX_NAME_LEN = 20                                          # 昵称最大长度
MAX_TEXT_LEN = 500                                         # 留言最大长度
LIST_LIMIT = 100                                           # 列表最多返回条数
POST_INTERVAL = 10                                         # 同一 IP 两次留言最小间隔（秒）

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf':  'font/ttf',
    '.txt':  'text/plain; charset=utf-8',
}

db_lock = threading.Lock()          # SQLite 写入锁
last_post_time = {}                 # IP -> 最近一次留言时间戳（简单的防频繁提交）


def init_db():
    """首次运行时自动创建数据库与数据表（不依赖任何外部命令）"""
    os.makedirs(DB_DIR, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id    INTEGER PRIMARY KEY AUTOINCREMENT,
                name  TEXT    NOT NULL,
                text  TEXT    NOT NULL,
                time  INTEGER NOT NULL,
                ip    TEXT    NOT NULL DEFAULT ''
            )
        ''')
        con.execute('CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time DESC)')
        con.commit()
    finally:
        con.close()


def db_insert(name, text, ip):
    """写入一条留言，返回该留言（含时间戳）"""
    ts = int(time.time() * 1000)
    with db_lock:
        con = sqlite3.connect(DB_PATH)
        try:
            cur = con.execute(
                'INSERT INTO messages (name, text, time, ip) VALUES (?, ?, ?, ?)',
                (name, text, ts, ip)
            )
            con.commit()
            msg_id = cur.lastrowid
        finally:
            con.close()
    return {'id': msg_id, 'name': name, 'text': text, 'time': ts}


def db_list(limit=LIST_LIMIT):
    """读取最新的留言（按时间倒序）"""
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            'SELECT name, text, time FROM messages ORDER BY time DESC, id DESC LIMIT ?',
            (limit,)
        ).fetchall()
    finally:
        con.close()
    return [{'name': r[0], 'text': r[1], 'time': r[2]} for r in rows]


def clean_text(value, max_len):
    """统一清洗：必须是字符串、去首尾空白、按字符数截断"""
    if not isinstance(value, str):
        return ''
    return value.strip()[:max_len]


class Handler(BaseHTTPRequestHandler):
    server_version = 'WangyutongBoard/1.0'

    # ---------- 工具方法 ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def client_ip(self):
        return self.client_address[0] if self.client_address else ''

    def log_message(self, fmt, *args):
        # 简洁日志：时间 + 状态
        print('[%s] %s' % (time.strftime('%H:%M:%S'), fmt % args))

    # ---------- GET：留言接口 / 静态文件 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/messages':
            try:
                self.send_json({'success': True, 'data': db_list()})
            except Exception as e:
                print('读取留言失败:', e)
                self.send_json({'success': False, 'error': '服务器内部错误'}, 500)
            return

        self.serve_static(path)

    # ---------- POST：发表留言 ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/messages':
            self.send_json({'success': False, 'error': '接口不存在'}, 404)
            return

        # 读取并限制请求体大小
        try:
            length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json({'success': False, 'error': '请求内容不合法'}, 400)
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self.send_json({'success': False, 'error': '数据格式错误'}, 400)
            return

        name = clean_text(payload.get('name'), MAX_NAME_LEN) or '匿名'
        text = clean_text(payload.get('text'), MAX_TEXT_LEN)
        if not text:
            self.send_json({'success': False, 'error': '留言内容不能为空'}, 400)
            return

        # 简单防刷：同一 IP 10 秒内只能提交一次
        ip = self.client_ip()
        now = time.time()
        if now - last_post_time.get(ip, 0) < POST_INTERVAL:
            self.send_json({'success': False, 'error': '留言太频繁，请稍后再试'}, 429)
            return
        last_post_time[ip] = now

        try:
            msg = db_insert(name, text, ip)
        except Exception as e:
            print('保存留言失败:', e)
            self.send_json({'success': False, 'error': '保存失败，请稍后再试'}, 500)
            return

        self.send_json({'success': True, 'data': msg})

    # ---------- 静态文件服务（带目录穿越防护） ----------
    def serve_static(self, url_path):
        rel = unquote(url_path).lstrip('/')
        if rel == '':
            rel = 'index.html'

        # 规范化路径并确保不会逃出网站根目录
        target = os.path.normpath(os.path.join(ROOT, *rel.split('/')))
        if not (target == ROOT or target.startswith(ROOT + os.sep)) or os.path.isdir(target):
            if os.path.isdir(target):
                target = os.path.join(target, 'index.html')
                if not os.path.isfile(target):
                    self.send_error(404)
                    return
            else:
                self.send_error(404)
                return

        if not os.path.isfile(target):
            self.send_error(404)
            return

        ext = os.path.splitext(target)[1].lower()
        ctype = MIME_TYPES.get(ext, 'application/octet-stream')
        try:
            with open(target, 'rb') as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        if ext in ('.html', '.htm'):
            self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)


def open_browser_later():
    """服务启动后稍等片刻自动打开浏览器（设置环境变量 WY_NO_BROWSER=1 可跳过）"""
    if os.environ.get('WY_NO_BROWSER'):
        return
    time.sleep(0.8)
    webbrowser.open('http://localhost:%d/' % PORT)


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print('=' * 56)
    print(' 留言板服务器已启动')
    print(' 网站地址 : http://localhost:%d/' % PORT)
    print(' 数据库   : %s' % DB_PATH)
    print(' 关闭服务 : 直接关掉本窗口（或按 Ctrl+C）')
    print('=' * 56)
    threading.Thread(target=open_browser_later, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务器已停止')
        server.shutdown()


if __name__ == '__main__':
    main()
