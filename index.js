const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

exports.adminChangeSalesmanPassword = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Admin login required.');

  const db = getFirestore();
  const adminSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!adminSnap.exists || adminSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admin can change a salesman password.');
  }

  const { salesmanUid, newPassword } = request.data || {};
  if (!salesmanUid || typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new HttpsError('invalid-argument', 'Salesman ID और कम से कम 6 characters का password दें।');
  }

  const salesmanSnap = await db.collection('users').doc(salesmanUid).get();
  if (!salesmanSnap.exists || salesmanSnap.data().role !== 'salesman') {
    throw new HttpsError('not-found', 'Salesman नहीं मिला।');
  }

  await getAuth().updateUser(salesmanUid, { password: newPassword });
  return { success: true };
});

// Runs every 15 minutes and physically removes expired offers. The website
// also hides expired offers immediately on the client, so customers never
// need to wait for this cleanup job to stop seeing an expired poster.
exports.cleanupExpiredOffers = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const db = getFirestore();
  const now = Date.now();
  const snap = await db.collection('offers').where('endAt', '<=', now).get();
  if (snap.empty) return null;

  const batch = db.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return null;
});


exports.createRazorpayOrder = onCall(async (request) => {
  const { amount, currency = 'INR', receipt } = request.data || {};
  if (!Number.isInteger(amount) || amount < 100 || !receipt) throw new HttpsError('invalid-argument', 'Valid amount and receipt required.');
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new HttpsError('failed-precondition', 'Razorpay server keys are not configured.');
  const razorpay = new Razorpay({ key_id, key_secret });
  try { return await razorpay.orders.create({ amount, currency, receipt, payment_capture: 1 }); }
  catch (e) { throw new HttpsError('internal', e.message || 'Razorpay order creation failed.'); }
});

exports.verifyRazorpayPayment = onCall(async (request) => {
  const { orderId, paymentId, signature, clientId } = request.data || {};
  if (!orderId || !paymentId || !signature || !clientId) throw new HttpsError('invalid-argument', 'Payment verification data missing.');
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new HttpsError('failed-precondition', 'Razorpay server secret is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  if (expected !== signature) throw new HttpsError('permission-denied', 'Invalid payment signature.');
  const db = getFirestore();
  const snap = await db.collection('orders').where('clientId', '==', clientId).limit(1).get();
  if (!snap.empty) await snap.docs[0].ref.update({ paymentStatus: 'paid', paymentId, updatedAt: Date.now() });
  return { verified: true };
});


exports.redeemCoupon = onCall(async (request) => {
  const data = request.data || {};
  const code = String(data.code || '').trim().toUpperCase();
  const customerNumber = String(data.customerNumber || '').trim();
  if (!code) throw new HttpsError('invalid-argument', 'Coupon code required.');
  const db = getFirestore();
  const ref = db.collection('coupons').doc(code);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');
    const c = snap.data();
    if (c.active === false) throw new HttpsError('failed-precondition', 'Coupon inactive.');
    if (c.validUntil && Date.now() > Number(c.validUntil)) throw new HttpsError('failed-precondition', 'Coupon expired.');
    const count = Number(c.usageCount || 0);
    if (Number(c.usageLimit || 0) > 0 && count >= Number(c.usageLimit)) throw new HttpsError('resource-exhausted', 'Coupon usage limit reached.');
    const customers = Array.isArray(c.customerNumbers) ? c.customerNumbers : [];
    if (customerNumber && Number(c.perCustomerLimit || 0) > 0) {
      const used = customers.filter(x => String(x) === customerNumber).length;
      if (used >= Number(c.perCustomerLimit)) throw new HttpsError('resource-exhausted', 'Per-customer coupon limit reached.');
    }
    tx.update(ref, { usageCount: count + 1, customerNumbers: customerNumber ? [...customers, customerNumber] : customers, lastRedeemedAt: Date.now() });
  });
  return { success: true };
});
