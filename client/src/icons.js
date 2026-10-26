import { Baby, Bone, Eye, HeartPulse, Smile, Sparkles, Stethoscope } from 'lucide-react';

export function clinicIcon(clinic) {
  const text = `${clinic?.name || ''} ${clinic?.specialty || ''}`;
  if (/أطفال/.test(text)) return Baby;
  if (/جلد|تجميل/.test(text)) return Sparkles;
  if (/أسنان|اسنان/.test(text)) return Smile;
  if (/عيون|عين/.test(text)) return Eye;
  if (/عظام|مفاصل/.test(text)) return Bone;
  if (/قلب/.test(text)) return HeartPulse;
  return Stethoscope;
}

export function groupByFloor(clinics) {
  const order = []; const map = new Map();
  clinics.forEach((c) => { const key = c.floor || 'بدون دور محدد'; if (!map.has(key)) { map.set(key, []); order.push(key); } map.get(key).push(c); });
  return order.map((floor) => ({ floor, clinics: map.get(floor) }));
}
