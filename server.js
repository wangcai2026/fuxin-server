import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'fuxin2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== 数据库 =====
const db = new Database(path.join(__dirname, 'data.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  user_type TEXT,
  code TEXT UNIQUE NOT NULL,
  redeemed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  redeemed_at TEXT
);
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goods_type TEXT,
  description TEXT,
  phone TEXT,
  status TEXT DEFAULT 'pending',
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ===== 公开API：礼品申领 =====
app.post('/api/gift', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.json({ ok: false, msg: '请填写备注和手机号' });
  if (!/^1\d{10}$/.test(phone)) return res.json({ ok: false, msg: '手机号格式不对' });
  // 同手机号当天不能重复领
  const today = new Date().toISOString().slice(0, 10);
  const dup = db.prepare(`SELECT id FROM gifts WHERE phone=? AND date(created_at)=?`).get(phone, today);
  if (dup) return res.json({ ok: false, msg: '该手机号今天已经领过了' });
  // 生成唯一6位码
  let code, ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    const exists = db.prepare(`SELECT id FROM gifts WHERE code=?`).get(code);
    if (!exists) ok = true;
  }
  db.prepare(`INSERT INTO gifts (name,phone,user_type,code) VALUES (?,?,?,?)`).run(name, phone, '', code);
  res.json({ ok: true, code });
});

// ===== 公开API：估价提交 =====
app.post('/api/estimate', (req, res) => {
  const { goodsType, description, phone } = req.body;
  if (!phone) return res.json({ ok: false, msg: '请留手机号' });
  db.prepare(`INSERT INTO estimates (goods_type,description,phone) VALUES (?,?,?)`)
    .run(goodsType || '', description || '', phone);
  res.json({ ok: true });
});

// ===== 公开API：金价（代理+换算） =====
let goldCache = { ts: 0, data: null };
app.get('/api/gold', async (req, res) => {
  try {
    if (goldCache.data && Date.now() - goldCache.ts < 5 * 60 * 1000) {
      return res.json(goldCache.data);
    }
    const [goldRes, fxRes] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU').then(r => r.json()),
      fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json())
    ]);
    const usdOz = goldRes.price;                 // USD/盎司
    const cny = fxRes.rates.CNY;                 // 1 USD = ? CNY
    const perGram = usdOz * cny / 31.1035;      // CNY/克
    const result = {
      au999: Math.round(perGram * 0.999 * 10) / 10,   // 参考大盘
      updated: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };
    goldCache = { ts: Date.now(), data: result };
    res.json(result);
  } catch (e) {
    res.json({ au999: 472.5, updated: '行情暂不可用', fallback: true });
  }
});

// ===== 管理后台简单鉴权 =====
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

app.use('/api/admin', (req, res, next) => {
  // 简单token：登录后前端存sessionStorage，这里用header校验
  if (req.headers['x-admin-token'] === ADMIN_PASSWORD) return next();
  res.status(401).json({ ok: false, msg: '未登录' });
});

app.get('/api/admin/gifts', (req, res) => {
  const rows = db.prepare(`SELECT * FROM gifts ORDER BY id DESC`).all();
  res.json(rows);
});

app.post('/api/admin/gifts/:code/redeem', (req, res) => {
  const row = db.prepare(`SELECT * FROM gifts WHERE code=?`).get(req.params.code);
  if (!row) return res.json({ ok: false, msg: '核销码不存在' });
  if (row.redeemed) return res.json({ ok: false, msg: '该码已核销过' });
  db.prepare(`UPDATE gifts SET redeemed=1, redeemed_at=datetime('now','localtime') WHERE code=?`).run(req.params.code);
  res.json({ ok: true, name: row.name, phone: row.phone });
});

app.get('/api/admin/estimates', (req, res) => {
  const rows = db.prepare(`SELECT * FROM estimates ORDER BY id DESC`).all();
  res.json(rows);
});

app.post('/api/admin/estimates/:id/status', (req, res) => {
  db.prepare(`UPDATE estimates SET status=? WHERE id=?`).run(req.body.status, req.params.id);
  res.json({ ok: true });
});

// 管理后台页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`福鑫回收寄卖 server running on http://localhost:${PORT}`);
});
