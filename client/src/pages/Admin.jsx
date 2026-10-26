import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban, BadgeCheck, Building2, Calendar, CalendarClock, CalendarDays, Check, CheckCircle2, ClipboardList, Clock3, FileImage, HandCoins, Image as ImageIcon,
  LayoutDashboard, LoaderCircle, MessageCircle, Download, LogOut, Pencil, Plus, RefreshCw, Search, Settings, ShieldCheck, Stethoscope, Trash2, UserRound, Users, Wallet, XCircle, BriefcaseBusiness, CircleHelp, RotateCcw,
} from 'lucide-react';
import { api, arTime, dateLabel, initials, localDate, money, statusLabels } from '../lib.js';
import { Brand, LoadingState, Modal } from '../ui.jsx';
import { whatsappLink } from '../whatsapp.js';

const useReload = () => { const [n, setN] = useState(0); return [n, () => setN((x) => x + 1)]; };

/* ---------- Bookings ---------- */
// Two always-visible WhatsApp buttons: green confirms, red cancels. Only the one that matches the booking's state is active.
function WhatsAppButtons({ b, businessName, policy }) {
  const make = (kind, label, cls, active, whyNot) => {
    const href = active ? whatsappLink(kind, b, businessName, policy) : null;
    if (href) return <a className={`btn btn-small ${cls}`} href={href} target="_blank" rel="noopener noreferrer" title={`إرسال «${label}» للعميل على واتساب`}><MessageCircle size={15} /> {label}</a>;
    return <button type="button" className={`btn btn-small ${cls}`} disabled title={active ? 'رقم الموبايل غير صالح للواتساب' : whyNot}><MessageCircle size={15} /> {label}</button>;
  };
  return <>
    {make('confirmed', 'تأكيد الحجز', 'btn-whatsapp', ['confirmed', 'checked_in'].includes(b.status), 'يتفعّل لما يكون الحجز مؤكدًا.')}
    {make('cancelled', 'إلغاء الحجز', 'btn-whatsapp-cancel', b.status === 'cancelled', 'يتفعّل لما يكون الحجز ملغيًا.')}
  </>;
}

function BookingCard({ b, businessName, policy, onReview, onEdit, onStatus }) {
  return <article className="admin-booking">
    <div className="ab-person"><span className="avatar sm">{initials(b.customerName)}</span><div><b>{b.customerName}</b><span dir="ltr">{b.customerPhone}</span><small dir="ltr">{b.code}</small></div></div>
    <div className="ab-info"><b>{b.doctorName || '—'}</b><span>{b.clinicName} · {b.serviceName}</span><span><Calendar size={14} /> {b.bookingDate} · <Clock3 size={14} /> {arTime(b.startTime)}</span></div>
    <div className="ab-value"><b>{money(b.price)}</b>{b.depositAmount > 0 && <small>عربون {money(b.depositAmount)}</small>}<span className={`status-pill status-${b.status}`}>{statusLabels[b.status]}</span></div>
    <div className="ab-actions">
      {b.paymentStatus === 'pending_review' && b.receiptAvailable && <button className="btn btn-small btn-warning" onClick={onReview}><FileImage size={15} /> راجع الإيصال</button>}
      {b.status === 'confirmed' && <button className="btn btn-small btn-success" onClick={() => onStatus('checked_in')}><Check size={15} /> وصل العميل</button>}
      {b.status === 'checked_in' && <button className="btn btn-small btn-success" onClick={() => onStatus('completed')}><CheckCircle2 size={15} /> إنهاء الكشف</button>}
      <WhatsAppButtons b={b} businessName={businessName} policy={policy} />
      <button className="icon-button sm" onClick={onEdit} title="تعديل الحجز" aria-label="تعديل الحجز"><Pencil size={15} /></button>
    </div>
  </article>;
}

function ReceiptModal({ booking, close, onReview }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (decision) => { setBusy(true); try { await onReview(booking, decision, note); } finally { setBusy(false); } };
  return <Modal title="مراجعة إيصال العربون" close={close} wide>
    <div className="receipt-grid">
      <div className="receipt-info"><span className="status-pill status-pending_review">مراجعة العربون</span><h3>{booking.customerName}</h3><p>{booking.doctorName} · {booking.bookingDate} · {arTime(booking.startTime)}</p>
        <div className="receipt-amount"><span>العربون المطلوب</span><strong>{money(booking.depositAmount)}</strong></div><p className="small">كود الحجز <b dir="ltr">{booking.code}</b></p></div>
      <div className="receipt-image">{booking.receiptAvailable ? <img src={`/api/admin/bookings/${booking.id}/receipt`} alt={`إيصال الحجز ${booking.code}`} /> : <div className="empty-inline"><ImageIcon size={30} /> لا توجد صورة إيصال</div>}</div>
    </div>
    <label className="field"><span>ملاحظة <small>(اختياري)</small></span><textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="modal-actions">
      <button className="btn btn-danger" disabled={busy} onClick={() => act('reject')}><XCircle size={17} /> رفض وإلغاء الحجز</button>
      <button className="btn btn-success" disabled={busy} onClick={() => act('approve')}>{busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} قبول وتأكيد الحجز</button>
    </div>
  </Modal>;
}

