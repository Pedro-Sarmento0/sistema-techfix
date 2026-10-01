import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'data');
const dataFile = process.env.TECHFIX_DATA_FILE || (process.env.VERCEL ? '/tmp/techfix.json' : path.join(dataDir, 'techfix.json'));
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const sessionTtlMs = 8 * 60 * 60 * 1000;
const attempts = new Map();
// Production must use the explicitly configured database connection.
// Do not silently fall back to a Vercel-managed Postgres resource, because
// the application is intended to persist data in the Techfix Supabase project.
const databaseUrl = process.env.DATABASE_URL || null;
if (isProduction && !databaseUrl) {
  throw new Error('DATABASE_URL não configurada. Configure a conexão PostgreSQL do projeto Supabase Techfix na Vercel.');
}

const postgresConnectionString = databaseUrl
  ? (() => {
      const url = new URL(databaseUrl);
      url.searchParams.delete("sslmode");
      url.searchParams.delete("uselibpqcompat");
      return url.toString();
    })()
  : null;

const pool = postgresConnectionString
  ? new pg.Pool({
      connectionString: postgresConnectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    })
  : null;
let data;

const emptyData = () => ({ users: [], clients: [], tickets: [], audit: [] });

function normalizeData(value) {
  const normalized = { ...emptyData(), ...value };
  if (!normalized.users.length && normalized.admin) {
    normalized.users = [{ ...normalized.admin, role: 'admin', accountId: normalized.admin.id }];
  }
  const legacyAccountId = normalized.users[0]?.accountId || normalized.users[0]?.id;
  normalized.users = normalized.users.map(user => ({ ...user, accountId: user.accountId || legacyAccountId || user.id }));
  normalized.clients = normalized.clients.map(client => ({ ...client, accountId: client.accountId || legacyAccountId }));
  normalized.tickets = normalized.tickets.map(ticket => ({ ...ticket, accountId: ticket.accountId || legacyAccountId }));
  normalized.audit = normalized.audit.map(entry => ({ ...entry, accountId: entry.accountId || legacyAccountId }));
  delete normalized.admin;
  return normalized;
}

