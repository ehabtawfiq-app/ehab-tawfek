import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calendar, CalendarCheck, Check, CheckCircle2, CircleHelp, ClipboardList, Clock3, FileImage, LoaderCircle, MapPin, ShieldCheck, UploadCloud, Wallet } from 'lucide-react';
import { api, arTime, dateLabel, dayNumber, initials, localDate, money, monthShort, navigate, weekday } from '../lib.js';
import { clinicIcon } from '../icons.js';
import { Footer } from '../ui.jsx';

const DAYS_AHEAD = 14;

function Step({ n, title, hint, children }) {
  return <section className="book-step"><header><span className="step-badge">{n}</span><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></header>{children}</section>;
}

export default function BookingPage({ data, notify, initial = {}, go }) {
  const { clinics, settings, building } = data;
  const [clinicId, setClinicId] = useState(initial.clinicId || clinics[0]?.id || null);
  const clinic = clinics.find((c) => c.id === clinicId) || clinics[0];
  const [doctorId, setDoctorId] = useState(initial.doctorId || null);
  const [serviceId, setServiceId] = useState(null);
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [slots, setSlots] = useState([]);
  const [closedReason, setClosedReason] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const doctor = clinic?.doctors.find((d) => d.id === doctorId) || null;
  const service = clinic?.services.find((s) => s.id === serviceId) || null;
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => localDate(i)), []);

  // Keep doctor and service valid for the chosen clinic.
  useEffect(() => {
    if (!clinic) return;
    if (!clinic.doctors.some((d) => d.id === doctorId)) setDoctorId(clinic.doctors[0]?.id ?? null);
    if (!clinic.services.some((s) => s.id === serviceId)) setServiceId(clinic.services[0]?.id ?? null);
  }, [clinic, doctorId, serviceId]);

  useEffect(() => {
    if (!doctorId || !serviceId || !date) { setSlots([]); return undefined; }
    let alive = true; setLoadingSlots(true); setTime('');
    api(`/api/public/slots?date=${date}&doctorId=${doctorId}&serviceId=${serviceId}`)
      .then((r) => { if (alive) { setSlots(r.slots || []); setClosedReason(r.reason || ''); } })
      .catch((e) => { if (alive) { setSlots([]); setClosedReason(e.message); } })
      .finally(() => { if (alive) setLoadingSlots(false); });
    return () => { alive = false; };
  }, [doctorId, serviceId, date]);

  async function submit(e) {
    e.preventDefault();
    if (!doctor || !service || !time) return notify('اختار الدكتور والخدمة والميعاد الأول.', 'error');
    if (settings.deposit_required && !receipt) return notify('ارفع صورة إيصال العربون الأول.', 'error');
    const form = new FormData();
    form.append('doctorId', doctor.id); form.append('serviceId', service.id); form.append('date', date); form.append('time', time); form.append('note', note);
    if (receipt) form.append('receipt', receipt);
    setBusy(true);
    try { setCreated((await api('/api/bookings', { method: 'POST', body: form })).booking); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }

  if (created) return <main className="wrap content-page">
    <div className="booking-success card">
      <span className="success-badge"><Check size={30} /></span>
      <h1>{created.status === 'pending_review' ? 'حجزك مستني مراجعة العربون' : 'حجزك اتأكد'}</h1>
      <p>{created.status === 'pending_review' ? 'وصلتنا صورة الإيصال والإدارة هتراجعها. تقدر تتابع الحالة من حجوزاتي.' : 'احتفظ بكود الحجز وقدّمه عند الاستقبال.'}</p>
      <div className="success-code"><span>كود الحجز</span><strong>{created.code}</strong>
        <button className="icon-button" onClick={() => { navigator.clipboard?.writeText(created.code); notify('تم نسخ كود الحجز.'); }} aria-label="نسخ الكود"><ClipboardList size={17} /></button></div>
      <dl className="success-summary">
        <div><dt>الدكتور</dt><dd>{created.doctorName}</dd></div>
        <div><dt>العيادة</dt><dd>{created.clinicName}{created.clinicFloor ? ` · ${created.clinicFloor}` : ''}{created.clinicRoom ? ` · غرفة ${created.clinicRoom}` : ''}</dd></div>
        <div><dt>الموعد</dt><dd>{dateLabel(created.bookingDate)} · {arTime(created.startTime)}</dd></div>
        <div><dt>السعر</dt><dd>{money(created.price)}</dd></div>
      </dl>
      <div className="success-actions">
        <button className="btn btn-primary" onClick={() => navigate('mybookings')}>حجوزاتي <ArrowLeft size={17} /></button>
        <button className="btn btn-outline" onClick={() => { setCreated(null); setTime(''); setReceipt(null); setNote(''); }}>حجز موعد آخر</button>
      </div>
    </div>
    <Footer building={building} go={go} />
  </main>;

  const anyAvailable = slots.some((s) => s.available);
  return <main className="content-page wrap">
    <div className="page-title"><h1>احجز موعدك</h1><p>اختار العيادة والدكتور واليوم، والمواعيد المحجوزة بتظهر مقفولة.</p></div>
    <form className="booking-layout" onSubmit={submit}>
      <div className="booking-main card">
        <Step n="1" title="العيادة">
          <div className="clinic-picker" role="radiogroup" aria-label="العيادة">
            {clinics.map((c) => { const Icon = clinicIcon(c); return <button type="button" role="radio" aria-checked={c.id === clinic?.id} key={c.id} className={c.id === clinic?.id ? 'clinic-pill selected' : 'clinic-pill'} onClick={() => { setClinicId(c.id); setDoctorId(null); setServiceId(null); }}><Icon size={17} />{c.name}</button>; })}
          </div>
          {clinic && <p className="clinic-where"><MapPin size={15} /> {[clinic.floor, clinic.room && `غرفة ${clinic.room}`].filter(Boolean).join(' · ') || clinic.specialty}</p>}
        </Step>
        <Step n="2" title="الدكتور">
          <div className="pick-grid">
            {clinic?.doctors.map((d) => <button type="button" key={d.id} className={d.id === doctorId ? 'pick selected' : 'pick'} onClick={() => setDoctorId(d.id)} aria-pressed={d.id === doctorId}>
              <span className="avatar">{initials(d.name)}</span><span className="pick-copy"><b>{d.name}</b><small>{d.title}{d.years_experience ? ` · خبرة ${d.years_experience} سنة` : ''}</small></span><span className="radio-dot" />
            </button>)}
            {!clinic?.doctors.length && <p className="muted">لا يوجد أطباء متاحون في هذه العيادة حاليًا.</p>}
          </div>
        </Step>
        <Step n="3" title="الخدمة">
          <div className="pick-grid">
            {clinic?.services.map((s) => <button type="button" key={s.id} className={s.id === serviceId ? 'pick selected' : 'pick'} onClick={() => setServiceId(s.id)} aria-pressed={s.id === serviceId}>
              <span className="pick-copy"><b>{s.name}</b><small>{s.duration_minutes} دقيقة{s.description ? ` · ${s.description}` : ''}</small></span><strong>{money(s.price)}</strong><span className="radio-dot" />
            </button>)}
          </div>
        </Step>
        <Step n="4" title="اليوم والميعاد">
          <div className="day-strip" role="radiogroup" aria-label="اليوم">
            {days.map((d, i) => <button type="button" role="radio" aria-checked={d === date} key={d} className={d === date ? 'day selected' : 'day'} onClick={() => setDate(d)}>
              <small>{i === 0 ? 'النهارده' : weekday(d)}</small><b>{dayNumber(d)}</b><small>{monthShort(d)}</small>
            </button>)}
          </div>
          {loadingSlots ? <div className="slots-loading"><LoaderCircle className="spin" size={20} /> بنراجع المواعيد...</div>
            : closedReason ? <div className="notice notice-warning"><CircleHelp size={18} /><span>{closedReason}</span></div>
              : <div className="time-grid" role="radiogroup" aria-label="الميعاد">
                {slots.map((s) => <button type="button" key={s.time} role="radio" aria-checked={time === s.time} disabled={!s.available} onClick={() => setTime(s.time)} className={`time-slot ${time === s.time ? 'selected' : ''}`}>{arTime(s.time)}{!s.available && <small>غير متاح</small>}</button>)}
                {slots.length > 0 && !anyAvailable && <p className="empty-inline">مفيش مواعيد متاحة في اليوم ده. جرّب يوم تاني.</p>}
                {!slots.length && <p className="empty-inline">اختار دكتور وخدمة عشان نعرضلك المواعيد.</p>}
              </div>}
        </Step>
        <Step n="5" title="التأكيد">
          <label className="field"><span>ملاحظات للدكتور <small>(اختياري)</small></span><textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="في حاجة حابب الدكتور يعرفها قبل الكشف؟" /></label>
          {settings.deposit_required ? <div className="deposit-box">
            <div className="deposit-head"><span className="deposit-icon"><Wallet size={19} /></span><div><b>العربون مطلوب لتأكيد الحجز</b><small>قيمة العربون: {money(settings.deposit_amount)}</small></div></div>
            <p className="payment-instructions">{settings.payment_instructions}</p>
            {settings.cancellation_policy && <p className="cancel-policy"><AlertTriangle size={16} /><span><b>سياسة الإلغاء:</b> {settings.cancellation_policy}</span></p>}
            <label className="upload-box"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setReceipt(e.target.files?.[0] || null)} />
              <span className="upload-icon"><UploadCloud size={21} /></span>
              <span className="upload-copy"><b>{receipt ? receipt.name : 'ارفع صورة إيصال التحويل'}</b><small>{receipt ? `${(receipt.size / 1024 / 1024).toFixed(2)} ميجابايت` : 'JPG أو PNG أو WEBP · حتى 5 ميجابايت'}</small></span>
              {receipt ? <CheckCircle2 className="upload-check" size={20} /> : <FileImage size={20} />}</label>
          </div> : <div className="notice notice-info"><ShieldCheck size={18} /><span>مفيش عربون مطلوب دلوقتي. الحجز بيتأكد بمجرد إرسال الطلب.</span></div>}
        </Step>
      </div>
      <aside className="booking-summary card" aria-label="ملخص الحجز">
        <h2><CalendarCheck size={20} /> ملخص الحجز</h2>
        <dl>
          <div><dt>الدكتور</dt><dd>{doctor?.name || '—'}</dd></div>
          <div><dt>العيادة</dt><dd>{clinic?.name || '—'}</dd></div>
          <div><dt>الخدمة</dt><dd>{service ? `${service.name} · ${service.duration_minutes} د` : '—'}</dd></div>
          <div><dt>اليوم</dt><dd>{dateLabel(date)}</dd></div>
          <div><dt>الميعاد</dt><dd>{time ? arTime(time) : 'لسه مختارتش'}</dd></div>
        </dl>
        <div className="summary-total"><span>سعر الخدمة</span><strong>{money(service?.price || 0)}</strong></div>
        {settings.deposit_required && <div className="summary-total"><span>العربون المطلوب</span><strong className="blue-text">{money(settings.deposit_amount)}</strong></div>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || !doctor || !service || !time}>{busy ? <LoaderCircle className="spin" size={18} /> : <Calendar size={18} />} تأكيد الحجز</button>
        <p className="summary-assurance"><Clock3 size={15} /> تقدر تلغي الحجز من صفحة حجوزاتي قبل الموعد.</p>
      </aside>
    </form>
    <Footer building={building} go={go} />
  </main>;
}