function BookingEditModal({ booking: b, doctors, services, close, onSave, notify }) {
  const [form, setForm] = useState({ id: b.id, customerName: b.customerName, customerPhone: b.customerPhone, doctorId: String(b.doctorId || ''), serviceId: String(b.serviceId), bookingDate: b.bookingDate, startTime: b.startTime, price: String(b.price), status: b.status, adminNote: b.adminNote || '' });
  const [slots, setSlots] = useState([]); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const doctor = doctors.find((d) => String(d.id) === form.doctorId);
  const clinicServices = services.filter((s) => doctor && s.clinic_id === doctor.clinic_id);
  useEffect(() => {
    if (!form.doctorId || !form.serviceId) return undefined;
    let alive = true; setLoading(true);
    api(`/api/admin/slots?date=${form.bookingDate}&doctorId=${form.doctorId}&serviceId=${form.serviceId}&excludeBookingId=${b.id}`)
      .then((r) => { if (alive) setSlots(r.slots || []); }).catch(() => { if (alive) setSlots([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [form.bookingDate, form.doctorId, form.serviceId, b.id]);
  const options = slots.filter((s) => s.available || s.time === form.startTime);
  async function submit(e) { e.preventDefault(); setBusy(true); try { await onSave({ ...form, doctorId: Number(form.doctorId), serviceId: Number(form.serviceId), price: Number(form.price) }); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); } }
  return <Modal title={`تعديل الحجز · ${b.code}`} close={close} wide>
    <form className="editor-form" onSubmit={submit}>
      <div className="editor-grid">
        <label className="field"><span>اسم العميل</span><input value={form.customerName} onChange={(e) => set('customerName', e.target.value)} required /></label>
        <label className="field"><span>رقم الموبايل</span><input value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} required dir="ltr" /></label>
        <label className="field"><span>الدكتور</span><select value={form.doctorId} onChange={(e) => { const d = doctors.find((x) => String(x.id) === e.target.value); set('doctorId', e.target.value); const s = services.find((x) => d && x.clinic_id === d.clinic_id); set('serviceId', s ? String(s.id) : ''); if (s) set('price', String(s.price)); set('startTime', ''); }} required>
          {doctors.map((d) => <option value={d.id} key={d.id}>{d.name} — {d.clinic_name}{d.is_active ? '' : ' (متوقف)'}</option>)}</select></label>
        <label className="field"><span>الخدمة</span><select value={form.serviceId} onChange={(e) => { const s = services.find((x) => String(x.id) === e.target.value); set('serviceId', e.target.value); if (s) set('price', String(s.price)); set('startTime', ''); }} required>
          {clinicServices.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label className="field"><span>التاريخ</span><input type="date" value={form.bookingDate} onChange={(e) => { set('bookingDate', e.target.value); set('startTime', ''); }} required dir="ltr" /></label>
        <label className="field"><span>الميعاد {loading && <small>بنحمّل...</small>}</span><select value={form.startTime} onChange={(e) => set('startTime', e.target.value)} required><option value="">اختار ميعاد</option>{options.map((s) => <option value={s.time} key={s.time}>{arTime(s.time)}</option>)}</select></label>
        <label className="field"><span>السعر (جنيه)</span><input type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} required /></label>
        <label className="field"><span>حالة الحجز</span><select value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field full"><span>ملاحظة الإدارة</span><textarea rows="2" maxLength={500} value={form.adminNote} onChange={(e) => set('adminNote', e.target.value)} /></label>
      </div>
      <div className="modal-actions"><button type="button" className="btn btn-outline" onClick={close}>إلغاء</button><button className="btn btn-primary" disabled={busy || loading || !form.startTime}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} حفظ التعديلات</button></div>
    </form>
  </Modal>;
}

/* ---------- Clinics ---------- */
function ClinicsManager({ clinics, onChange, notify }) {
  const empty = { name: '', specialty: '', floor: '', room: '', description: '' };
  const [form, setForm] = useState(empty); const [editing, setEditing] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const reset = () => { setEditing(null); setForm(empty); };
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { if (editing) await api(`/api/admin/clinics/${editing}`, { method: 'PATCH', body: JSON.stringify(form) }); else await api('/api/admin/clinics', { method: 'POST', body: JSON.stringify(form) });
      notify(editing ? 'تم تحديث العيادة.' : 'تمت إضافة العيادة.'); reset(); onChange(); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  }
  async function toggle(c) {
    if (c.is_active && !window.confirm(`إيقاف «${c.name}»؟ هتختفي من الموقع والحجوزات القديمة هتفضل محفوظة.`)) return;
    try { await api(`/api/admin/clinics/${c.id}`, c.is_active ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); notify(c.is_active ? 'تم إيقاف العيادة.' : 'تم تفعيل العيادة.'); onChange(); } catch (err) { notify(err.message, 'error'); }
  }
  return <div className="manager">
    <form className="form-card" onSubmit={submit}>
      <h2><Building2 size={20} /> {editing ? 'تعديل العيادة' : 'إضافة عيادة'}</h2>
      <div className="editor-grid">
        <label className="field"><span>اسم العيادة</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: عيادة الجلدية" required /></label>
        <label className="field"><span>التخصص</span><input value={form.specialty} onChange={(e) => set('specialty', e.target.value)} placeholder="مثال: الجلدية والتجميل" /></label>
        <label className="field"><span>الدور</span><input value={form.floor} onChange={(e) => set('floor', e.target.value)} placeholder="مثال: الدور الثاني" /></label>
        <label className="field"><span>رقم الغرفة</span><input value={form.room} onChange={(e) => set('room', e.target.value)} placeholder="204" /></label>
        <label className="field full"><span>وصف مختصر</span><input value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <div className="form-actions">{editing && <button type="button" className="btn btn-outline" onClick={reset}>إلغاء التعديل</button>}<button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : editing ? <Check size={17} /> : <Plus size={17} />} {editing ? 'حفظ' : 'إضافة العيادة'}</button></div>
    </form>
    <div className="list-grid">{clinics.map((c) => <article className={`list-card ${c.is_active ? '' : 'inactive'}`} key={c.id}>
      <div><h3>{c.name}</h3><p>{c.specialty || '—'}</p><p className="small">{[c.floor, c.room && `غرفة ${c.room}`].filter(Boolean).join(' · ') || 'بدون موقع'} · {c.doctor_count} دكتور</p></div>
      <div className="row-actions">
        <span className={c.is_active ? 'tiny-status on' : 'tiny-status off'}>{c.is_active ? 'نشطة' : 'متوقفة'}</span>
        <button className="icon-button sm" aria-label="تعديل" title="تعديل" onClick={() => { setEditing(c.id); setForm({ name: c.name, specialty: c.specialty, floor: c.floor, room: c.room, description: c.description }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil size={15} /></button>
        <button className={`icon-button sm ${c.is_active ? 'danger-icon' : ''}`} aria-label={c.is_active ? 'إيقاف' : 'تفعيل'} title={c.is_active ? 'إيقاف' : 'تفعيل'} onClick={() => toggle(c)}>{c.is_active ? <Trash2 size={15} /> : <RotateCcw size={15} />}</button>
      </div></article>)}</div>
  </div>;
}

/* ---------- Doctors ---------- */
function DoctorsManager({ clinics, doctors, onChange, notify }) {
  const empty = { clinicId: '', name: '', title: '', yearsExperience: '0', bio: '', openingTime: '', closingTime: '', slotInterval: '' };
  const [form, setForm] = useState(empty); const [editing, setEditing] = useState(null); const [busy, setBusy] = useState(false);
  const [dayFor, setDayFor] = useState(null); const [dayForm, setDayForm] = useState({ date: '', reason: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const activeClinics = clinics.filter((c) => c.is_active);
  const reset = () => { setEditing(null); setForm({ ...empty, clinicId: String(activeClinics[0]?.id || '') }); };
  useEffect(() => { if (!form.clinicId && activeClinics.length) setForm((p) => ({ ...p, clinicId: String(activeClinics[0].id) })); }, [clinics]);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    const payload = { ...form, clinicId: Number(form.clinicId), yearsExperience: Number(form.yearsExperience || 0), slotInterval: form.slotInterval === '' ? null : Number(form.slotInterval), openingTime: form.openingTime || null, closingTime: form.closingTime || null };
    try { if (editing) await api(`/api/admin/doctors/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/api/admin/doctors', { method: 'POST', body: JSON.stringify(payload) });
      notify(editing ? 'تم تحديث الدكتور.' : 'تمت إضافة الدكتور.'); reset(); onChange(); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  }
  async function toggle(d) {
    if (d.is_active && !window.confirm(`إيقاف ${d.name}؟ الحجوزات القديمة هتفضل محفوظة.`)) return;
    try { await api(`/api/admin/doctors/${d.id}`, d.is_active ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); notify(d.is_active ? 'تم إيقاف الدكتور.' : 'تم تفعيل الدكتور.'); onChange(); } catch (err) { notify(err.message, 'error'); }
  }
  async function addDay(e) {
    e.preventDefault();
    try { await api(`/api/admin/doctors/${dayFor}/days-off`, { method: 'POST', body: JSON.stringify(dayForm) }); notify('تمت إضافة الإجازة.'); setDayForm({ date: '', reason: '' }); onChange(); } catch (err) { notify(err.message, 'error'); }
  }
  async function removeDay(id, date) { try { await api(`/api/admin/doctors/${id}/days-off/${date}`, { method: 'DELETE' }); notify('تم فتح اليوم للحجز.'); onChange(); } catch (err) { notify(err.message, 'error'); } }
  return <div className="manager">
    <form className="form-card" onSubmit={submit}>
      <h2><Stethoscope size={20} /> {editing ? 'تعديل الدكتور' : 'إضافة دكتور'}</h2>
      <div className="editor-grid">
        <label className="field"><span>العيادة</span><select value={form.clinicId} onChange={(e) => set('clinicId', e.target.value)} required>{activeClinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>اسم الدكتور</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="د. أحمد محمد" required /></label>
        <label className="field"><span>اللقب</span><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="استشاري الباطنة" /></label>
        <label className="field"><span>سنوات الخبرة</span><input type="number" min="0" max="70" value={form.yearsExperience} onChange={(e) => set('yearsExperience', e.target.value)} /></label>
        <label className="field full"><span>نبذة قصيرة</span><input value={form.bio} onChange={(e) => set('bio', e.target.value)} /></label>
        <div className="subhead full"><Clock3 size={17} /><b>مواعيد الدكتور</b><small>اتركها فارغة لاستخدام ساعات المبنى</small></div>
        <label className="field"><span>من الساعة</span><input type="time" value={form.openingTime} onChange={(e) => set('openingTime', e.target.value)} dir="ltr" /></label>
        <label className="field"><span>إلى الساعة</span><input type="time" value={form.closingTime} onChange={(e) => set('closingTime', e.target.value)} dir="ltr" /></label>
        <label className="field"><span>الفاصل بين المواعيد</span><select value={form.slotInterval} onChange={(e) => set('slotInterval', e.target.value)}><option value="">حسب المبنى</option>{[10, 15, 20, 30, 45, 60].map((v) => <option key={v} value={v}>{v} دقيقة</option>)}</select></label>
      </div>
      <div className="form-actions">{editing && <button type="button" className="btn btn-outline" onClick={reset}>إلغاء التعديل</button>}<button className="btn btn-primary" disabled={busy || !activeClinics.length}>{busy ? <LoaderCircle className="spin" size={17} /> : editing ? <Check size={17} /> : <Plus size={17} />} {editing ? 'حفظ' : 'إضافة الدكتور'}</button></div>
    </form>
    {clinics.map((c) => { const list = doctors.filter((d) => d.clinic_id === c.id); if (!list.length) return null; return <section key={c.id}>
      <h3 className="group-title">{c.name} <small>{[c.floor, c.room && `غرفة ${c.room}`].filter(Boolean).join(' · ')}</small></h3>
      <div className="list-grid">{list.map((d) => <article className={`list-card doctor ${d.is_active ? '' : 'inactive'}`} key={d.id}>
        <span className="avatar">{initials(d.name)}</span>
        <div className="grow"><h3>{d.name}</h3><p>{d.title || '—'}{d.years_experience ? ` · خبرة ${d.years_experience} سنة` : ''}</p>
          <p className="small"><Clock3 size={13} /> {d.opening_time ? `${arTime(d.opening_time)} – ${arTime(d.closing_time)}` : 'حسب ساعات المبنى'}</p>
          {d.days_off.length > 0 && <p className="small off-days"><Ban size={13} /> إجازات: {d.days_off.map((o) => o.date).join('، ')}</p>}</div>
        <div className="row-actions">
          <span className={d.is_active ? 'tiny-status on' : 'tiny-status off'}>{d.is_active ? 'نشط' : 'متوقف'}</span>
          <button className="icon-button sm" title="إجازات الدكتور" aria-label="إجازات الدكتور" onClick={() => setDayFor(d.id)}><CalendarDays size={15} /></button>
          <button className="icon-button sm" title="تعديل" aria-label="تعديل" onClick={() => { setEditing(d.id); setForm({ clinicId: String(d.clinic_id), name: d.name, title: d.title, yearsExperience: String(d.years_experience), bio: d.bio, openingTime: d.opening_time || '', closingTime: d.closing_time || '', slotInterval: d.slot_interval ? String(d.slot_interval) : '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil size={15} /></button>
          <button className={`icon-button sm ${d.is_active ? 'danger-icon' : ''}`} title={d.is_active ? 'إيقاف' : 'تفعيل'} aria-label={d.is_active ? 'إيقاف' : 'تفعيل'} onClick={() => toggle(d)}>{d.is_active ? <Trash2 size={15} /> : <RotateCcw size={15} />}</button>
        </div></article>)}</div></section>; })}
    {dayFor && (() => { const d = doctors.find((x) => x.id === dayFor); return <Modal title={`إجازات ${d?.name}`} close={() => setDayFor(null)}>
      <form className="day-form" onSubmit={addDay}>
        <label className="field"><span>التاريخ</span><input type="date" min={localDate()} value={dayForm.date} onChange={(e) => setDayForm((p) => ({ ...p, date: e.target.value }))} required dir="ltr" /></label>
        <label className="field"><span>السبب</span><input value={dayForm.reason} onChange={(e) => setDayForm((p) => ({ ...p, reason: e.target.value }))} placeholder="مؤتمر / إجازة" /></label>
        <button className="btn btn-primary"><Plus size={17} /> إضافة</button>
      </form>
      <ul className="day-list">{d?.days_off.map((o) => <li key={o.date}><Ban size={16} /><span><b>{dateLabel(o.date)}</b><small>{o.reason || 'إجازة'}</small></span><button className="icon-button sm danger-icon" aria-label="إزالة" onClick={() => removeDay(d.id, o.date)}><Trash2 size={15} /></button></li>)}
        {!d?.days_off.length && <li className="empty-inline">مفيش إجازات قادمة.</li>}</ul>
    </Modal>; })()}
  </div>;
}

/* ---------- Services ---------- */
function ServicesManager({ clinics, services, onChange, notify }) {
  const empty = { clinicId: '', name: '', description: '', price: '200', durationMinutes: '30' };
  const [form, setForm] = useState(empty); const [editing, setEditing] = useState(null); const [busy, setBusy] = useState(false);
  const activeClinics = clinics.filter((c) => c.is_active);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const reset = () => { setEditing(null); setForm({ ...empty, clinicId: String(activeClinics[0]?.id || '') }); };
  useEffect(() => { if (!form.clinicId && activeClinics.length) setForm((p) => ({ ...p, clinicId: String(activeClinics[0].id) })); }, [clinics]);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    const payload = { ...form, clinicId: Number(form.clinicId), price: Number(form.price), durationMinutes: Number(form.durationMinutes) };
    try { if (editing) await api(`/api/admin/services/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/api/admin/services', { method: 'POST', body: JSON.stringify(payload) });
      notify(editing ? 'تم تحديث الخدمة.' : 'تمت إضافة الخدمة.'); reset(); onChange(); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  }
  async function toggle(s) {
    if (s.is_active && !window.confirm(`إيقاف «${s.name}»؟`)) return;
    try { await api(`/api/admin/services/${s.id}`, s.is_active ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); notify(s.is_active ? 'تم إيقاف الخدمة.' : 'تم تفعيل الخدمة.'); onChange(); } catch (err) { notify(err.message, 'error'); }
  }
  return <div className="manager">
    <form className="form-card" onSubmit={submit}>
      <h2><BriefcaseBusiness size={20} /> {editing ? 'تعديل الخدمة' : 'إضافة خدمة'}</h2>
      <div className="editor-grid">
        <label className="field"><span>العيادة</span><select value={form.clinicId} onChange={(e) => set('clinicId', e.target.value)} disabled={Boolean(editing)} required>{activeClinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>اسم الخدمة</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="كشف" required /></label>
        <label className="field"><span>السعر (جنيه)</span><input type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} required /></label>
        <label className="field"><span>المدة بالدقائق</span><input type="number" min="5" max="480" value={form.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} required /></label>
        <label className="field full"><span>وصف مختصر</span><input value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <div className="form-actions">{editing && <button type="button" className="btn btn-outline" onClick={reset}>إلغاء التعديل</button>}<button className="btn btn-primary" disabled={busy || !activeClinics.length}>{busy ? <LoaderCircle className="spin" size={17} /> : editing ? <Check size={17} /> : <Plus size={17} />} {editing ? 'حفظ' : 'إضافة الخدمة'}</button></div>
    </form>
    {clinics.map((c) => { const list = services.filter((s) => s.clinic_id === c.id); if (!list.length) return null; return <section key={c.id}>
      <h3 className="group-title">{c.name}</h3>
      <div className="list-grid">{list.map((s) => <article className={`list-card ${s.is_active ? '' : 'inactive'}`} key={s.id}>
        <div className="grow"><h3>{s.name}</h3><p>{s.description || 'بدون وصف'}</p><p className="small"><b>{money(s.price)}</b> · <Clock3 size={13} /> {s.duration_minutes} دقيقة</p></div>
        <div className="row-actions"><span className={s.is_active ? 'tiny-status on' : 'tiny-status off'}>{s.is_active ? 'نشطة' : 'متوقفة'}</span>
          <button className="icon-button sm" aria-label="تعديل" title="تعديل" onClick={() => { setEditing(s.id); setForm({ clinicId: String(s.clinic_id), name: s.name, description: s.description, price: String(s.price), durationMinutes: String(s.duration_minutes) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil size={15} /></button>
          <button className={`icon-button sm ${s.is_active ? 'danger-icon' : ''}`} aria-label={s.is_active ? 'إيقاف' : 'تفعيل'} title={s.is_active ? 'إيقاف' : 'تفعيل'} onClick={() => toggle(s)}>{s.is_active ? <Trash2 size={15} /> : <RotateCcw size={15} />}</button></div>
      </article>)}</div></section>; })}
  </div>;
}

/* ---------- Settings ---------- */
function SettingsManager({ settings, onSaved, blocked, onReloadBlocked, notify }) {
  const [form, setForm] = useState({ business_name: '', business_description: '', business_phone: '', business_address: '', opening_time: '12:00', closing_time: '00:00', slot_interval: 30, deposit_required: false, deposit_amount: 50, payment_instructions: '', cancellation_policy: '' });
  const [saving, setSaving] = useState(false); const [day, setDay] = useState(''); const [reason, setReason] = useState('إجازة رسمية');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  useEffect(() => { if (settings) setForm({ business_name: settings.business_name || '', business_description: settings.business_description || '', business_phone: settings.business_phone || '', business_address: settings.business_address || '', opening_time: settings.opening_time, closing_time: settings.closing_time, slot_interval: settings.slot_interval, deposit_required: Boolean(settings.deposit_required), deposit_amount: settings.deposit_amount ?? 50, payment_instructions: settings.payment_instructions || '', cancellation_policy: settings.cancellation_policy ?? '' }); }, [settings]);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  async function save(e) { e.preventDefault(); setSaving(true); try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(form) }); notify('تم حفظ إعدادات المبنى.'); onSaved(); } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); } }
  async function addDay(e) { e.preventDefault(); try { await api('/api/admin/blocked-dates', { method: 'POST', body: JSON.stringify({ date: day, reason }) }); notify('تم قفل اليوم لكل العيادات.'); setDay(''); onReloadBlocked(); } catch (err) { notify(err.message, 'error'); } }
  async function removeDay(date) { if (!window.confirm(`فتح ${date} للحجز؟`)) return; try { await api(`/api/admin/blocked-dates/${date}`, { method: 'DELETE' }); notify('تم فتح اليوم.'); onReloadBlocked(); } catch (err) { notify(err.message, 'error'); } }
  async function changePassword(e) {
    e.preventDefault(); if (pw.newPassword !== pw.repeat) return notify('كلمتا المرور الجديدتان غير متطابقتين.', 'error');
    try { await api('/api/admin/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) }); setPw({ currentPassword: '', newPassword: '', repeat: '' }); notify('تم تغيير كلمة مرور المسؤول.'); } catch (err) { notify(err.message, 'error'); }
  }
  return <div className="manager">
    <form className="form-card" onSubmit={save}>
      <h2><Building2 size={20} /> بيانات المبنى والحجز</h2>
      <div className="editor-grid">
        <label className="field"><span>اسم المبنى</span><input value={form.business_name} onChange={(e) => set('business_name', e.target.value)} required /></label>
        <label className="field"><span>رقم التواصل</span><input value={form.business_phone} onChange={(e) => set('business_phone', e.target.value)} dir="ltr" /></label>
        <label className="field full"><span>العنوان</span><input value={form.business_address} onChange={(e) => set('business_address', e.target.value)} /></label>
        <label className="field full"><span>وصف يظهر في الموقع</span><textarea rows="2" value={form.business_description} onChange={(e) => set('business_description', e.target.value)} /></label>
        <div className="subhead full"><Clock3 size={17} /><b>ساعات الحجز الافتراضية</b><small>أي دكتور بدون مواعيد خاصة بيستخدمها</small></div>
        <label className="field"><span>من</span><input type="time" value={form.opening_time} onChange={(e) => set('opening_time', e.target.value)} required dir="ltr" /></label>
        <label className="field"><span>إلى</span><input type="time" value={form.closing_time} onChange={(e) => set('closing_time', e.target.value)} required dir="ltr" /></label>
        <label className="field"><span>الفاصل بين المواعيد</span><select value={form.slot_interval} onChange={(e) => set('slot_interval', Number(e.target.value))}>{[10, 15, 20, 30, 45, 60, 90, 120].map((v) => <option key={v} value={v}>{v} دقيقة</option>)}</select></label>
        <div className="subhead full"><Wallet size={17} /><b>العربون</b></div>
        <label className="toggle-field full"><span><b>تفعيل العربون</b><small>العميل يرفع صورة الإيصال والإدارة تراجعها يدويًا.</small></span><input type="checkbox" checked={form.deposit_required} onChange={(e) => set('deposit_required', e.target.checked)} /></label>
        {form.deposit_required && <>
          <label className="field"><span>مبلغ العربون (جنيه)</span><input type="number" min="0" value={form.deposit_amount} onChange={(e) => set('deposit_amount', Number(e.target.value))} required /></label>
          <label className="field full"><span>بيانات التحويل</span><textarea rows="3" value={form.payment_instructions} onChange={(e) => set('payment_instructions', e.target.value)} required /></label>
          <label className="field full"><span>سياسة الإلغاء <small>(بتظهر للعميل قبل الحجز وعند الإلغاء وفي رسالة الإلغاء)</small></span><textarea rows="2" maxLength={600} value={form.cancellation_policy} onChange={(e) => set('cancellation_policy', e.target.value)} placeholder="مثال: العربون غير مسترد في حالة إلغاء الحجز." /></label>
          <div className="notice notice-warning full"><CircleHelp size={18} /><span>الموقع لا يتحقق من التحويل تلقائيًا. راجع وصول المبلغ فعليًا قبل قبول الإيصال.</span></div></>}
      </div>
      <div className="form-actions"><button className="btn btn-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} حفظ الإعدادات</button></div>
    </form>
    <div className="form-card">
      <h2><CalendarDays size={20} /> إجازات المبنى (كل العيادات)</h2>
      <form className="day-form" onSubmit={addDay}>
        <label className="field"><span>التاريخ</span><input type="date" min={localDate()} value={day} onChange={(e) => setDay(e.target.value)} required dir="ltr" /></label>
        <label className="field"><span>السبب</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="btn btn-primary"><Plus size={17} /> إضافة</button>
      </form>
      <ul className="day-list">{blocked.map((d) => <li key={d.date}><Ban size={16} /><span><b>{dateLabel(d.date)}</b><small>{d.reason}</small></span><button className="icon-button sm danger-icon" aria-label="إزالة" onClick={() => removeDay(d.date)}><Trash2 size={15} /></button></li>)}
        {!blocked.length && <li className="empty-inline">مفيش إجازات متسجلة.</li>}</ul>
    </div>
    <BackupCard notify={notify} />
    <form className="form-card" onSubmit={changePassword}>
      <h2><ShieldCheck size={20} /> كلمة مرور المسؤول</h2>
      <div className="editor-grid">
        <label className="field"><span>الحالية</span><input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} required dir="ltr" /></label>
        <label className="field"><span>الجديدة (10 أحرف على الأقل)</span><input type="password" autoComplete="new-password" minLength={10} value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} required dir="ltr" /></label>
        <label className="field"><span>تأكيد الجديدة</span><input type="password" autoComplete="new-password" minLength={10} value={pw.repeat} onChange={(e) => setPw((p) => ({ ...p, repeat: e.target.value }))} required dir="ltr" /></label>
      </div>
      <div className="form-actions"><button className="btn btn-primary"><ShieldCheck size={17} /> تغيير كلمة المرور</button></div>
    </form>
  </div>;
}

const BACKUP_KEY = 'dorak:lastBackup';
function BackupCard({ notify }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(() => { try { return localStorage.getItem(BACKUP_KEY) || ''; } catch { return ''; } });
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  async function download() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/backup', { credentials: 'include' });
      if (!res.ok) { let msg = 'تعذر تنزيل النسخة الاحتياطية.'; try { msg = (await res.json()).error || msg; } catch { /* not json */ } throw new Error(msg); }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'dorak-backup.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const now = new Date().toISOString();
      try { localStorage.setItem(BACKUP_KEY, now); } catch { /* private mode */ }
      setLast(now); notify('تم تنزيل النسخة الاحتياطية على جهازك.');
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  }
  return <div className="form-card">
    <h2><Download size={20} /> نسخة احتياطية</h2>
    <p className="muted">ملف واحد (ZIP) فيه كل الحجوزات والعيادات والأطباء والخدمات وصور الإيصالات، وملف Excel جاهز للحجوزات. كلمات المرور مش بتتضمن. احفظه في مكان آمن لأن فيه بيانات عملاء.</p>
    {days !== null && days >= 30 && <div className="notice notice-warning"><CircleHelp size={18} /><span>آخر نسخة كانت من {days} يوم. يُفضّل تنزّل نسخة جديدة كل شهر.</span></div>}
    {days === null && <div className="notice notice-warning"><CircleHelp size={18} /><span>لسه ما نزّلتش أي نسخة احتياطية من الجهاز ده.</span></div>}
    <div className="form-actions">
      <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} تنزيل نسخة احتياطية</button>
      {last && <small>آخر تنزيل من هذا الجهاز: {dateLabel(last.slice(0, 10))}</small>}
    </div>
  </div>;
}

/* ---------- Dashboard ---------- */
export default function AdminDashboard({ settings, notify, onLogout, reloadPublic, buildingName }) {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [clinics, setClinics] = useState([]); const [doctors, setDoctors] = useState([]); const [services, setServices] = useState([]); const [blocked, setBlocked] = useState([]);
  const [filters, setFilters] = useState({ status: 'all', clinicId: '', search: '' });
  const [loading, setLoading] = useState(false);
  const [receiptFor, setReceiptFor] = useState(null); const [editFor, setEditFor] = useState(null);
  const [tick, bump] = useReload();

  const fail = useCallback((e) => notify(e.message, 'error'), [notify]);
  const loadSummary = useCallback(() => api('/api/admin/summary').then(setSummary).catch(fail), [fail]);
  const loadCatalog = useCallback(async () => {
    try { const [c, d, s] = await Promise.all([api('/api/admin/clinics'), api('/api/admin/doctors'), api('/api/admin/services')]); setClinics(c.clinics); setDoctors(d.doctors); setServices(s.services); } catch (e) { fail(e); }
  }, [fail]);
  const loadBlocked = useCallback(() => api('/api/admin/blocked-dates').then((r) => setBlocked(r.dates)).catch(fail), [fail]);
  const loadBookings = useCallback(async () => {
    setLoading(true);
    try { const q = new URLSearchParams({ status: filters.status, search: filters.search }); if (filters.clinicId) q.set('clinicId', filters.clinicId); setBookings((await api(`/api/admin/bookings?${q}`)).bookings); } catch (e) { fail(e); } finally { setLoading(false); }
  }, [filters, fail]);

  useEffect(() => { loadSummary(); loadCatalog(); loadBlocked(); }, [tick]);
  useEffect(() => { const id = setTimeout(loadBookings, filters.search ? 250 : 0); return () => clearTimeout(id); }, [loadBookings, tick]);
  const catalogChanged = () => { loadCatalog(); loadSummary(); reloadPublic(); };

  async function setStatus(b, status) { try { await api(`/api/admin/bookings/${b.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); notify(`تم تحديث الحالة إلى «${statusLabels[status]}».`); loadBookings(); loadSummary(); } catch (e) { fail(e); } }
  async function review(b, decision, note) {
    if (!window.confirm(decision === 'approve' ? 'تأكيد قبول الإيصال؟' : 'رفض الإيصال وإلغاء الحجز؟')) return;
    try { await api(`/api/admin/bookings/${b.id}/payment-review`, { method: 'POST', body: JSON.stringify({ decision, note }) }); notify(decision === 'approve' ? 'تم اعتماد الإيصال.' : 'تم رفض الإيصال.'); setReceiptFor(null); loadBookings(); loadSummary(); } catch (e) { fail(e); }
  }
  async function saveEdit(form) { await api(`/api/admin/bookings/${form.id}`, { method: 'PATCH', body: JSON.stringify(form) }); notify('تم حفظ تعديلات الحجز.'); setEditFor(null); loadBookings(); loadSummary(); }

  const tabs = [
    { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard }, { id: 'bookings', label: 'الحجوزات', icon: ClipboardList },
    { id: 'clinics', label: 'العيادات', icon: Building2 }, { id: 'doctors', label: 'الأطباء', icon: Stethoscope },
    { id: 'services', label: 'الخدمات والأسعار', icon: BriefcaseBusiness }, { id: 'settings', label: 'إعدادات المبنى', icon: Settings },
  ];
  const current = tabs.find((t) => t.id === tab);
  const stats = [
    { label: 'حجوزات النهارده', value: summary?.today, icon: CalendarDays },
    { label: 'مراجعة العربون', value: summary?.pendingReview, icon: HandCoins, warn: true },
    { label: 'حجوزات مؤكدة', value: summary?.confirmed, icon: BadgeCheck },
    { label: 'في الانتظار بالمبنى', value: summary?.checkedIn, icon: UserRound },
  ];
  const activeDoctors = doctors;

  return <main className="admin-shell wrap">
    <aside className="admin-sidebar">
      <div className="sidebar-brand"><Brand light name={buildingName} /><span>لوحة المسؤول</span></div>
      <nav className="admin-menu" aria-label="أقسام الإدارة">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={19} /><span>{label}</span>{id === 'bookings' && summary?.pendingReview > 0 && <i className="menu-count">{summary.pendingReview}</i>}</button>)}</nav>
      <button className="admin-logout" onClick={onLogout}><LogOut size={17} /> تسجيل الخروج</button>
    </aside>
    <section className="admin-content">
      <div className="admin-top"><div><h1>{current.label}</h1><p>مسؤول واحد لكل عيادات المبنى.</p></div><div className="admin-top-actions"><span className="date-chip"><CalendarDays size={15} /> {dateLabel(localDate())}</span><button className="icon-button" onClick={bump} title="تحديث" aria-label="تحديث البيانات"><RefreshCw size={17} /></button></div></div>

      {tab === 'overview' && <div className="overview">
        <div className="stats-grid">{stats.map(({ label, value, icon: Icon, warn }) => <div className={`stat-card ${warn && value > 0 ? 'warn' : ''}`} key={label}><span className="stat-icon"><Icon size={20} /></span><span className="stat-label">{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
        <div className="section-bar"><h2>العيادات اليوم</h2><button className="text-link" onClick={() => setTab('bookings')}>كل الحجوزات</button></div>
        <div className="clinic-stats">{summary?.byClinic?.map((c) => <button className="clinic-stat" key={c.clinicId} onClick={() => { setFilters((f) => ({ ...f, clinicId: String(c.clinicId) })); setTab('bookings'); }}>
          <span><b>{c.name}</b><small>{c.floor || '—'} · {c.doctors} دكتور</small></span><span className="clinic-nums"><b>{c.today}</b><small>اليوم</small></span><span className="clinic-nums"><b>{c.upcoming}</b><small>قادمة</small></span></button>)}
          {summary && !summary.byClinic.length && <p className="empty-inline">أضف عيادات من تبويب «العيادات».</p>}</div>
        <div className="section-bar"><h2>أحدث الحجوزات</h2></div>
        {bookings.length ? <div className="admin-booking-list">{bookings.slice(0, 5).map((b) => <BookingCard key={b.id} b={b} businessName={settings?.business_name} policy={settings?.cancellation_policy} onReview={() => setReceiptFor(b)} onEdit={() => setEditFor(b)} onStatus={(s) => setStatus(b, s)} />)}</div> : <div className="empty-state"><CalendarClock size={28} /><b>لسه مفيش حجوزات</b><p>أول ما عميل يحجز هيظهر هنا.</p></div>}
      </div>}

      {tab === 'bookings' && <div className="admin-panel">
        <div className="toolbar">
          <div className="filter-pills" role="group" aria-label="حالة الحجز">{[['all', 'الكل'], ['pending_review', 'مراجعة العربون'], ['confirmed', 'مؤكد'], ['checked_in', 'وصل العميل'], ['completed', 'مكتمل'], ['cancelled', 'ملغي']].map(([id, label]) => <button key={id} className={filters.status === id ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilters((f) => ({ ...f, status: id }))}>{label}{id === 'pending_review' && summary?.pendingReview ? <b>{summary.pendingReview}</b> : null}</button>)}</div>
          <div className="toolbar-row">
            <label className="select-filter"><span className="sr-only">العيادة</span><select value={filters.clinicId} onChange={(e) => setFilters((f) => ({ ...f, clinicId: e.target.value }))}><option value="">كل العيادات</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="search-input"><Search size={17} /><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="ابحث بالاسم أو الكود أو الدكتور" /></label>
          </div>
        </div>
        {loading ? <LoadingState label="بنحمّل الحجوزات..." /> : !bookings.length ? <div className="empty-state"><ClipboardList size={28} /><b>مفيش حجوزات مطابقة</b></div>
          : <div className="admin-booking-list">{bookings.map((b) => <BookingCard key={b.id} b={b} businessName={settings?.business_name} policy={settings?.cancellation_policy} onReview={() => setReceiptFor(b)} onEdit={() => setEditFor(b)} onStatus={(s) => setStatus(b, s)} />)}</div>}
      </div>}

      {tab === 'clinics' && <ClinicsManager clinics={clinics} onChange={catalogChanged} notify={notify} />}
      {tab === 'doctors' && <DoctorsManager clinics={clinics} doctors={doctors} onChange={catalogChanged} notify={notify} />}
      {tab === 'services' && <ServicesManager clinics={clinics} services={services} onChange={catalogChanged} notify={notify} />}
      {tab === 'settings' && <SettingsManager settings={settings} onSaved={reloadPublic} blocked={blocked} onReloadBlocked={loadBlocked} notify={notify} />}
    </section>
    {receiptFor && <ReceiptModal booking={receiptFor} close={() => setReceiptFor(null)} onReview={review} />}
    {editFor && <BookingEditModal booking={editFor} doctors={activeDoctors} services={services} close={() => setEditFor(null)} onSave={saveEdit} notify={notify} />}
  </main>;
}
