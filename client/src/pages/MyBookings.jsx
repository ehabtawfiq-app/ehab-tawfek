import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calendar, CalendarDays, Clock3, CreditCard, MapPin, Plus } from 'lucide-react';
import { api, arTime, dateLabel, dayNumber, money, monthShort, navigate, statusLabels } from '../lib.js';
import { Footer, LoadingState } from '../ui.jsx';

export default function MyBookingsPage({ notify, building, settings, go }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { setBookings((await api('/api/bookings/mine')).bookings); } catch (e) { notify(e.message, 'error'); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  async function cancel(b) {
    const id = b.id;
    const policy = b.depositAmount > 0 && settings?.cancellation_policy ? `\n\n${settings.cancellation_policy}` : '';
    if (!window.confirm(`متأكد إنك عايز تلغي الحجز؟${policy}`)) return;
    try { await api(`/api/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }); notify('تم إلغاء الحجز.'); load(); } catch (e) { notify(e.message, 'error'); }
  }
  return <main className="wrap content-page">
    <div className="page-title row"><div><h1>حجوزاتي</h1><p>كل مواعيدك مع الأطباء وحالة كل حجز.</p></div><button className="btn btn-primary" onClick={() => navigate('booking')}><Plus size={17} /> حجز جديد</button></div>
    {loading ? <LoadingState label="بنحمّل حجوزاتك..." /> : !bookings.length ? <div className="empty-large card"><CalendarDays size={32} /><h2>لسه مفيش حجوزات</h2><p>أول ما تحجز، تفاصيل الميعاد هتظهر هنا.</p><button className="btn btn-primary" onClick={() => navigate('booking')}>احجز موعدك الأول <ArrowLeft size={17} /></button></div>
      : <div className="my-list">{bookings.map((b) => <article className="my-booking card" key={b.id}>
        <div className="date-tile"><strong>{dayNumber(b.bookingDate)}</strong><span>{monthShort(b.bookingDate)}</span></div>
        <div className="my-main">
          <div className="my-title"><h3>{b.doctorName || b.serviceName}</h3><span className={`status-pill status-${b.status}`}>{statusLabels[b.status]}</span></div>
          <p className="my-sub">{[b.clinicName, b.serviceName].filter(Boolean).join(' · ')}</p>
          <div className="my-meta">
            <span><Calendar size={15} /> {dateLabel(b.bookingDate)}</span><span><Clock3 size={15} /> {arTime(b.startTime)}</span>
            {(b.clinicFloor || b.clinicRoom) && <span><MapPin size={15} /> {[b.clinicFloor, b.clinicRoom && `غرفة ${b.clinicRoom}`].filter(Boolean).join(' · ')}</span>}
            <span><CreditCard size={15} /> {money(b.price)}</span>
          </div>
          <p className="my-code">كود الحجز <b dir="ltr">{b.code}</b></p>
          {b.depositAmount > 0 && b.status !== 'cancelled' && settings?.cancellation_policy && <p className="cancel-policy"><AlertTriangle size={15} /><span>{settings.cancellation_policy}</span></p>}
          {b.paymentStatus === 'pending_review' && <p className="inline-hint"><Clock3 size={14} /> وصل الإيصال ومستني مراجعة الإدارة.</p>}
          {b.adminNote && <p className="admin-note">ملاحظة الإدارة: {b.adminNote}</p>}
        </div>
        {['pending_payment', 'pending_review', 'confirmed'].includes(b.status) && <button className="btn btn-small btn-danger-outline" onClick={() => cancel(b)}>إلغاء الحجز</button>}
      </article>)}</div>}
    <Footer building={building} go={go} />
  </main>;
}
