const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../client/src/whatsapp.js');
const booking = { customerName: 'منى أحمد', customerPhone: '01012345678', code: 'DRK-261025-AB12CD', doctorName: 'د. سارة', clinicName: 'عيادة الجلدية', clinicFloor: '2', clinicRoom: '204', bookingDate: '2026-11-05', startTime: '15:30' };

test('phone numbers are normalised for wa.me', async () => {
  const { toWhatsAppNumber: n } = await load();
  assert.equal(n('01012345678'), '201012345678');
  assert.equal(n('+20 101 234 5678'), '201012345678');
  assert.equal(n('0020 101 234 5678'), '201012345678');
  assert.equal(n('1012345678'), '201012345678');
  assert.equal(n('+966501234567'), '966501234567');
  assert.equal(n('12345'), null);
  assert.equal(n(''), null);
  assert.equal(n(undefined), null);
});

test('confirmation message has the booking details', async () => {
  const { bookingMessage } = await load();
  const text = bookingMessage('confirmed', booking, 'مبنى النور');
  for (const part of ['منى أحمد', 'تم تأكيد حجزك', 'مبنى النور', 'د. سارة', 'عيادة الجلدية', booking.code, '3:30 م', 'غرفة 204']) assert.ok(text.includes(part), part);
  assert.ok(!text.includes('إلغاء حجزك'));
});

test('cancellation message says cancelled and keeps the code', async () => {
  const { bookingMessage } = await load();
  const text = bookingMessage('cancelled', booking, 'مبنى النور');
  assert.ok(text.includes('تم إلغاء حجزك') && text.includes(booking.code) && text.includes('مبنى النور'));
  assert.ok(!text.includes('تم تأكيد'));
});

test('link is a wa.me URL with the encoded text, or null for a bad number', async () => {
  const { whatsappLink, bookingMessage } = await load();
  const url = new URL(whatsappLink('confirmed', booking, 'مبنى النور'));
  assert.equal(url.origin + url.pathname, 'https://wa.me/201012345678');
  assert.equal(url.searchParams.get('text'), bookingMessage('confirmed', booking, 'مبنى النور'));
  assert.equal(whatsappLink('confirmed', { ...booking, customerPhone: '123' }, 'x'), null);
});

test('cancellation message includes the no-refund policy only when a deposit was paid', async () => {
  const { bookingMessage } = await load();
  const policy = 'العربون غير مسترد في حالة إلغاء الحجز.';
  assert.ok(bookingMessage('cancelled', { ...booking, depositAmount: 50 }, 'مبنى النور', policy).includes(policy));
  assert.ok(!bookingMessage('cancelled', { ...booking, depositAmount: 0 }, 'مبنى النور', policy).includes(policy));
  assert.ok(!bookingMessage('cancelled', { ...booking, depositAmount: 50 }, 'مبنى النور', '').includes('📌'));
  assert.ok(!bookingMessage('confirmed', { ...booking, depositAmount: 50 }, 'مبنى النور', policy).includes(policy));
});
