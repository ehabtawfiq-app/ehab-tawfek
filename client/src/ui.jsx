import React, { useEffect } from 'react';
import { CalendarCheck, CheckCircle2, Code2, Home, LayoutDashboard, LogOut, TicketCheck, User, UserRound, X, XCircle, CalendarClock, LoaderCircle } from 'lucide-react';
import { developer } from './portfolio.config.js';

export function Toast({ toast, close }) {
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(close, 5000); return () => clearTimeout(id); }, [toast, close]);
  if (!toast) return null;
  const error = toast.type === 'error';
  return <div className={`toast ${error ? 'toast-error' : 'toast-success'}`} role={error ? 'alert' : 'status'}>
    {error ? <XCircle size={20} /> : <CheckCircle2 size={20} />}<span>{toast.message}</span>
    <button onClick={close} aria-label="إغلاق"><X size={16} /></button>
  </div>;
}

export function Brand({ light = false, name = 'دورك' }) {
  return <span className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><CalendarCheck size={22} strokeWidth={2.3} /></span><span className="brand-word">{name}</span></span>;
}

export function LoadingState({ label = 'جاري التحميل...' }) { return <div className="loading-state"><LoaderCircle size={22} className="spin" /><span>{label}</span></div>; }

export function Modal({ title, close, children, wide = false }) {
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [close]);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="إغلاق"><X size={18} /></button></div>{children}
    </div>
  </div>;
}

export function Header({ user, page, go, onLogout, buildingName }) {
  const links = [
    ['home', 'الرئيسية'], ['booking', 'احجز موعد'],
    ...(user?.role === 'customer' ? [['mybookings', 'حجوزاتي']] : []),
    ...(user?.role === 'admin' ? [['admin', 'لوحة الإدارة']] : []),
  ];
  return <>
    <header className="topbar">
      <div className="topbar-inner wrap">
        <button className="brand-button" onClick={() => go(user?.role === 'admin' ? 'admin' : 'home')} aria-label="الصفحة الرئيسية"><Brand name={buildingName} /></button>
        <nav className="desktop-nav" aria-label="التنقل الرئيسي">
          {links.map(([id, label]) => <button key={id} className={page === id ? 'nav-link active' : 'nav-link'} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>{label}</button>)}
        </nav>
        <div className="header-actions">
          {user ? <>
            <span className="user-chip"><span className="user-avatar"><UserRound size={16} /></span><span className="user-chip-name">{user.name}</span>{user.role === 'admin' && <span className="admin-mini">مسؤول</span>}</span>
            <button className="icon-button" onClick={onLogout} title="تسجيل الخروج" aria-label="تسجيل الخروج"><LogOut size={18} /></button>
          </> : <>
            <button className="btn btn-ghost" onClick={() => go('auth')}>تسجيل الدخول</button>
            <button className="btn btn-primary" onClick={() => go('booking')}>احجز الآن</button>
          </>}
        </div>
      </div>
    </header>
    <nav className="mobile-nav" aria-label="التنقل السريع">
      <button onClick={() => go('home')} className={page === 'home' ? 'active' : ''}><Home size={20} /><span>الرئيسية</span></button>
      <button onClick={() => go('booking')} className={page === 'booking' ? 'active' : ''}><CalendarClock size={20} /><span>احجز</span></button>
      {user?.role === 'customer' && <button onClick={() => go('mybookings')} className={page === 'mybookings' ? 'active' : ''}><TicketCheck size={20} /><span>حجوزاتي</span></button>}
      {user?.role === 'admin' && <button onClick={() => go('admin')} className={page === 'admin' ? 'active' : ''}><LayoutDashboard size={20} /><span>الإدارة</span></button>}
      {!user && <button onClick={() => go('auth')} className={page === 'auth' ? 'active' : ''}><User size={20} /><span>دخول</span></button>}
    </nav>
  </>;
}

export function Footer({ building, go }) {
  return <footer className="footer">
    <div className="wrap footer-inner">
      <div className="footer-main"><Brand name={building?.name || 'دورك'} /><p>{building?.address ? `${building.address}${building.phone ? ` · ${building.phone}` : ''}` : building?.description}</p></div>
      <div className="footer-credit">
        <span>© {new Date().getFullYear()} {building?.name || 'دورك'}</span>
        <a href="#/portfolio" onClick={(e) => { e.preventDefault(); go('portfolio'); }}><Code2 size={15} /> تطوير {developer.name} — شوف أعماله</a>
      </div>
    </div>
  </footer>;
}