async function loadData() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS techfix_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS techfix_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        admin_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      ALTER TABLE techfix_users ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE techfix_clients ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE techfix_tickets ADD COLUMN IF NOT EXISTS account_id TEXT;
      UPDATE techfix_users
        SET account_id = (SELECT id FROM techfix_users ORDER BY created_at LIMIT 1)
        WHERE account_id IS NULL;
      UPDATE techfix_clients
        SET account_id = (SELECT account_id FROM techfix_users ORDER BY created_at LIMIT 1)
        WHERE account_id IS NULL;
      UPDATE techfix_tickets
        SET account_id = (SELECT account_id FROM techfix_users ORDER BY created_at LIMIT 1)
        WHERE account_id IS NULL;
      CREATE INDEX IF NOT EXISTS techfix_users_account_idx ON techfix_users (account_id);
      CREATE INDEX IF NOT EXISTS techfix_clients_account_idx ON techfix_clients (account_id);
      CREATE INDEX IF NOT EXISTS techfix_tickets_account_idx ON techfix_tickets (account_id);
    `);

    const [usersResult, clientsResult, equipmentResult, ticketsResult, stateResult] = await Promise.all([
      pool.query('SELECT id, account_id, name, email, password_hash, role, created_at FROM techfix_users ORDER BY created_at'),
      pool.query('SELECT id, account_id, name, email, phone, address, plan, status, next_payment, contract_start, devices, notes, created_at, updated_at FROM techfix_clients ORDER BY created_at'),
      pool.query('SELECT client_id, name, type, brand, model FROM techfix_equipment ORDER BY id'),
      pool.query('SELECT id, account_id, client_id, device, type, issue, status, date, notes, created_at, updated_at FROM techfix_tickets ORDER BY created_at'),
      pool.query('SELECT payload FROM techfix_state WHERE id = 1'),
    ]);

    const equipmentByClient = new Map();
    for (const row of equipmentResult.rows) {
      const list = equipmentByClient.get(row.client_id) ?? [];
      list.push({ name: row.name, type: row.type, brand: row.brand, model: row.model });
      equipmentByClient.set(row.client_id, list);
    }

    const clientById = new Map();
    const clients = clientsResult.rows.map(row => {
      const equipment = equipmentByClient.get(row.id) ?? [];
      const client = {
        id: row.id,
        accountId: row.account_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        plan: row.plan,
        status: row.status,
        nextPayment: row.next_payment,
        contractStart: row.contract_start,
        devices: equipment.length,
        equipment,
        notes: row.notes,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      clientById.set(client.id, client);
      return client;
    });

    data = normalizeData({
      users: usersResult.rows.map(row => ({
        id: row.id,
        accountId: row.account_id || row.id,
        name: row.name,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      clients,
      tickets: ticketsResult.rows.map(row => ({
        id: row.id,
        accountId: row.account_id,
        clientId: row.client_id,
        client: clientById.get(row.client_id)?.name ?? '',
        device: row.device,
        type: row.type,
        issue: row.issue,
        status: row.status,
        date: row.date,
        notes: row.notes,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
      audit: stateResult.rows[0]?.payload?.audit ?? [],
    });
    return;
  }

  try {
    data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = emptyData();
    await persist();
  }
  data = normalizeData(data);
}

async function persist(accountId) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM techfix_tickets WHERE account_id = $1', [accountId]);
      await client.query('DELETE FROM techfix_equipment WHERE client_id IN (SELECT id FROM techfix_clients WHERE account_id = $1)', [accountId]);
      await client.query('DELETE FROM techfix_clients WHERE account_id = $1', [accountId]);
      await client.query('DELETE FROM techfix_users WHERE account_id = $1', [accountId]);

      for (const user of data.users.filter(item => item.accountId === accountId)) {
        await client.query(
          `INSERT INTO techfix_users (id, account_id, name, email, password_hash, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.id, accountId, user.name, user.email, user.passwordHash, user.role, user.createdAt],
        );
      }

      for (const saved of data.clients.filter(item => item.accountId === accountId)) {
        await client.query(
          `INSERT INTO techfix_clients
             (id, account_id, name, email, phone, address, plan, status, next_payment, contract_start, devices, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            saved.id, accountId, saved.name, saved.email, saved.phone, saved.address, saved.plan, saved.status,
            saved.nextPayment, saved.contractStart, saved.equipment.length, saved.notes, saved.createdAt, saved.updatedAt,
          ],
        );

        for (const equipment of saved.equipment) {
          await client.query(
            `INSERT INTO techfix_equipment (client_id, name, type, brand, model)
             VALUES ($1, $2, $3, $4, $5)`,
            [saved.id, equipment.name, equipment.type, equipment.brand, equipment.model],
          );
        }
      }

      for (const ticket of data.tickets.filter(item => item.accountId === accountId)) {
        await client.query(
          `INSERT INTO techfix_tickets
             (id, account_id, client_id, device, type, issue, status, date, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            ticket.id, accountId, ticket.clientId, ticket.device, ticket.type, ticket.issue, ticket.status,
            ticket.date, ticket.notes, ticket.createdAt, ticket.updatedAt,
          ],
        );
      }

      const currentState = await client.query('SELECT payload FROM techfix_state WHERE id = 1 FOR UPDATE');
      const existingAudit = currentState.rows[0]?.payload?.audit ?? [];
      const scopedAudit = data.audit.filter(entry => entry.accountId === accountId);
      const otherAudit = existingAudit.filter(entry => entry.accountId !== accountId);
      await client.query(
        `INSERT INTO techfix_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [JSON.stringify({ audit: [...scopedAudit, ...otherAudit] })],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temporary, dataFile);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value, max = 500) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const publicUser = user => (user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null);
const sessionHash = token => crypto.createHash('sha256').update(token).digest('hex');

async function saveSession(token, adminId) {
  if (pool) {
    await pool.query(
      `INSERT INTO techfix_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '8 hours')
       ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionHash(token), adminId],
    );
    return;
  }
  if (!globalThis.__techfixSessions) globalThis.__techfixSessions = new Map();
  globalThis.__techfixSessions.set(token, { adminId, expiresAt: Date.now() + sessionTtlMs });
}

