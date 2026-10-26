import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './lib.js';
import { Header, Toast } from './ui.jsx';
import HomePage from './pages/Home.jsx';
import AuthPage from './pages/Auth.jsx';
import BookingPage from './pages/Booking.jsx';
import MyBookingsPage from './pages/MyBookings.jsx';
import AdminDashboard from './pages/Admin.jsx';
import PortfolioPage from './pages/Portfolio.jsx';
import './styles.css';

const fromHash = () => (window.location.hash === '#/portfolio' ? 'portfolio' : 'home');

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(fromHash());
  const [data, setData] = useState(null); // { building, settings, clinics }
  const [toast, setToast] = useState(null);
  const [authReturn, setAuthReturn] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [bookingStart, setBookingStart] = useState({});
  const notify = useCallback((message, type = 'success') => setToast({ message, type, id: Date.now() }), []);
  const closeToast = useCallback(() => setToast(null), []);
  const loadPublic = useCallback(() => api('/api/public/building').then(setData).catch(() => {}), []);

  const go = useCallback((next, options) => {
    if (next === 'booking') {
      if (!user) { setAuthReturn('booking'); setAuthMode('login'); setBookingStart(options || {}); setPage('auth'); return; }
      if (user.role === 'admin') { notify('حساب المسؤول لا يحجز مواعيد. سجّل بحساب عميل لتجربة الحجز.', 'error'); return; }
      setBookingStart(options || {});
    }
    if (next === 'admin' && user?.role !== 'admin') { setAuthReturn('admin'); setAuthMode('login'); setPage('auth'); return; }
    if (next === 'auth') { setAuthReturn('home'); setAuthMode(options === 'register' ? 'register' : 'login'); }
    setPage(next);
    window.history.replaceState(null, '', next === 'portfolio' ? '#/portfolio' : window.location.pathname);
    window.scrollTo({ top: 0 });
  }, [user, notify]);

  useEffect(() => {
    loadPublic();
    api('/api/auth/me').then((d) => { setUser(d.user); if (d.user.role === 'admin') setPage('admin'); }).catch(() => {});
    const onHash = () => setPage((p) => (window.location.hash === '#/portfolio' ? 'portfolio' : p === 'portfolio' ? 'home' : p));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadPublic]);
  useEffect(() => { const h = (e) => go(e.detail); window.addEventListener('dorak:navigate', h); return () => window.removeEventListener('dorak:navigate', h); }, [go]);

  async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch { /* ignore */ } setUser(null); setPage('home'); notify('تم تسجيل الخروج.'); }
  function authSuccess(u) {
    setUser(u);
    setPage(u.role === 'admin' ? 'admin' : authReturn === 'booking' ? 'booking' : authReturn === 'admin' ? 'home' : 'mybookings');
    notify('أهلًا بيك، تم تسجيل الدخول.');
  }

  const buildingName = data?.building.name || 'دورك';
  const building = data?.building;
  let view;
  if (page === 'portfolio') view = <PortfolioPage go={go} />;
  else if (page === 'auth') view = <AuthPage initialMode={authMode} onSuccess={authSuccess} onCancel={() => setPage('home')} notify={notify} buildingName={buildingName} />;
  else if (page === 'booking' && user?.role === 'customer' && data) view = <BookingPage key={`${bookingStart.clinicId || 0}-${bookingStart.doctorId || 0}`} data={data} notify={notify} initial={bookingStart} go={go} />;
  else if (page === 'mybookings' && user?.role === 'customer') view = <MyBookingsPage notify={notify} building={building} settings={data?.settings} go={go} />;
  else if (page === 'admin' && user?.role === 'admin') view = <AdminDashboard settings={data?.settings} notify={notify} onLogout={logout} reloadPublic={loadPublic} buildingName={buildingName} />;
  else view = <HomePage data={data} user={user} go={go} />;

  return <div className="app-shell" dir="rtl">
    <Header user={user} page={page} go={go} onLogout={logout} buildingName={buildingName} />
    {view}
    <Toast toast={toast} close={closeToast} />
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
