import { arTime, dateLabel } from './lib.js';

// Turns a stored Egyptian (or already international) number into digits for wa.me. Returns null if it can't be trusted.
export function toWhatsAppNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;       // 201012345678
  if (d.startsWith('0') && d.length === 11) return `2${d}`;  // 01012345678 -> 201012345678
  if (d.length === 10 && d.startsWith('1')) return `20${d}`; // 1012345678
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d; // another country code
  return null;
}

const place = (b) => [b.clinicFloor && `الدور ${b.clinicFloor}`, b.clinicRoom && `غرفة ${b.clinicRoom}`].filter(Boolean).join(' - ');

export function bookingMessage(kind, b, businessName = 'دورك', policy = '') {
  const when = `${dateLabel(b.bookingDate)} الساعة ${arTime(b.startTime)}`;
  const who = [b.doctorName, b.clinicName].filter(Boolean).join(' — ');
  if (kind === 'cancelled') {
    return [
      `أهلاً ${b.customerName}،`,
      `تم إلغاء حجزك رقم ${b.code} (${who} · ${when}) في ${businessName}.`,
      b.depositAmount > 0 && String(policy || '').trim() && `📌 ${String(policy).trim()}`,
      'تقدر تحجز ميعاد جديد في أي وقت من الموقع.',
    ].filter(Boolean).join('\n');
  }
  return [
    `أهلاً ${b.customerName} 👋`,
    `تم تأكيد حجزك في ${businessName}.`,
    `🩺 ${who}`,
    `📅 ${when}`,
    place(b) && `📍 ${place(b)}`,
    `🔖 رقم الحجز: ${b.code}`,
    'لو محتاج تغيّر الحجز أو تلغيه ادخل على حسابك في الموقع. بنستناك!',
  ].filter(Boolean).join('\n');
}

export function whatsappLink(kind, b, businessName, policy) {
  const number = toWhatsAppNumber(b.customerPhone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(bookingMessage(kind, b, businessName, policy))}` : null;
}
