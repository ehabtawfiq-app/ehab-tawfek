import React from 'react';
import { ArrowLeft, FileText, ExternalLink, Github, Instagram, Linkedin, Mail, MapPin, MessageCircle } from 'lucide-react';
import { developer } from '../portfolio.config.js';

const statusClass = { 'جاهز': 'ready', 'نسخة تجريبية': 'ready' };

export default function PortfolioPage({ go }) {
  const { links } = developer;
  const external = { target: '_blank', rel: 'noopener noreferrer' };
  return <main className="portfolio wrap content-page">
    <button className="text-link" onClick={() => go('home')}><ArrowLeft size={15} /> الرجوع لموقع الحجز</button>
    <div className="portfolio-layout">
      <aside className="profile card">
        <span className="profile-mark" aria-hidden="true">{developer.name.slice(0, 1)}</span>
        <h1>{developer.name}</h1>
        <p className="profile-role">{developer.role}</p>
        <p className="profile-place"><MapPin size={15} /> {developer.location}</p>
        <div className="profile-links">
          {links.cv && <a className="btn btn-primary btn-block" href={links.cv} {...external}><FileText size={17} /> السيرة الذاتية (CV)</a>}
          {links.github && <a className="btn btn-outline btn-block" href={links.github} {...external}><Github size={17} /> GitHub</a>}
          {links.linkedin && <a className="btn btn-outline btn-block" href={links.linkedin} {...external}><Linkedin size={17} /> LinkedIn</a>}
          {links.instagram && <a className="btn btn-outline btn-block" href={links.instagram} {...external}><Instagram size={17} /> Instagram</a>}
          {links.whatsapp && <a className="btn btn-outline btn-block" href={`https://wa.me/${links.whatsapp}`} {...external}><MessageCircle size={17} /> واتساب</a>}
          {links.email && <a className="btn btn-outline btn-block" href={`mailto:${links.email}`}><Mail size={17} /> {links.email}</a>}
        </div>
      </aside>

      <div className="portfolio-body">
        <section><h2>نبذة</h2><p className="about">{developer.summary}</p></section>
        <section>
          <h2>أعمال مختارة</h2>
          <ul className="works">
            {developer.works.map((w) => <li key={w.title}>
              <div className="work-head"><h3>{w.title}</h3><span className={`work-status ${statusClass[w.status] || ''}`}>{w.status}</span></div>
              <p>{w.text}</p>
              <div className="tags">{w.tags.map((t) => <span key={t}>{t}</span>)}{w.url && <a href={w.url} {...external}><ExternalLink size={14} /> فتح</a>}</div>
            </li>)}
          </ul>
        </section>
        <section><h2>الأدوات والتقنيات</h2><div className="tags big">{developer.stack.map((s) => <span key={s}>{s}</span>)}</div></section>
        <section className="work-cta card">
          <div><h2>عندك فكرة أو نظام محتاج يتبني؟</h2><p>كلمني وأقولك الأنسب لشغلك: برنامج مكتبي أو تطبيق ويب.</p></div>
          {(links.whatsapp || links.email || links.linkedin) && <a className="btn btn-primary btn-lg" href={links.whatsapp ? `https://wa.me/${links.whatsapp}` : links.email ? `mailto:${links.email}` : links.linkedin} {...external}>تواصل معي <ArrowLeft size={18} /></a>}
        </section>
      </div>
    </div>
  </main>;
}
