import React, { useState } from 'react';
import { ArrowLeft, LoaderCircle, LogIn, Phone, ShieldCheck, User, UserRound, X } from 'lucide-react';
import { api } from '../lib.js';
import { Brand } from '../ui.jsx';

export default function AuthPage({ onSuccess, onCancel, notify, initialMode = 'login', buildingName }) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', phone: '', email: '', password: '' });
  const change = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));
  const login = mode === 'login';
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { onSuccess((await api(login ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body: JSON.stringify(form) })).user); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }
  return <main className="auth-page wrap">
    <div className="auth-aside">
      <h1>{login ? 'أهلًا بيك تاني' : 'ابدأ بحساب واحد لكل العيادات'}</h1>
      <p>{login ? 'سجّل دخولك عشان تتابع حجوزاتك وتعرف تفاصيل مواعيدك.' : 'اعمل حساب في ثواني، واحجز عند أي دكتور في المبنى من غير مكالمات.'}</p>
      <ul><li><ShieldCheck size={18} /> حساب خاص بحجوزاتك</li><li><ShieldCheck size={18} /> متابعة حالة كل حجز</li><li><ShieldCheck size={18} /> كود تأكيد لكل موعد</li></ul>
    </div>
    <div className="auth-card">
      <div className="auth-card-head"><Brand name={buildingName} /><button className="icon-button" onClick={onCancel} aria-label="العودة"><X size={18} /></button></div>
      <h2>{login ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}</h2>
      <form className="form-stack" onSubmit={submit}>
        {!login && <>
          <label className="field"><span>الاسم بالكامل</span><div className="input-wrap"><UserRound size={17} /><input value={form.name} onChange={change('name')} placeholder="مثال: أحمد محمد" autoComplete="name" required minLength={2} /></div></label>
          <label className="field"><span>رقم الموبايل</span><div className="input-wrap"><Phone size={17} /><input value={form.phone} onChange={change('phone')} placeholder="01xxxxxxxxx" autoComplete="tel" inputMode="tel" required minLength={7} dir="ltr" /></div></label>
          <label className="field"><span>البريد الإلكتروني <small>(اختياري)</small></span><div className="input-wrap"><span className="input-letter">@</span><input type="email" value={form.email} onChange={change('email')} placeholder="name@example.com" autoComplete="email" dir="ltr" /></div></label>
        </>}
        <label className="field"><span>اسم المستخدم</span><div className="input-wrap"><User size={17} /><input value={form.username} onChange={change('username')} autoComplete="username" required minLength={3} dir="ltr" /></div></label>
        <label className="field"><span>كلمة المرور</span><div className="input-wrap"><ShieldCheck size={17} /><input type="password" value={form.password} onChange={change('password')} placeholder="8 أحرف على الأقل" required minLength={8} autoComplete={login ? 'current-password' : 'new-password'} dir="ltr" /></div></label>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : login ? <LogIn size={18} /> : <UserRound size={18} />}{login ? 'دخول' : 'إنشاء الحساب'}</button>
      </form>
      <p className="auth-switch">{login ? 'معندكش حساب؟' : 'عندك حساب؟'} <button onClick={() => setMode(login ? 'register' : 'login')}>{login ? 'أنشئ حساب جديد' : 'سجّل دخولك'}</button></p>
      <button className="text-link auth-back" onClick={onCancel}><ArrowLeft size={15} /> الرجوع للموقع</button>
    </div>
  </main>;
}
