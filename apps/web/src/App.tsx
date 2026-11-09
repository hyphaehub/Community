import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LogoMark } from './components/Logo';
import { useAppSession } from './lib/auth';
import { Admin } from './pages/Admin';
import { Analytics } from './pages/Analytics';
import { Auth } from './pages/Auth';
import { BatchDetail } from './pages/BatchDetail';
import { Batches } from './pages/Batches';
import { Calendar } from './pages/Calendar';
import { Connect } from './pages/Connect';
import { Costs } from './pages/Costs';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Jars } from './pages/Jars';
import { Journal } from './pages/Journal';
import { Library } from './pages/Library';
import { Marketplace } from './pages/Marketplace';
import { Portal, PortalEnter } from './pages/Portal';
import { Settings } from './pages/Settings';
import { StrainDetail } from './pages/StrainDetail';
import { Strains } from './pages/Strains';
import { Tubs } from './pages/Tubs';

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
  const { data: session, isPending } = useAppSession();
  if (isPending) return <FullScreen />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public buyer storefront — separate audience from farm staff, no farm session. */}
        <Route path="/portal/enter" element={<PortalEnter />} />
        <Route path="/portal" element={<Portal />} />
        {/* Cloud-side "Connect to Cloud" handoff — handles its own auth so the
            server param survives the login redirect. */}
        <Route path="/connect" element={<Connect />} />
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Auth />} />
        <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Dashboard />} />
          <Route path="batches" element={<Batches />} />
          <Route path="batches/:id" element={<BatchDetail />} />
          <Route path="tubs" element={<Tubs />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="jars" element={<Jars />} />
          <Route path="strains" element={<Strains />} />
          <Route path="strains/:id" element={<StrainDetail />} />
          <Route path="library" element={<Library />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="journal" element={<Journal />} />
          <Route path="insights" element={<Analytics />} />
          <Route path="market" element={<Marketplace />} />
          <Route path="costs" element={<Costs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
