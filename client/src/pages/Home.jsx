import React from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, Clock3, MapPin, Phone, ShieldCheck, TicketCheck } from 'lucide-react';
import { clinicIcon, groupByFloor } from '../icons.js';
import { arTime, initials, money } from '../lib.js';
import { Footer, LoadingState } from '../ui.jsx';

function DirectoryBoard({ clinics, onPick }) {
  const floors = groupByFloor(clinics);
  return <aside className="directory" aria-label="دليل العيادات حسب الدور">
    <div className="directory-head"><b>دليل المبنى</b><span>{clinics.length} عيادات</span></div>
    <div className="directory-body">
      {floors.map(({ floor, clinics: list }) => <section className="directory-floor" key={floor}>
        <h3>{floor}</h3>
        <ul>{list.map((c) => { const Icon = clinicIcon(c); return <li key={c.id}>
          <button onClick={() => onPick(c.id)}>
            <span className="directory-icon"><Icon size={18} /></span>
            <span className="directory-name"><b>{c.name}</b><small>{c.specialty}</small></span>
            {c.room && <span className="room-chip">غرفة {c.room}</span>}
            <ChevronLeft size={17} className="directory-arrow" />
          </button>
        </li>; })}</ul>
      </section>)}
    </div>
  </aside>;
}

export default function HomePage({ data, user, go }) {
  if (!data) return <main className="wrap"><LoadingState label="بنحمّل دليل المبنى..." /></main>;
  const { building, clinics, settings } = data;
  const book = (clinicId, doctorId) => go('booking', { clinicId, doctorId });
  const doctorCount = clinics.reduce((n, c) => n + c.doctors.length, 0);
  return <main>
    <section className="hero wrap">
      <div className="hero-copy">
        <h1>احجز دورك في أي عيادة من عيادات المبنى</h1>
        <p>{clinics.length} عيادات متخصصة تحت سقف واحد. اختار التخصص والدكتور والميعاد من الموبايل، وتعالى على وقتك من غير انتظار.</p>
        <div className="hero-buttons">
          <button className="btn btn-primary btn-lg" onClick={() => book()}>احجز موعد <ArrowLeft size={18} /></button>
          {user?.role === 'customer'
            ? <button className="btn btn-outline btn-lg" onClick={() => go('mybookings')}>حجوزاتي</button>
            : <button className="btn btn-outline btn-lg" onClick={() => go('auth')}>إنشاء حساب</button>}
        </div>
        <dl className="hero-facts">
          <div><dt>الأطباء</dt><dd>{doctorCount}</dd></div>
          <div><dt>العيادات</dt><dd>{clinics.length}</dd></div>
          <div><dt>مواعيد الحجز</dt><dd>{arTime(settings.opening_time)} – {arTime(settings.closing_time)}</dd></div>
        </dl>
      </div>
      <DirectoryBoard clinics={clinics} onPick={(id) => book(id)} />
    </section>

    <section className="clinics-section wrap" id="clinics">
      <div className="section-heading"><div><h2>العيادات والأطباء</h2><p>اضغط على اسم الدكتور وهنفتحلك مواعيده على طول.</p></div></div>
      <div className="clinic-grid">
        {clinics.map((c) => { const Icon = clinicIcon(c); return <article className="clinic-card" key={c.id}>
          <header>
            <span className="clinic-icon"><Icon size={22} /></span>
            <div><h3>{c.name}</h3><p>{c.specialty}</p></div>
            <span className="room-chip">{[c.floor, c.room && `غرفة ${c.room}`].filter(Boolean).join(' · ')}</span>
          </header>
          {c.description && <p className="clinic-desc">{c.description}</p>}
          <ul className="doctor-list">
            {c.doctors.map((d) => <li key={d.id}><button onClick={() => book(c.id, d.id)}>
              <span className="avatar">{initials(d.name)}</span>
              <span className="doctor-copy"><b>{d.name}</b><small>{d.title}{d.years_experience ? ` · خبرة ${d.years_experience} سنة` : ''}</small></span>
              <span className="doctor-go">احجز <ArrowLeft size={15} /></span>
            </button></li>)}
            {!c.doctors.length && <li className="muted">لا يوجد أطباء متاحون حاليًا.</li>}
          </ul>
          {c.services.length > 0 && <p className="clinic-price"><Clock3 size={14} /> الخدمات تبدأ من <b>{money(Math.min(...c.services.map((s) => s.price)))}</b></p>}
        </article>; })}
        {!clinics.length && <div className="empty-state"><b>العيادات هتظهر هنا قريبًا</b></div>}
      </div>
    </section>

    <section className="how-section">
      <div className="wrap how-inner">
        <h2>الحجز في ثلاث خطوات</h2>
        <ol className="steps">
          <li><span className="step-icon"><CalendarDays size={22} /></span><div><h3>اختار الدكتور والميعاد</h3><p>الأوقات المحجوزة بتظهر مقفولة، فمفيش تعارض.</p></div></li>
          <li><span className="step-icon"><ShieldCheck size={22} /></span><div><h3>أكد الحجز</h3><p>لو العربون مفعّل، ارفع صورة الإيصال والإدارة هتراجعها.</p></div></li>
          <li><span className="step-icon"><TicketCheck size={22} /></span><div><h3>وصّل واعرض الكود</h3><p>كود الحجز بتقدمه عند الاستقبال في الدور المكتوب.</p></div></li>
        </ol>
      </div>
    </section>

    <section className="info-strip wrap">
      <div><MapPin size={19} /><span><b>العنوان</b>{building.address || 'سيتم إضافته قريبًا'}</span></div>
      <div><Phone size={19} /><span><b>للتواصل</b><span dir="ltr">{building.phone || '—'}</span></span></div>
      <div><Clock3 size={19} /><span><b>ساعات الحجز</b>{arTime(settings.opening_time)} – {arTime(settings.closing_time)}</span></div>
    </section>
    <Footer building={building} go={go} />
  </main>;
}