async function getSession(token) {
  if (pool) {
    const result = await pool.query(
      'SELECT admin_id, expires_at FROM techfix_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [sessionHash(token)],
    );
    return result.rows[0] ? { adminId: result.rows[0].admin_id, expiresAt: new Date(result.rows[0].expires_at).getTime() } : null;
  }
  const session = globalThis.__techfixSessions?.get(token);
  return session && session.expiresAt > Date.now() ? session : null;
}

async function deleteSession(token) {
  if (pool) await pool.query('DELETE FROM techfix_sessions WHERE token_hash = $1', [sessionHash(token)]);
  else globalThis.__techfixSessions?.delete(token);
}

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

function ticketPayload(value, accountId) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type === 'Remoto' ? 'Remoto' : value.type === 'Presencial' ? 'Presencial' : null;
  const statuses = ['Agendado', 'Em atendimento', 'Aguardando peça', 'Concluído', 'Cancelado'];
  if (!type || !statuses.includes(value.status) || !text(value.clientId, 80) || !text(value.issue, 2000)) return null;
  const client = data.clients.find(item => item.id === value.clientId && item.accountId === accountId);
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
  return `techfix_session=${token}; Path=/; Max-Age=${sessionTtlMs / 1000}; HttpOnly; SameSite=Lax${secure}`;
}

async function requireAuth(req, res, next) {
  const token = req.headers.cookie?.match(/(?:^|; )techfix_session=([^;]+)/)?.[1];
  const session = token && await getSession(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) await deleteSession(token);
    return fail(res, 401, 'Sessão inválida ou expirada.');
  }
  req.user = data.users.find(user => user.id === session.adminId) ?? null;
  if (!req.user) return fail(res, 401, 'Sessão inválida ou expirada.');
  next();
}

function audit(req, action, entity, title, description, snapshot) {
  const entry = { id: id(), accountId: req.user.accountId, entity, action, title, description, actor: req.user.name, createdAt: now() };
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

app.get('/api/bootstrap', requireAuth, (req, res) => res.json({ admin: publicUser(req.user), users: data.users.map(publicUser), clients: data.clients, tickets: data.tickets, audit: data.audit }));
app.get('/api/auth/status', (req, res) => res.json({ hasAdmin: data.users.length > 0 }));
app.post('/api/auth/register', rateLimit, async (req, res) => {
  const name = text(req.body?.name, 160);
  const email = text(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return fail(res, 400, 'Nome, e-mail válido e senha com pelo menos 12 caracteres são obrigatórios.');
  if (data.users.some(user => user.email === email)) return fail(res, 409, 'Este e-mail já está cadastrado.');
  const userId = id();
  const user = { id: userId, accountId: userId, name, email, passwordHash: hashPassword(password), role: 'admin', createdAt: now() };
  data.users.push(user);
  const token = id();
  await saveSession(token, user.id);
  audit({ user }, 'create', 'admin', 'Acesso administrativo criado', 'Primeiro usuário administrativo cadastrado.');
  await persist(user.accountId);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(201).json({ admin: publicUser(user) });
});
app.post('/api/auth/login', rateLimit, async (req, res) => {
  const email = text(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = data.users.find(item => item.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) return fail(res, 401, 'E-mail ou senha incorretos.');
  const token = id();
  await saveSession(token, user.id);
  audit({ user }, 'login', 'admin', 'Login realizado', 'Usuário entrou no painel.');
  await persist(user.accountId);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ admin: publicUser(user) });
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|; )techfix_session=([^;]+)/)?.[1];
  if (token) await deleteSession(token);
  audit(req, 'logout', 'admin', 'Sessão encerrada', 'Administrador saiu do painel.');
  await persist();
  res.setHeader('Set-Cookie', 'techfix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
  res.status(204).end();
});

