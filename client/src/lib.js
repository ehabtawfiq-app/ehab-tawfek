export async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'حصل خطأ. حاول مرة أخرى.');
  return data;
}

const LATN = 'ar-EG-u-nu-latn';
export const money = (v) => `${Number(v || 0).toLocaleString('en-US')} ج.م`;
export const localDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const at = (value) => new Date(`${value}T12:00:00`);
export const dateLabel = (v) => { if (!v) return '—'; try { return new Intl.DateTimeFormat(LATN, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at(v)); } catch { return v; } };
export const weekday = (v) => new Intl.DateTimeFormat(LATN, { weekday: 'short' }).format(at(v));
export const dayNumber = (v) => String(Number(v.slice(8, 10)));
export const monthShort = (v) => new Intl.DateTimeFormat(LATN, { month: 'short' }).format(at(v));
export const arTime = (t) => {
  if (!t) return '—';
  const h = Number(t.slice(0, 2)); const m = t.slice(3, 5);
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'م' : 'ص'}`;
};
export const initials = (name = '') => name.replace(/^د\.?\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ');

export const statusLabels = {
  pending_payment: 'في انتظار الدفع', pending_review: 'مراجعة العربون', confirmed: 'مؤكد',
  checked_in: 'وصل العميل', completed: 'مكتمل', cancelled: 'ملغي',
};
export const navigate = (page) => window.dispatchEvent(new CustomEvent('dorak:navigate', { detail: page }));
