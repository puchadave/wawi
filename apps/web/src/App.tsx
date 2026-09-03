import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { clsx } from 'clsx';
import { useUIStore } from './lib/store';
import { ProductList } from './pages/ProductList';
import { ProductDetail } from './pages/ProductDetail';
import { Login } from './pages/Login';
import { Admin } from './pages/Admin';
import { isLoggedIn, getCurrentUser, logout } from './lib/auth';
import { useNavigate } from 'react-router-dom';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();
  if (!user || (!user.roles.includes('admin') && !user.permissions.includes('admin:read'))) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function Layout() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const navigate = useNavigate();
  const user = getCurrentUser();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">WaWi Middleware</h2>
            <button
              onClick={toggleSidebar}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg lg:hidden"
              aria-label="Sidebar schliessen"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
            <NavLink
              to="/"
              end
              className={({ isActive }) => clsx(
                'block p-3 rounded-lg transition-colors',
                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              Produkte
            </NavLink>
            <NavLink
              to="/pricing"
              className={({ isActive }) => clsx(
                'block p-3 rounded-lg transition-colors',
                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              Preisregeln
            </NavLink>
            <NavLink
              to="/shipping"
              className={({ isActive }) => clsx(
                'block p-3 rounded-lg transition-colors',
                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              Versand & Fracht
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => clsx(
                'block p-3 rounded-lg transition-colors',
                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              Einstellungen
            </NavLink>
            {user?.roles.includes('admin') && (
              <NavLink
                to="/admin"
                className={({ isActive }) => clsx(
                  'block p-3 rounded-lg transition-colors',
                  isActive ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                )}
              >
                Administration
              </NavLink>
            )}
          </nav>

          <div className="p-4 border-t border-gray-200">
            {user && (
              <div className="mb-3">
                <div className="text-sm font-medium text-gray-900">{user.fullName || user.username}</div>
                <div className="text-xs text-gray-500">{user.roles.join(', ')}</div>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs mb-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-gray-500">API verbunden</span>
            </div>
            <button
              onClick={handleLogout}
              className="action-button danger w-full justify-center mt-2"
            >
              Abmelden
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-h-screen transition-all duration-300 lg:ml-64">
        <Outlet />
      </main>

      <button
        onClick={toggleSidebar}
        className="fixed bottom-4 right-4 lg:hidden z-50 p-3 bg-blue-600 text-white rounded-full shadow-lg"
        aria-label="Sidebar umschalten"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<ProductList />} />
        <Route path="product/:id" element={<ProductList />} />
        <Route path="pricing" element={<div style={{ padding: '2rem' }}>Preisregeln werden erweitert.</div>} />
        <Route path="shipping" element={<div style={{ padding: '2rem' }}>Versand & Fracht werden erweitert.</div>} />
        <Route path="settings" element={<div style={{ padding: '2rem' }}>Einstellungen werden erweitert.</div>} />
        <Route path="admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export { ProductDetail };
