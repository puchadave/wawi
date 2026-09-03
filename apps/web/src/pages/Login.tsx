import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, isLoggedIn } from '../lib/auth';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (isLoggedIn()) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">WaWi Middleware</h1>
          <p className="text-sm text-gray-500 mt-1">Matterhorn-wholesale.com</p>
        </div>

        <div className="panel" style={{ padding: '2rem' }}>
          <h2 className="text-lg font-semibold text-gray-900 mb-6 text-center">Anmelden</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="form-stack">
            <div>
              <label className="field-label">Benutzername</label>
              <input
                type="text"
                className="field-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="field-label">Passwort</label>
              <input
                type="password"
                className="field-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="action-button primary w-full justify-center py-3"
            >
              {loading ? 'Wird angemeldet...' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