app.post('/api/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return fail(res, 403, 'Somente administradores podem criar usuários.');
  const name = text(req.body?.name, 160);
  const email = text(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role === 'admin' ? 'admin' : 'operator';
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return fail(res, 400, 'Nome, e-mail válido e senha com pelo menos 12 caracteres são obrigatórios.');
  if (data.users.some(user => user.email === email)) return fail(res, 409, 'Este e-mail já está cadastrado.');
  const user = { id: id(), accountId: req.user.accountId, name, email, passwordHash: hashPassword(password), role, createdAt: now() };
  data.users.push(user);
  const entry = audit(req, 'create', 'admin', user.name, `Usuário ${role === 'admin' ? 'administrador' : 'operador'} criado.`, { id: user.id, name, email, role });
  await persist(req.user.accountId);
  res.status(201).json({ user: publicUser(user), audit: entry });
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  const saved = clientPayload({ ...req.body, id: req.params.id });
  if (!saved) return fail(res, 400, 'Dados do cliente inválidos.');
  const index = data.clients.findIndex(item => item.id === saved.id && item.accountId === req.user.accountId);
  if (data.clients.some(item => item.id === saved.id) && index < 0) return fail(res, 404, 'Cliente não encontrado.');
  saved.accountId = req.user.accountId;
  const exists = index >= 0;
  if (exists) saved.createdAt = data.clients[index].createdAt;
  if (exists) data.clients[index] = saved; else data.clients.push(saved);
  const entry = audit(req, exists ? 'update' : 'create', 'client', saved.name, exists ? 'Cadastro do cliente atualizado.' : 'Novo cliente cadastrado.', saved);
  await persist(req.user.accountId);
  res.json({ record: saved, audit: entry });
});
app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  const index = data.clients.findIndex(item => item.id === req.params.id && item.accountId === req.user.accountId);
  if (index < 0) return fail(res, 404, 'Cliente não encontrado.');
  const [removed] = data.clients.splice(index, 1);
  const entry = audit(req, 'delete', 'client', removed.name, 'Cliente removido da carteira.', removed);
  await persist(req.user.accountId);
  res.json({ audit: entry });
});
app.put('/api/tickets/:id', requireAuth, async (req, res) => {
  const saved = ticketPayload({ ...req.body, id: req.params.id }, req.user.accountId);
  if (!saved) return fail(res, 400, 'Dados do atendimento inválidos.');
  const index = data.tickets.findIndex(item => item.id === saved.id && item.accountId === req.user.accountId);
  if (data.tickets.some(item => item.id === saved.id) && index < 0) return fail(res, 404, 'Atendimento não encontrado.');
  saved.accountId = req.user.accountId;
  const exists = index >= 0;
  if (exists) saved.createdAt = data.tickets[index].createdAt;
  if (exists) data.tickets[index] = saved; else data.tickets.push(saved);
  const entry = audit(req, exists ? 'update' : 'create', 'ticket', saved.id, exists ? `Atendimento de ${saved.client} atualizado.` : `Atendimento aberto para ${saved.client}.`, saved);
  await persist(req.user.accountId);
  res.json({ record: saved, audit: entry });
});
app.delete('/api/tickets/:id', requireAuth, async (req, res) => {
  const index = data.tickets.findIndex(item => item.id === req.params.id && item.accountId === req.user.accountId);
  if (index < 0) return fail(res, 404, 'Atendimento não encontrado.');
  const [removed] = data.tickets.splice(index, 1);
  const entry = audit(req, 'delete', 'ticket', removed.id, `Atendimento de ${removed.client} removido.`, removed);
  await persist(req.user.accountId);
  res.json({ audit: entry });
});
app.get('/api/backup', requireAuth, async (req, res) => {
  audit(req, 'backup', 'system', 'Backup exportado', 'Arquivo JSON gerado com clientes, atendimentos e histórico.');
  await persist(req.user.accountId);
  res.json({
    exportedAt: now(),
    admin: publicUser(req.user),
    clients: data.clients.filter(client => client.accountId === req.user.accountId),
    tickets: data.tickets.filter(ticket => ticket.accountId === req.user.accountId),
    audit: data.audit.filter(entry => entry.accountId === req.user.accountId),
  });
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
