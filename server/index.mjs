import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'data');
const dataFile = process.env.TECHFIX_DATA_FILE || (process.env.VERCEL ? '/tmp/techfix.json' : path.join(dataDir, 'techfix.json'));
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const sessionTtlMs = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
let data;

const emptyData = () => ({ admin: null, clients: [], tickets: [], audit: [] });

async function loadData() {
  try {
    data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = emptyData();
    await persist();
  }
  data = { ...emptyData(), ...data };
}

async function persist() {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temporary, dataFile);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value, max = 500) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const publicAdmin = admin => (admin ? { id: admin.id, name: admin.name, email: admin.email } : null);

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function clientPayload(value) {
  if (!value || typeof value !== 'object') return null;
  const equipment = Array.isArray(value.equipment) ? value.equipment.slice(0, 3).map(item => ({
    name: text(item?.name, 120),
    type: item?.type === 'Desktop' ? 'Desktop' : 'Notebook',
    brand: text(item?.brand, 80),
    model: text(item?.model, 120),
  })) : [];
  const plan = value.plan === 'Premium' ? 'Premium' : value.plan === 'Básico' ? 'Básico' : null;
  const status = ['Ativo', 'Atrasado', 'Suspenso'].includes(value.status) ? value.status : null;
  if (!text(value.name, 160) || !text(value.email, 240) || !plan || !status || !text(value.contractStart, 30) || !text(value.nextPayment, 30)) return null;
  return {
    id: text(value.id, 80) || id(), name: text(value.name, 160), email: text(value.email, 240), phone: text(value.phone, 40),
    address: text(value.address, 240), plan, status, nextPayment: text(value.nextPayment, 30), contractStart: text(value.contractStart, 30),
    devices: equipment.length, equipment, notes: text(value.notes, 2000), createdAt: text(value.createdAt, 40) || now(), updatedAt: now(),
  };
}

function ticketPayload(value) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type === 'Remoto' ? 'Remoto' : value.type === 'Presencial' ? 'Presencial' : null;
  const statuses = ['Agendado', 'Em atendimento', 'Aguardando peça', 'Concluído', 'Cancelado'];
  if (!type || !statuses.includes(value.status) || !text(value.clientId, 80) || !text(value.issue, 2000)) return null;
  const client = data.clients.find(item => item.id === value.clientId);
  if (!client) return null;
  return {
    id: text(value.id, 80) || `#${String(Date.now()).slice(-5)}`, clientId: client.id, client: client.name, device: text(value.device, 120), type,
    issue: text(value.issue, 2000), status: value.status, date: text(value.date, 40), notes: text(value.notes, 2000),
    createdAt: text(value.createdAt, 40) || now(), updatedAt: now(),
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const current = attempts.get(key) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
  if (Date.now() > current.reset) current.count = 0;
  current.count += 1;
  attempts.set(key, current);
  if (current.count > 10) return fail(res, 429, 'Muitas tentativas. Tente novamente mais tarde.');
  next();
}

function sessionCookie(token) {
  const secure = isProduction ? '; Secure' : '';
  return `techfix_session=${token}; Path=/; Max-Age=${sessionTtlMs / 1000}; HttpOnly; SameSite=Strict${secure}`;
}

function requireAuth(req, res, next) {
  const token = req.headers.cookie?.match(/(?:^|; )techfix_session=([^;]+)/)?.[1];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return fail(res, 401, 'Sessão inválida ou expirada.');
  }
  req.admin = data.admin?.id === session.adminId ? data.admin : null;
  if (!req.admin) return fail(res, 401, 'Sessão inválida ou expirada.');
  session.expiresAt = Date.now() + sessionTtlMs;
  next();
}

function audit(req, action, entity, title, description, snapshot) {
  const entry = { id: id(), entity, action, title, description, actor: req.admin.name, createdAt: now() };
  if (snapshot !== undefined) entry.snapshot = snapshot;
  data.audit.unshift(entry);
  return entry;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '100kb' }));

