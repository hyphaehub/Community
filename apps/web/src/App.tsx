import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LogoMark } from './components/Logo';
import { useSession } from './lib/auth';
import { Admin } from './pages/Admin';
import { Auth } from './pages/Auth';
import { BatchDetail } from './pages/BatchDetail';
import { Batches } from './pages/Batches';
import { Calendar } from './pages/Calendar';
import { Costs } from './pages/Costs';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Jars } from './pages/Jars';
import { Settings } from './pages/Settings';
import { Strains } from './pages/Strains';

function FullScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-spore">
      <div className="animate-pulse">
        <LogoMark size={44} />
      </div>
    </div>
  );
}

export function App() {
  const { data: session, isPending } = useSession();
  if (isPending) return <FullScreen />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Auth />} />
        <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Dashboard />} />
          <Route path="batches" element={<Batches />} />
          <Route path="batches/:id" element={<BatchDetail />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="jars" element={<Jars />} />
          <Route path="strains" element={<Strains />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="costs" element={<Costs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
