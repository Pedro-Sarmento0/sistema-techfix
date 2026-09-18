import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Cpu,
  Database,
  Download,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Pencil,
  Phone,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuditEntry } from './database';
import { deleteRecord, getAllRecords, getRecord, putRecord, writeAudit } from './database';

type Page = 'dashboard' | 'clientes' | 'atendimentos' | 'agenda' | 'financeiro' | 'alteracoes' | 'configuracoes';
type Plan = 'Básico' | 'Premium';
type ClientStatus = 'Ativo' | 'Atrasado' | 'Suspenso';
type TicketStatus = 'Agendado' | 'Em atendimento' | 'Aguardando peça' | 'Concluído' | 'Cancelado';
type Device = { name: string; type: 'Notebook' | 'Desktop'; brand: string; model: string };
type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  plan: Plan;
  status: ClientStatus;
  nextPayment: string;
  contractStart: string;
  devices: number;
  equipment: Device[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};
type Ticket = {
  id: string;
  clientId: string;
  client: string;
  device: string;
  type: 'Presencial' | 'Remoto';
  issue: string;
  status: TicketStatus;
  date: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
type Admin = { id: 'main'; name: string; email: string; password: string };

const keys = {
  admin: 'techfix-admin',
  session: 'techfix-session',
  clients: 'techfix-clients',
  tickets: 'techfix-tickets',
};

const plans: Record<Plan, { price: number; devices: number }> = {
  Básico: { price: 39.9, devices: 1 },
  Premium: { price: 79.9, devices: 3 },
};

const clientStatuses: ClientStatus[] = ['Ativo', 'Atrasado', 'Suspenso'];
const ticketStatuses: TicketStatus[] = ['Agendado', 'Em atendimento', 'Aguardando peça', 'Concluído', 'Cancelado'];

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const todayInput = () => dateInputValue(new Date());
const createId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function readLegacy<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseLocalDate(value: string) {
  if (!value) return null;
  return new Date(value.length === 10 ? `${value}T00:00:00` : value);
}

function formatDate(value: string) {
  const date = parseLocalDate(value);
  return date ? date.toLocaleDateString('pt-BR') : 'Sem data';
}

function formatDateTime(value: string) {
  const date = parseLocalDate(value);
  return date ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem data';
}

function formatTime(value: string) {
  const date = parseLocalDate(value);
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
}

function formatMonth(value: string) {
  const date = parseLocalDate(value);
  return date ? date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase() : '--';
}

function nextPaymentDate(value: string) {
  const base = parseLocalDate(value) ?? new Date();
  base.setMonth(base.getMonth() + 1);
  return dateInputValue(base);
}

function statusClass(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function sortAudit(entries: AuditEntry[]) {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeAdmin(value: Partial<Admin>): Admin {
  return {
    id: 'main',
    name: value.name?.trim() || 'Administrador',
    email: value.email?.trim() || '',
    password: value.password || '',
  };
}

function normalizeClient(value: Partial<Client>): Client {
  const equipment: Device[] = Array.isArray(value.equipment)
    ? value.equipment.map(item => ({
        name: item.name || 'Equipamento',
        type: item.type === 'Desktop' ? 'Desktop' : 'Notebook',
        brand: item.brand || '',
        model: item.model || '',
      }))
    : [];
  const now = new Date().toISOString();
  const plan: Plan = value.plan === 'Premium' ? 'Premium' : 'Básico';
  const status = clientStatuses.includes(value.status as ClientStatus) ? (value.status as ClientStatus) : 'Ativo';

  return {
    id: value.id || createId(),
    name: value.name || 'Cliente sem nome',
    email: value.email || '',
    phone: value.phone || '',
    address: value.address || '',
    plan,
    status,
    nextPayment: value.nextPayment || value.contractStart || todayInput(),
    contractStart: value.contractStart || todayInput(),
    devices: equipment.length,
    equipment,
    notes: value.notes || '',
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}

function normalizeTicket(value: Partial<Ticket>, clients: Client[]): Ticket {
  const now = new Date().toISOString();
  const client = clients.find(item => item.id === value.clientId || item.name === value.client);
  const status = ticketStatuses.includes(value.status as TicketStatus) ? (value.status as TicketStatus) : 'Agendado';

  return {
    id: value.id || `#${String(Date.now()).slice(-5)}`,
    clientId: value.clientId || client?.id || '',
    client: value.client || client?.name || 'Cliente não informado',
    device: value.device || '',
    type: value.type === 'Remoto' ? 'Remoto' : 'Presencial',
    issue: value.issue || '',
    status,
    date: value.date || '',
    notes: value.notes || '',
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}

function Header({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = 'teal' }: { icon: LucideIcon; label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <div className={`stat-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="empty">
      <Icon size={18} />
      {text}
    </div>
  );
}

function Splash() {
  return (
    <main className="splash">
      <div className="brand-mark">TF</div>
      <strong>Carregando banco de dados</strong>
      <span>Preparando clientes, chamados e histórico.</span>
    </main>
  );
}

function Login({ storedAdmin, onLogin }: { storedAdmin: Admin | null; onLogin: (admin: Admin, isNew: boolean) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const hasAdmin = Boolean(storedAdmin);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!form.email.includes('@')) return setError('Informe um e-mail válido.');
    if (form.password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');

    if (hasAdmin) {
      if (!storedAdmin || storedAdmin.email !== form.email.trim() || storedAdmin.password !== form.password) {
        return setError('E-mail ou senha incorretos.');
      }
      setSaving(true);
      await onLogin(storedAdmin, false);
      return;
    }

    if (!form.name.trim()) return setError('Informe seu nome.');

    setSaving(true);
    await onLogin(normalizeAdmin({ name: form.name, email: form.email, password: form.password }), true);
  }

  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="brand-mark">TF</div>
        <p className="eyebrow">TECHFIX INFORMÁTICA</p>
        <h1>Gestão técnica com dados salvos.</h1>
        <p className="login-copy">Clientes, chamados, agenda, financeiro e histórico em um painel direto para operar todos os dias.</p>
        <div className="login-art-footer">
          <Database size={16} />
          Banco local IndexedDB ativo
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <span className="mobile-brand">TECHFIX</span>
          <h2>{hasAdmin ? 'Entrar no painel' : 'Criar acesso administrativo'}</h2>
          <p>{hasAdmin ? 'Use suas credenciais para continuar.' : 'Cadastre o primeiro acesso. A partir daqui tudo fica salvo no banco local.'}</p>
          <form onSubmit={submit}>
            {!hasAdmin && (
              <label>
                Nome completo
                <input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Seu nome" />
              </label>
            )}
            <label>
              E-mail
              <input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="voce@empresa.com" />
            </label>
            <label>
              Senha
              <input required type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Mínimo de 6 caracteres" />
            </label>
            {error && (
              <div className="form-error">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <button className="primary full" disabled={saving}>
              {saving ? 'Acessando...' : hasAdmin ? 'Acessar painel' : 'Criar e acessar'}
              <ArrowRight size={17} />
            </button>
          </form>
          <small>As alterações ficam gravadas neste navegador e aparecem no histórico.</small>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [storedAdmin, setStoredAdmin] = useState<Admin | null>(null);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    async function boot() {
      try {
        let savedAdmin = (await getRecord<Admin>('admin', 'main')) ?? null;
        let savedClients = (await getAllRecords<Client>('clients')).map(normalizeClient);
        let savedTickets = (await getAllRecords<Ticket>('tickets')).map(ticket => normalizeTicket(ticket, savedClients));

        const legacyAdmin = readLegacy<Partial<Admin> | null>(keys.admin, null);
        if (!savedAdmin && legacyAdmin) {
          savedAdmin = normalizeAdmin(legacyAdmin);
          await putRecord('admin', savedAdmin);
          await writeAudit({
            entity: 'system',
            action: 'migrate',
            title: 'Administrador migrado',
            description: 'Dados antigos do localStorage foram importados para o banco local.',
            actor: 'Sistema',
          });
        }

        if (!savedClients.length) {
          const legacyClients = readLegacy<Partial<Client>[]>(keys.clients, []);
          if (legacyClients.length) {
            savedClients = legacyClients.map(normalizeClient);
            await Promise.all(savedClients.map(client => putRecord('clients', client)));
            await writeAudit({
              entity: 'system',
              action: 'migrate',
              title: 'Clientes migrados',
              description: `${savedClients.length} cliente(s) importado(s) para o banco local.`,
              actor: 'Sistema',
            });
          }
        }

        if (!savedTickets.length) {
          const legacyTickets = readLegacy<Partial<Ticket>[]>(keys.tickets, []);
          if (legacyTickets.length) {
            savedTickets = legacyTickets.map(ticket => normalizeTicket(ticket, savedClients));
            await Promise.all(savedTickets.map(ticket => putRecord('tickets', ticket)));
            await writeAudit({
              entity: 'system',
              action: 'migrate',
              title: 'Atendimentos migrados',
              description: `${savedTickets.length} atendimento(s) importado(s) para o banco local.`,
              actor: 'Sistema',
            });
          }
        }

        const savedAudit = await getAllRecords<AuditEntry>('audit');
        const sessionActive = Boolean(localStorage.getItem(keys.session));

        setStoredAdmin(savedAdmin);
        setAdmin(sessionActive && savedAdmin ? savedAdmin : null);
        setClients(savedClients.sort((a, b) => a.name.localeCompare(b.name)));
        setTickets(savedTickets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setAudit(sortAudit(savedAudit));
      } catch (error) {
        console.error(error);
        setBootError('Não foi possível abrir o banco de dados local do navegador.');
      } finally {
        setBooting(false);
      }
    }

    void boot();
  }, []);

  async function recordAudit(entry: Omit<AuditEntry, 'id' | 'createdAt' | 'actor'> & { actor?: string }) {
    const saved = await writeAudit({
      ...entry,
      actor: entry.actor ?? admin?.name ?? storedAdmin?.name ?? 'Sistema',
    });
    setAudit(previous => sortAudit([saved, ...previous]));
    return saved;
  }

  async function handleLogin(value: Admin, isNew: boolean) {
    if (isNew) await putRecord('admin', value);
    localStorage.setItem(keys.session, 'active');
    setStoredAdmin(value);
    setAdmin(value);
    const saved = await writeAudit({
      entity: 'admin',
      action: isNew ? 'create' : 'login',
      title: isNew ? 'Acesso administrativo criado' : 'Login realizado',
      description: isNew ? 'Primeiro usuário administrativo cadastrado.' : 'Administrador entrou no painel.',
      actor: value.name,
    });
    setAudit(previous => sortAudit([saved, ...previous]));
  }

  async function logout() {
    localStorage.removeItem(keys.session);
    await recordAudit({
      entity: 'admin',
      action: 'logout',
      title: 'Sessão encerrada',
      description: 'Administrador saiu do painel.',
    });
    setAdmin(null);
  }

  async function saveClient(client: Client) {
    const exists = clients.some(item => item.id === client.id);
    const now = new Date().toISOString();
    const saved = normalizeClient({
      ...client,
      devices: client.equipment.length,
      createdAt: client.createdAt || now,
      updatedAt: now,
    });

    await putRecord('clients', saved);
    setClients(previous => {
      const next = exists ? previous.map(item => (item.id === saved.id ? saved : item)) : [...previous, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    await recordAudit({
      entity: 'client',
      action: exists ? 'update' : 'create',
      title: saved.name,
      description: exists ? 'Cadastro do cliente atualizado.' : 'Novo cliente cadastrado.',
      snapshot: saved,
    });
  }

  async function deleteClient(client: Client) {
    if (!window.confirm(`Excluir o cliente ${client.name}? Os atendimentos antigos continuarão no histórico.`)) return;
    await deleteRecord('clients', client.id);
    setClients(previous => previous.filter(item => item.id !== client.id));
    await recordAudit({
      entity: 'client',
      action: 'delete',
      title: client.name,
      description: 'Cliente removido da carteira.',
      snapshot: client,
    });
  }

  async function saveTicket(ticket: Ticket) {
    const exists = tickets.some(item => item.id === ticket.id);
    const now = new Date().toISOString();
    const client = clients.find(item => item.id === ticket.clientId);
    const saved = normalizeTicket(
      {
        ...ticket,
        client: client?.name ?? ticket.client,
        createdAt: ticket.createdAt || now,
        updatedAt: now,
      },
      clients,
    );

    await putRecord('tickets', saved);
    setTickets(previous => {
      const next = exists ? previous.map(item => (item.id === saved.id ? saved : item)) : [...previous, saved];
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
    await recordAudit({
      entity: 'ticket',
      action: exists ? 'update' : 'create',
      title: saved.id,
      description: exists ? `Atendimento de ${saved.client} atualizado.` : `Atendimento aberto para ${saved.client}.`,
      snapshot: saved,
    });
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`Excluir o atendimento ${ticket.id}?`)) return;
    await deleteRecord('tickets', ticket.id);
    setTickets(previous => previous.filter(item => item.id !== ticket.id));
    await recordAudit({
      entity: 'ticket',
      action: 'delete',
      title: ticket.id,
      description: `Atendimento de ${ticket.client} removido.`,
      snapshot: ticket,
    });
  }

  async function markClientPaid(client: Client) {
    await saveClient({
      ...client,
      status: 'Ativo',
      nextPayment: nextPaymentDate(client.nextPayment || todayInput()),
    });
  }

  async function exportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      admin: admin ? { name: admin.name, email: admin.email } : null,
      clients,
      tickets,
      audit,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `techfix-backup-${todayInput()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    await recordAudit({
      entity: 'system',
      action: 'backup',
      title: 'Backup exportado',
      description: 'Arquivo JSON gerado com clientes, atendimentos e histórico.',
    });
  }

  if (booting) return <Splash />;

  if (bootError) {
    return (
      <main className="splash">
        <AlertCircle size={28} />
        <strong>Erro no banco de dados</strong>
        <span>{bootError}</span>
      </main>
    );
  }

  if (!admin) return <Login storedAdmin={storedAdmin} onLogin={handleLogin} />;

  const nav: [Page, LucideIcon, string][] = [
    ['dashboard', LayoutDashboard, 'Dashboard'],
    ['clientes', Users, 'Clientes'],
    ['atendimentos', Wrench, 'Atendimentos'],
    ['agenda', CalendarDays, 'Agenda'],
    ['financeiro', CircleDollarSign, 'Financeiro'],
    ['alteracoes', History, 'Alterações'],
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Abrir menu">
          <Menu size={20} />
        </button>
        <div className="top-brand">
          <div className="brand-mark small">TF</div>
          <strong>
            Techfix <span>Informática</span>
          </strong>
        </div>
        <div className="db-chip" title="Banco local do navegador">
          <Database size={15} />
          Dados salvos
        </div>
        <div className="top-user">
          <UserRound size={16} />
          <span>{admin.name}</span>
          <button onClick={logout} title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
        <div className="side-label">PAINEL ADMINISTRATIVO</div>
        <nav>
          {nav.map(([key, Icon, label]) => (
            <button
              key={key}
              className={page === key ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setPage(key);
                setMobileOpen(false);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <button
          className={page === 'configuracoes' ? 'nav-item active side-bottom' : 'nav-item side-bottom'}
          onClick={() => {
            setPage('configuracoes');
            setMobileOpen(false);
          }}
        >
          <Settings size={17} />
          Configurações
        </button>
      </aside>

      <main className="content">
        {page === 'dashboard' && <Dashboard clients={clients} tickets={tickets} audit={audit} onNavigate={setPage} />}
        {page === 'clientes' && <Clients clients={clients} onSave={saveClient} onDelete={deleteClient} />}
        {page === 'atendimentos' && <Tickets tickets={tickets} clients={clients} onSave={saveTicket} onDelete={deleteTicket} />}
        {page === 'agenda' && <Agenda tickets={tickets} onEdit={saveTicket} clients={clients} />}
        {page === 'financeiro' && <Finance clients={clients} tickets={tickets} onMarkPaid={markClientPaid} onSaveClient={saveClient} />}
        {page === 'alteracoes' && <Changes audit={audit} />}
        {page === 'configuracoes' && <SettingsPage admin={admin} clients={clients} tickets={tickets} audit={audit} onBackup={exportBackup} />}
      </main>
    </div>
  );
}

function Dashboard({ clients, tickets, audit, onNavigate }: { clients: Client[]; tickets: Ticket[]; audit: AuditEntry[]; onNavigate: (page: Page) => void }) {
  const active = clients.filter(client => client.status === 'Ativo');
  const revenue = active.reduce((sum, client) => sum + plans[client.plan].price, 0);
  const openTickets = tickets.filter(ticket => !['Concluído', 'Cancelado'].includes(ticket.status));
  const scheduled = tickets
    .filter(ticket => ticket.status === 'Agendado')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, 4);
  const attention = clients.filter(client => client.status !== 'Ativo').slice(0, 5);

  return (
    <>
      <Header
        eyebrow="VISÃO GERAL"
        title="Dashboard"
        subtitle="Resumo operacional com dados salvos no banco local."
        action={
          <button className="primary" onClick={() => onNavigate('clientes')}>
            <Plus size={17} />
            Cadastrar cliente
          </button>
        }
      />

      <div className="stats-grid">
        <Stat icon={Users} label="Clientes ativos" value={String(active.length)} />
        <Stat icon={CircleDollarSign} label="Receita mensal" value={money(revenue)} tone="green" />
        <Stat icon={Wrench} label="Chamados abertos" value={String(openTickets.length)} tone="orange" />
        <Stat icon={History} label="Alterações salvas" value={String(audit.length)} tone="blue" />
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Próximos atendimentos</h3>
            <button className="link-button" onClick={() => onNavigate('agenda')}>
              Ver agenda <ArrowRight size={14} />
            </button>
          </div>
          {scheduled.map(ticket => (
            <div className="mini-row" key={ticket.id}>
              <div className="date-box">
                <b>{ticket.date ? parseLocalDate(ticket.date)?.getDate() : '--'}</b>
                <small>{formatMonth(ticket.date)}</small>
              </div>
              <div>
                <strong>{ticket.client}</strong>
                <span>
                  {ticket.device || 'Equipamento não informado'} · {formatTime(ticket.date)}
                </span>
              </div>
              <span className={`status ${statusClass(ticket.status)}`}>{ticket.status}</span>
            </div>
          ))}
          {!scheduled.length && <Empty icon={CalendarDays} text="Nenhum atendimento agendado." />}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Planos contratados</h3>
            <button className="link-button" onClick={() => onNavigate('clientes')}>
              Ver clientes <ArrowRight size={14} />
            </button>
          </div>
          <PlanBar label="Básico" count={clients.filter(client => client.plan === 'Básico').length} total={clients.length} />
          <PlanBar label="Premium" count={clients.filter(client => client.plan === 'Premium').length} total={clients.length} premium />
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Assinaturas com atenção</h3>
            <button className="link-button" onClick={() => onNavigate('financeiro')}>
              Abrir financeiro <ArrowRight size={14} />
            </button>
          </div>
          {attention.map(client => (
            <div className="attention-row" key={client.id}>
              <AlertCircle size={17} />
              <strong>{client.name}</strong>
              <span>
                {client.status} · vencimento {formatDate(client.nextPayment)}
              </span>
            </div>
          ))}
          {!attention.length && <Empty icon={Check} text="Nenhuma assinatura pendente." />}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Últimas alterações</h3>
            <button className="link-button" onClick={() => onNavigate('alteracoes')}>
              Ver histórico <ArrowRight size={14} />
            </button>
          </div>
          {audit.slice(0, 5).map(entry => (
            <div className="audit-mini" key={entry.id}>
              <History size={15} />
              <div>
                <strong>{entry.title}</strong>
                <span>{entry.description}</span>
              </div>
              <small>{formatDateTime(entry.createdAt)}</small>
            </div>
          ))}
          {!audit.length && <Empty icon={History} text="Nenhuma alteração registrada ainda." />}
        </section>
      </div>
    </>
  );
}

function PlanBar({ label, count, total, premium = false }: { label: Plan; count: number; total: number; premium?: boolean }) {
  return (
    <div className="plan-bar">
      <div>
        <span>{label}</span>
        <b>
          {count} cliente{count === 1 ? '' : 's'}
        </b>
      </div>
      <div className="bar">
        <i className={premium ? 'premium' : ''} style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function Clients({ clients, onSave, onDelete }: { clients: Client[]; onSave: (client: Client) => Promise<void>; onDelete: (client: Client) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | 'Todos'>('Todos');
  const [modalClient, setModalClient] = useState<Client | null | 'new'>(null);

  const visible = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter(client => {
      const matchesSearch = [client.name, client.email, client.phone, client.address].some(value => value.toLowerCase().includes(term));
      const matchesStatus = status === 'Todos' || client.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [clients, search, status]);

  return (
    <>
      <Header
        eyebrow="CARTEIRA"
        title="Clientes"
        subtitle="Cadastre, edite e acompanhe planos, equipamentos e pagamentos."
        action={
          <button className="primary" onClick={() => setModalClient('new')}>
            <Plus size={17} />
            Cadastrar cliente
          </button>
        }
      />

      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail, telefone ou endereço" />
        </div>
        <div className="filter-row">
          <SlidersHorizontal size={16} />
          <select value={status} onChange={event => setStatus(event.target.value as ClientStatus | 'Todos')}>
            <option>Todos</option>
            {clientStatuses.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <span className="result-count">{visible.length} cliente(s)</span>
        </div>
      </div>

      <section className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contato</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Pagamento</th>
                <th>Equipamentos</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(client => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                    <small>{client.address || 'Endereço não informado'}</small>
                  </td>
                  <td>
                    <span className="inline-info">
                      <Mail size={13} />
                      {client.email || 'Sem e-mail'}
                    </span>
                    <small>
                      <Phone size={12} />
                      {client.phone || 'Sem telefone'}
                    </small>
                  </td>
                  <td>
                    <span className="plan-pill">{client.plan}</span>
                    <small>{money(plans[client.plan].price)}/mês</small>
                  </td>
                  <td>
                    <span className={`status ${statusClass(client.status)}`}>{client.status}</span>
                  </td>
                  <td>{formatDate(client.nextPayment)}</td>
                  <td>
                    <div className="device-count">
                      {client.devices}/{plans[client.plan].devices}
                      <div className="tiny-bar">
                        <i style={{ width: `${Math.min(100, (client.devices / plans[client.plan].devices) * 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="action-group">
                      <button className="icon-button" title="Editar cliente" onClick={() => setModalClient(client)}>
                        <Pencil size={16} />
                      </button>
                      <button className="icon-button danger" title="Excluir cliente" onClick={() => void onDelete(client)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <Empty icon={Users} text="Nenhum cliente encontrado." />}
      </section>

      {modalClient && (
        <ClientModal
          client={modalClient === 'new' ? null : modalClient}
          onClose={() => setModalClient(null)}
          onSave={async client => {
            await onSave(client);
            setModalClient(null);
          }}
        />
      )}
    </>
  );
}

function ClientModal({ client, onClose, onSave }: { client: Client | null; onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const now = new Date().toISOString();
  const [form, setForm] = useState<Client>(
    client ?? {
      id: createId(),
      name: '',
      email: '',
      phone: '',
      address: '',
      plan: 'Básico',
      status: 'Ativo',
      contractStart: todayInput(),
      nextPayment: todayInput(),
      devices: 0,
      equipment: [],
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  );
  const [deviceForm, setDeviceForm] = useState<Device>({ name: '', type: 'Notebook', brand: '', model: '' });
  const [saving, setSaving] = useState(false);
  const limit = plans[form.plan].devices;

  function update<K extends keyof Client>(field: K, value: Client[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function addEquipment() {
    if (!deviceForm.name.trim() || form.equipment.length >= limit) return;
    update('equipment', [...form.equipment, { ...deviceForm, name: deviceForm.name.trim() }]);
    setDeviceForm({ name: '', type: 'Notebook', brand: '', model: '' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await onSave({
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      devices: form.equipment.length,
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal client-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{client ? 'EDITAR CLIENTE' : 'NOVO CLIENTE'}</span>
            <h2>{client ? 'Atualizar cliente' : 'Cadastrar cliente'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="form-grid">
          <label>
            Nome completo
            <input required value={form.name} onChange={event => update('name', event.target.value)} />
          </label>
          <label>
            E-mail
            <input required type="email" value={form.email} onChange={event => update('email', event.target.value)} />
          </label>
          <label>
            Telefone
            <input value={form.phone} onChange={event => update('phone', event.target.value)} />
          </label>
          <label>
            Endereço
            <input value={form.address} onChange={event => update('address', event.target.value)} />
          </label>
          <label>
            Plano
            <select
              value={form.plan}
              onChange={event => {
                const plan = event.target.value as Plan;
                setForm(current => ({
                  ...current,
                  plan,
                  equipment: current.equipment.slice(0, plans[plan].devices),
                }));
              }}
            >
              <option value="Básico">Básico · {money(plans.Básico.price)}</option>
              <option value="Premium">Premium · {money(plans.Premium.price)}</option>
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={event => update('status', event.target.value as ClientStatus)}>
              {clientStatuses.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Início do contrato
            <input required type="date" value={form.contractStart} onChange={event => update('contractStart', event.target.value)} />
          </label>
          <label>
            Próximo pagamento
            <input required type="date" value={form.nextPayment} onChange={event => update('nextPayment', event.target.value)} />
          </label>
        </div>

        <section className="equipment-box">
          <div className="equipment-heading">
            <div>
              <h3>Computadores do cliente</h3>
              <span>
                {form.equipment.length}/{limit} no plano {form.plan}
              </span>
            </div>
          </div>

          {form.equipment.length > 0 && (
            <div className="equipment-list">
              {form.equipment.map((item, index) => (
                <div className="equipment-item" key={`${item.name}-${index}`}>
                  <Cpu size={16} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.type} · {item.brand || 'Marca não informada'} {item.model}
                    </small>
                  </span>
                  <button type="button" className="icon-button" onClick={() => update('equipment', form.equipment.filter((_, itemIndex) => itemIndex !== index))} title="Remover equipamento">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="equipment-fields">
            <input value={deviceForm.name} onChange={event => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Nome do equipamento" />
            <select value={deviceForm.type} onChange={event => setDeviceForm({ ...deviceForm, type: event.target.value as Device['type'] })}>
              <option>Notebook</option>
              <option>Desktop</option>
            </select>
            <input value={deviceForm.brand} onChange={event => setDeviceForm({ ...deviceForm, brand: event.target.value })} placeholder="Marca" />
            <input value={deviceForm.model} onChange={event => setDeviceForm({ ...deviceForm, model: event.target.value })} placeholder="Modelo" />
            <button type="button" className="secondary add-equipment" disabled={form.equipment.length >= limit || !deviceForm.name.trim()} onClick={addEquipment}>
              <Plus size={17} />
              Adicionar
            </button>
          </div>
          {form.equipment.length >= limit && <small className="limit-message">Limite de equipamentos deste plano atingido.</small>}
        </section>

        <label className="notes-field">
          Observações
          <textarea value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Preferências, histórico rápido ou instruções internas" />
        </label>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={saving}>
            <Save size={17} />
            {saving ? 'Salvando...' : 'Salvar cliente'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Tickets({ tickets, clients, onSave, onDelete }: { tickets: Ticket[]; clients: Client[]; onSave: (ticket: Ticket) => Promise<void>; onDelete: (ticket: Ticket) => Promise<void> }) {
  const [modalTicket, setModalTicket] = useState<Ticket | null | 'new'>(null);
  const [status, setStatus] = useState<TicketStatus | 'Todos'>('Todos');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const term = search.toLowerCase();
    return tickets.filter(ticket => {
      const matchesSearch = [ticket.id, ticket.client, ticket.device, ticket.issue].some(value => value.toLowerCase().includes(term));
      const matchesStatus = status === 'Todos' || ticket.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [search, status, tickets]);

  return (
    <>
      <Header
        eyebrow="OPERAÇÃO"
        title="Atendimentos"
        subtitle="Abra chamados, atualize status e mantenha a rotina técnica rastreável."
        action={
          <button className="primary" onClick={() => setModalTicket('new')}>
            <Plus size={17} />
            Novo atendimento
          </button>
        }
      />

      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente, equipamento, chamado ou problema" />
        </div>
        <div className="filter-row">
          <SlidersHorizontal size={16} />
          <select value={status} onChange={event => setStatus(event.target.value as TicketStatus | 'Todos')}>
            <option>Todos</option>
            {ticketStatuses.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <span className="result-count">{visible.length} chamado(s)</span>
        </div>
      </div>

      <section className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chamado</th>
                <th>Cliente</th>
                <th>Equipamento</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Agendamento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(ticket => (
                <tr key={ticket.id}>
                  <td>
                    <strong>{ticket.id}</strong>
                    <small>{ticket.issue || 'Sem descrição'}</small>
                  </td>
                  <td>{ticket.client}</td>
                  <td>{ticket.device || 'Não informado'}</td>
                  <td>{ticket.type}</td>
                  <td>
                    <span className={`status ${statusClass(ticket.status)}`}>{ticket.status}</span>
                  </td>
                  <td>{formatDateTime(ticket.date)}</td>
                  <td>
                    <div className="action-group">
                      <button className="icon-button" title="Editar atendimento" onClick={() => setModalTicket(ticket)}>
                        <Pencil size={16} />
                      </button>
                      <button className="icon-button danger" title="Excluir atendimento" onClick={() => void onDelete(ticket)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <Empty icon={ClipboardList} text="Nenhum atendimento encontrado." />}
      </section>

      {modalTicket && (
        <TicketModal
          ticket={modalTicket === 'new' ? null : modalTicket}
          clients={clients}
          onClose={() => setModalTicket(null)}
          onSave={async ticket => {
            await onSave(ticket);
            setModalTicket(null);
          }}
        />
      )}
    </>
  );
}

function TicketModal({ ticket, clients, onClose, onSave }: { ticket: Ticket | null; clients: Client[]; onClose: () => void; onSave: (ticket: Ticket) => Promise<void> }) {
  const firstClient = clients[0];
  const now = new Date().toISOString();
  const [form, setForm] = useState<Ticket>(
    ticket ?? {
      id: `#${String(Date.now()).slice(-5)}`,
      clientId: firstClient?.id || '',
      client: firstClient?.name || '',
      device: firstClient?.equipment[0]?.name || '',
      type: 'Presencial',
      issue: '',
      status: 'Agendado',
      date: '',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  );
  const [saving, setSaving] = useState(false);
  const selectedClient = clients.find(client => client.id === form.clientId);
  const currentDevices = selectedClient?.equipment ?? [];
  const hasUnknownDevice = form.device && !currentDevices.some(device => device.name === form.device);

  function update<K extends keyof Ticket>(field: K, value: Ticket[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clients.length) return;
    setSaving(true);
    await onSave({
      ...form,
      client: selectedClient?.name || form.client,
      issue: form.issue.trim(),
      device: form.device.trim(),
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{ticket ? 'EDITAR CHAMADO' : 'NOVO CHAMADO'}</span>
            <h2>{ticket ? 'Atualizar atendimento' : 'Solicitar atendimento'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>

        {clients.length ? (
          <div className="form-grid">
            <label>
              Cliente
              <select
                value={form.clientId}
                onChange={event => {
                  const client = clients.find(item => item.id === event.target.value);
                  setForm(current => ({
                    ...current,
                    clientId: client?.id || '',
                    client: client?.name || '',
                    device: client?.equipment[0]?.name || '',
                  }));
                }}
              >
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Equipamento
              {currentDevices.length ? (
                <select value={form.device} onChange={event => update('device', event.target.value)}>
                  <option value="">Selecione</option>
                  {hasUnknownDevice && <option value={form.device}>{form.device}</option>}
                  {currentDevices.map(device => (
                    <option key={`${device.name}-${device.model}`} value={device.name}>
                      {device.name} · {device.type}
                    </option>
                  ))}
                </select>
              ) : (
                <input required value={form.device} onChange={event => update('device', event.target.value)} placeholder="Notebook Dell" />
              )}
            </label>
            <label>
              Tipo
              <select value={form.type} onChange={event => update('type', event.target.value as Ticket['type'])}>
                <option>Presencial</option>
                <option>Remoto</option>
              </select>
            </label>
            <label>
              Status
              <select value={form.status} onChange={event => update('status', event.target.value as TicketStatus)}>
                {ticketStatuses.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Data agendada
              <input type="datetime-local" value={form.date} onChange={event => update('date', event.target.value)} />
            </label>
            <label className="full-field">
              Problema / descrição
              <textarea required value={form.issue} onChange={event => update('issue', event.target.value)} />
            </label>
            <label className="full-field">
              Observações técnicas
              <textarea value={form.notes} onChange={event => update('notes', event.target.value)} />
            </label>
          </div>
        ) : (
          <Empty icon={Users} text="Cadastre um cliente antes de abrir um atendimento." />
        )}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          {clients.length > 0 && (
            <button className="primary" disabled={saving}>
              <Save size={17} />
              {saving ? 'Salvando...' : 'Salvar chamado'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Agenda({ tickets, clients, onEdit }: { tickets: Ticket[]; clients: Client[]; onEdit: (ticket: Ticket) => Promise<void> }) {
  const [editing, setEditing] = useState<Ticket | null>(null);
  const scheduled = tickets
    .filter(ticket => ticket.status === 'Agendado' || ticket.status === 'Em atendimento')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return (
    <>
      <Header eyebrow="ROTINA" title="Agenda" subtitle="Visualize os próximos atendimentos e ajuste chamados rapidamente." />
      <section className="agenda-list">
        {scheduled.map(ticket => (
          <div className="agenda-card" key={ticket.id}>
            <div className="agenda-time">
              <b>{formatTime(ticket.date)}</b>
              <span>{formatDate(ticket.date)}</span>
            </div>
            <div className="agenda-detail">
              <span className={`status ${statusClass(ticket.status)}`}>{ticket.status}</span>
              <h3>{ticket.client}</h3>
              <p>
                <Cpu size={14} /> {ticket.device || 'Equipamento não informado'} · {ticket.issue || 'Sem descrição'}
              </p>
            </div>
            <button className="secondary" onClick={() => setEditing(ticket)}>
              <Pencil size={16} />
              Editar
            </button>
          </div>
        ))}
        {!scheduled.length && (
          <section className="panel">
            <Empty icon={CalendarDays} text="A agenda está vazia." />
          </section>
        )}
      </section>

      {editing && (
        <TicketModal
          ticket={editing}
          clients={clients}
          onClose={() => setEditing(null)}
          onSave={async ticket => {
            await onEdit(ticket);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Finance({ clients, tickets, onMarkPaid, onSaveClient }: { clients: Client[]; tickets: Ticket[]; onMarkPaid: (client: Client) => Promise<void>; onSaveClient: (client: Client) => Promise<void> }) {
  const active = clients.filter(client => client.status === 'Ativo');
  const revenue = active.reduce((sum, client) => sum + plans[client.plan].price, 0);
  const overdue = clients.filter(client => client.status === 'Atrasado');
  const doneTickets = tickets.filter(ticket => ticket.status === 'Concluído');

  return (
    <>
      <Header eyebrow="CONTROLE" title="Financeiro" subtitle="Mensalidades, inadimplência e ações rápidas de cobrança." />
      <div className="stats-grid">
        <Stat icon={CircleDollarSign} label="Receita recorrente" value={money(revenue)} tone="green" />
        <Stat icon={BadgeCheck} label="Assinaturas ativas" value={String(active.length)} />
        <Stat icon={AlertCircle} label="Clientes atrasados" value={String(overdue.length)} tone="red" />
        <Stat icon={CheckCircle2} label="Serviços concluídos" value={String(doneTickets.length)} tone="blue" />
      </div>

      <section className="panel finance-list">
        <div className="panel-head">
          <h3>Mensalidades</h3>
          <span className="result-count">{clients.length} registro(s)</span>
        </div>
        {clients.map(client => (
          <div className="finance-row" key={client.id}>
            <div>
              <strong>{client.name}</strong>
              <span>
                {client.plan} · vencimento {formatDate(client.nextPayment)}
              </span>
            </div>
            <strong>{money(plans[client.plan].price)}</strong>
            <span className={`status ${statusClass(client.status)}`}>{client.status}</span>
            <div className="action-group">
              <button className="secondary compact" onClick={() => void onMarkPaid(client)}>
                <RefreshCcw size={15} />
                Pago
              </button>
              <button className="icon-button" title="Marcar em atraso" onClick={() => void onSaveClient({ ...client, status: 'Atrasado' })}>
                <AlertCircle size={16} />
              </button>
            </div>
          </div>
        ))}
        {!clients.length && <Empty icon={CircleDollarSign} text="Nenhuma mensalidade para exibir." />}
      </section>
    </>
  );
}

function Changes({ audit }: { audit: AuditEntry[] }) {
  const [search, setSearch] = useState('');
  const visible = audit.filter(entry => [entry.title, entry.description, entry.actor, entry.action].some(value => value.toLowerCase().includes(search.toLowerCase())));

  return (
    <>
      <Header eyebrow="AUDITORIA" title="Alterações" subtitle="Tudo que for criado, editado, excluído ou exportado fica registrado aqui." />
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar no histórico" />
        </div>
        <span className="result-count">{visible.length} evento(s)</span>
      </div>
      <section className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ação</th>
                <th>Registro</th>
                <th>Detalhe</th>
                <th>Usuário</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(entry => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <span className={`audit-action ${entry.action}`}>{entry.action}</span>
                  </td>
                  <td>
                    <strong>{entry.title}</strong>
                    <small>{entry.entity}</small>
                  </td>
                  <td>{entry.description}</td>
                  <td>{entry.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <Empty icon={History} text="Nenhum evento encontrado." />}
      </section>
    </>
  );
}

function SettingsPage({ admin, clients, tickets, audit, onBackup }: { admin: Admin; clients: Client[]; tickets: Ticket[]; audit: AuditEntry[]; onBackup: () => Promise<void> }) {
  return (
    <>
      <Header
        eyebrow="SISTEMA"
        title="Configurações"
        subtitle="Dados do acesso, banco local e backup."
        action={
          <button className="primary" onClick={() => void onBackup()}>
            <Download size={17} />
            Exportar backup
          </button>
        }
      />
      <section className="settings-grid">
        <div className="panel settings-panel">
          <div className="settings-icon">
            <Settings size={21} />
          </div>
          <div>
            <h3>Acesso administrativo</h3>
            <p>O painel está protegido pelo acesso criado neste navegador.</p>
          </div>
          <div className="settings-line">
            <span>Nome</span>
            <strong>{admin.name}</strong>
          </div>
          <div className="settings-line">
            <span>E-mail</span>
            <strong>{admin.email}</strong>
          </div>
          <div className="settings-line">
            <span>Senha</span>
            <strong>Armazenada localmente</strong>
          </div>
        </div>

        <div className="panel settings-panel">
          <div className="settings-icon database">
            <Database size={21} />
          </div>
          <div>
            <h3>Banco de dados</h3>
            <p>Persistência feita com IndexedDB, mantendo os registros mesmo ao fechar o navegador.</p>
          </div>
          <div className="settings-line">
            <span>Clientes</span>
            <strong>{clients.length}</strong>
          </div>
          <div className="settings-line">
            <span>Atendimentos</span>
            <strong>{tickets.length}</strong>
          </div>
          <div className="settings-line">
            <span>Alterações registradas</span>
            <strong>{audit.length}</strong>
          </div>
        </div>
      </section>
    </>
  );
}

export default App;