app.get('/api/bootstrap', requireAuth, (req, res) => res.json({ admin: publicAdmin(req.admin), clients: data.clients, tickets: data.tickets, audit: data.audit }));
app.get('/api/auth/status', (req, res) => res.json({ hasAdmin: Boolean(data.admin) }));
app.post('/api/auth/register', rateLimit, async (req, res) => {
  if (data.admin) return fail(res, 409, 'O acesso administrativo já foi criado.');
  const name = text(req.body?.name, 160);
  const email = text(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return fail(res, 400, 'Nome, e-mail válido e senha com pelo menos 12 caracteres são obrigatórios.');
  data.admin = { id: 'main', name, email, passwordHash: hashPassword(password), createdAt: now() };
  const token = id();
  sessions.set(token, { adminId: data.admin.id, expiresAt: Date.now() + sessionTtlMs });
  audit({ admin: data.admin }, 'create', 'admin', 'Acesso administrativo criado', 'Primeiro usuário administrativo cadastrado.');
  await persist();
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(201).json({ admin: publicAdmin(data.admin) });
});
app.post('/api/auth/login', rateLimit, async (req, res) => {
  const email = text(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!data.admin || data.admin.email !== email || !verifyPassword(password, data.admin.passwordHash)) return fail(res, 401, 'E-mail ou senha incorretos.');
  const token = id();
  sessions.set(token, { adminId: data.admin.id, expiresAt: Date.now() + sessionTtlMs });
  audit({ admin: data.admin }, 'login', 'admin', 'Login realizado', 'Administrador entrou no painel.');
  await persist();
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ admin: publicAdmin(data.admin) });
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|; )techfix_session=([^;]+)/)?.[1];
  if (token) sessions.delete(token);
  audit(req, 'logout', 'admin', 'Sessão encerrada', 'Administrador saiu do painel.');
  await persist();
  res.setHeader('Set-Cookie', 'techfix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
  res.status(204).end();
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  const saved = clientPayload({ ...req.body, id: req.params.id });
  if (!saved) return fail(res, 400, 'Dados do cliente inválidos.');
  const index = data.clients.findIndex(item => item.id === saved.id);
  const exists = index >= 0;
  if (exists) saved.createdAt = data.clients[index].createdAt;
  if (exists) data.clients[index] = saved; else data.clients.push(saved);
  const entry = audit(req, exists ? 'update' : 'create', 'client', saved.name, exists ? 'Cadastro do cliente atualizado.' : 'Novo cliente cadastrado.', saved);
  await persist();
  res.json({ record: saved, audit: entry });
});
app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  const index = data.clients.findIndex(item => item.id === req.params.id);
  if (index < 0) return fail(res, 404, 'Cliente não encontrado.');
  const [removed] = data.clients.splice(index, 1);
  const entry = audit(req, 'delete', 'client', removed.name, 'Cliente removido da carteira.', removed);
  await persist();
  res.json({ audit: entry });
});
app.put('/api/tickets/:id', requireAuth, async (req, res) => {
  const saved = ticketPayload({ ...req.body, id: req.params.id });
  if (!saved) return fail(res, 400, 'Dados do atendimento inválidos.');
  const index = data.tickets.findIndex(item => item.id === saved.id);
  const exists = index >= 0;
  if (exists) saved.createdAt = data.tickets[index].createdAt;
  if (exists) data.tickets[index] = saved; else data.tickets.push(saved);
  const entry = audit(req, exists ? 'update' : 'create', 'ticket', saved.id, exists ? `Atendimento de ${saved.client} atualizado.` : `Atendimento aberto para ${saved.client}.`, saved);
  await persist();
  res.json({ record: saved, audit: entry });
});
app.delete('/api/tickets/:id', requireAuth, async (req, res) => {
  const index = data.tickets.findIndex(item => item.id === req.params.id);
  if (index < 0) return fail(res, 404, 'Atendimento não encontrado.');
  const [removed] = data.tickets.splice(index, 1);
  const entry = audit(req, 'delete', 'ticket', removed.id, `Atendimento de ${removed.client} removido.`, removed);
  await persist();
  res.json({ audit: entry });
});
app.get('/api/backup', requireAuth, async (req, res) => {
  audit(req, 'backup', 'system', 'Backup exportado', 'Arquivo JSON gerado com clientes, atendimentos e histórico.');
  await persist();
  res.json({ exportedAt: now(), admin: publicAdmin(req.admin), clients: data.clients, tickets: data.tickets, audit: data.audit });
});

if (isProduction) {
  app.use(express.static(path.join(root, 'dist'), { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(root, 'dist', 'index.html'));
    next();
  });
}

await loadData();

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Techfix server listening on http://localhost:${port}`));
}
