export type AuditEntry = {
  id: string;
  entity: 'admin' | 'client' | 'ticket' | 'system';
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'migrate' | 'backup';
  title: string;
  description: string;
  actor: string;
  createdAt: string;
  snapshot?: unknown;
};

export type Admin = { id: string; name: string; email: string; role: 'admin' | 'operator' };
export type ApiRecordResponse<T> = { record: T; audit: AuditEntry };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Não foi possível concluir a operação.');
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export function getAuthStatus() {
  return request<{ hasAdmin: boolean }>('/api/auth/status');
}

export function getBootstrap<T>() {
  return request<{ admin: Admin; users: Admin[]; clients: T[]; tickets: T[]; audit: AuditEntry[] }>('/api/bootstrap');
}

export function register(name: string, email: string, password: string) {
  return request<{ admin: Admin }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
}

export function login(email: string, password: string) {
  return request<{ admin: Admin }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function logout() {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function saveClient<T extends { id: string }>(client: T) {
  return request<ApiRecordResponse<T>>(`/api/clients/${encodeURIComponent(client.id)}`, { method: 'PUT', body: JSON.stringify(client) });
}

export function deleteClient(id: string) {
  return request<{ audit: AuditEntry }>(`/api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function saveTicket<T extends { id: string }>(ticket: T) {
  return request<ApiRecordResponse<T>>(`/api/tickets/${encodeURIComponent(ticket.id)}`, { method: 'PUT', body: JSON.stringify(ticket) });
}

export function deleteTicket(id: string) {
  return request<{ audit: AuditEntry }>(`/api/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getBackup() {
  return request<{ exportedAt: string; admin: Admin; clients: unknown[]; tickets: unknown[]; audit: AuditEntry[] }>('/api/backup');
}

export function createUser(name: string, email: string, password: string, role: Admin['role']) {
  return request<{ user: Admin; audit: AuditEntry }>('/api/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
}
