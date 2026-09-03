import { useState, useEffect, FormEvent } from 'react';
import { apiFetch, getCurrentUser } from '../lib/auth';

interface User {
  id: string;
  username: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  isBootstrapAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
}

interface Permission {
  id: string;
  name: string;
  description: string | null;
  category: string;
}

type Tab = 'users' | 'roles' | 'audit';

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const currentUser = getCurrentUser();

  useEffect(() => {
    loadData();
  }, [tab]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') {
        const [u, r] = await Promise.all([
          apiFetch<User[]>('/api/admin/users'),
          apiFetch<Role[]>('/api/admin/roles'),
        ]);
        setUsers(u);
        setRoles(r);
      } else if (tab === 'roles') {
        const [r, p] = await Promise.all([
          apiFetch<Role[]>('/api/admin/roles'),
          apiFetch<Permission[]>('/api/admin/permissions'),
        ]);
        setRoles(r);
        setPermissions(p);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          email: newEmail,
          password: newPassword,
          fullName: newFullName || undefined,
        }),
      });
      setShowCreateUser(false);
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }

  async function handleDeleteUser(id: string) {
    if (!confirm('Benutzer wirklich löschen?')) return;
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }

  async function handleToggleActive(id: string, current: boolean) {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !current }),
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }

  async function handleCreateRole(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ name: newRoleName, description: newRoleDesc || undefined }),
      });
      setShowCreateRole(false);
      setNewRoleName('');
      setNewRoleDesc('');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }

  async function handleDeleteRole(id: string) {
    if (!confirm('Rolle wirklich löschen?')) return;
    try {
      await apiFetch(`/api/admin/roles/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
          <p className="text-sm text-gray-500 mt-1">Benutzer, Rollen und Berechtigungen verwalten</p>
        </div>
        <div className="text-sm text-gray-500">
          Angemeldet als <strong>{currentUser?.username}</strong> ({currentUser?.roles.join(', ')})
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
      )}

      <div className="flex gap-2 mb-6">
        {(['users', 'roles', 'audit'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`action-button ${tab === t ? 'primary' : ''}`}
          >
            {t === 'users' ? 'Benutzer' : t === 'roles' ? 'Rollen' : 'Audit-Log'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="spinner" /></div>
      ) : tab === 'users' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="section-title">Benutzer ({users.length})</h2>
            <button className="action-button primary" onClick={() => setShowCreateUser(!showCreateUser)}>
              + Neuer Benutzer
            </button>
          </div>

          {showCreateUser && (
            <div className="panel mb-4">
              <form onSubmit={handleCreateUser} className="form-stack">
                <div className="sm:grid-cols-2 grid gap-4">
                  <div>
                    <label className="field-label">Benutzername</label>
                    <input className="field-control" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required pattern="[a-zA-Z0-9_-]+" minLength={3} />
                  </div>
                  <div>
                    <label className="field-label">E-Mail</label>
                    <input className="field-control" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                  </div>
                  <div>
                    <label className="field-label">Passwort</label>
                    <input className="field-control" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} />
                  </div>
                  <div>
                    <label className="field-label">Vollständiger Name</label>
                    <input className="field-control" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="action-button primary">Erstellen</button>
                  <button type="button" className="action-button" onClick={() => setShowCreateUser(false)}>Abbrechen</button>
                </div>
              </form>
            </div>
          )}

          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>Benutzername</th>
                  <th>E-Mail</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Letzte Anmeldung</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong>{u.isBootstrapAdmin && <span className="ml-2 text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded">Admin</span>}</td>
                    <td>{u.email}</td>
                    <td>{u.fullName || '-'}</td>
                    <td>
                      <span className={u.isActive ? 'text-green-700' : 'text-red-600'}>
                        {u.isActive ? 'Aktiv' : 'Deaktiviert'}
                      </span>
                    </td>
                    <td className="text-sm text-gray-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('de-DE') : 'Nie'}</td>
                    <td>
                      <div className="flex gap-1">
                        {!u.isBootstrapAdmin && (
                          <>
                            <button className="action-button" onClick={() => handleToggleActive(u.id, u.isActive)}>
                              {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                            </button>
                            <button className="action-button danger" onClick={() => handleDeleteUser(u.id)}>
                              Löschen
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'roles' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="section-title">Rollen ({roles.length})</h2>
            <button className="action-button primary" onClick={() => setShowCreateRole(!showCreateRole)}>
              + Neue Rolle
            </button>
          </div>

          {showCreateRole && (
            <div className="panel mb-4">
              <form onSubmit={handleCreateRole} className="form-stack">
                <div className="sm:grid-cols-2 grid gap-4">
                  <div>
                    <label className="field-label">Rollenname</label>
                    <input className="field-control" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} required pattern="[a-zA-Z0-9_-]+" />
                  </div>
                  <div>
                    <label className="field-label">Beschreibung</label>
                    <input className="field-control" value={newRoleDesc} onChange={(e) => setNewRoleDesc(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="action-button primary">Erstellen</button>
                  <button type="button" className="action-button" onClick={() => setShowCreateRole(false)}>Abbrechen</button>
                </div>
              </form>
            </div>
          )}

          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Beschreibung</th>
                  <th>System</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.description || '-'}</td>
                    <td>{r.isSystem ? 'Ja' : 'Nein'}</td>
                    <td>
                      {!r.isSystem && (
                        <button className="action-button danger" onClick={() => handleDeleteRole(r.id)}>
                          Löschen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6">
            <h3 className="section-title">Verfügbare Berechtigungen ({permissions.length})</h3>
            <div className="panel">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Beschreibung</th>
                    <th>Kategorie</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((p) => (
                    <tr key={p.id}>
                      <td><code className="text-sm">{p.name}</code></td>
                      <td>{p.description || '-'}</td>
                      <td><span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{p.category}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <h2 className="section-title mb-4">Audit-Log (Sicherheitsereignisse)</h2>
          <div className="panel muted">
            Audit-Log-Viewer wird mit der nächsten Iteration erweitert.
          </div>
        </div>
      )}
    </div>
  );
}
