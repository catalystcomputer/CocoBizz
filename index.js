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


function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function couponCustomerHash(code, mobile) {
  return crypto.createHash('sha256').update(`${String(code).toUpperCase()}|${normalizeMobile(mobile)}`).digest('hex');
}

function publicCouponData(code, c) {
  return {
    code: String(code).toUpperCase(),
    benefit: c.benefit === 'free_delivery' ? 'free_delivery' : 'product_discount',
    type: c.type === 'percent' ? 'percent' : 'flat',
    value: Number(c.value || 0),
    minOrder: Math.max(0, Number(c.minOrder || 0)),
    maxDiscount: Math.max(0, Number(c.maxDiscount || 0)),
    usageLimit: Math.max(0, Number(c.usageLimit || 0)),
    validUntil: c.validUntil ? Number(c.validUntil) : null,
    visibility: c.visibility === 'private' ? 'private' : 'public'
  };
}

exports.validateCoupon = onCall(async (request) => {
  const data = request.data || {};
  const code = String(data.code || '').trim().toUpperCase().replace(/\s+/g, '');
  const customerNumber = normalizeMobile(data.customerNumber);
  if (!code) throw new HttpsError('invalid-argument', 'Coupon code required.');

  const db = getFirestore();
  const snap = await db.collection('coupons').doc(code).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');
  const c = snap.data();
  if (c.active === false) throw new HttpsError('failed-precondition', 'Coupon inactive.');
  if (c.validUntil && Date.now() > Number(c.validUntil)) throw new HttpsError('failed-precondition', 'Coupon expired.');
  if (Number(c.usageLimit || 0) > 0 && Number(c.usageCount || 0) >= Number(c.usageLimit)) {
    throw new HttpsError('resource-exhausted', 'Coupon usage limit reached.');
  }

  if (c.visibility === 'private') {
    const hashes = Array.isArray(c.privateCustomerHashes) ? c.privateCustomerHashes : [];
    const legacy = Array.isArray(c.privateCustomers) ? c.privateCustomers.map(normalizeMobile) : [];
    const allowed = hashes.includes(couponCustomerHash(code, customerNumber)) || legacy.includes(customerNumber);
    if (!customerNumber || !allowed) throw new HttpsError('permission-denied', 'Ye private coupon is mobile number ke liye valid nahi hai.');
  }

  return publicCouponData(code, c);
});

exports.redeemCoupon = onCall(async (request) => {
  const data = request.data || {};
  const code = String(data.code || '').trim().toUpperCase().replace(/\s+/g, '');
  const customerNumber = normalizeMobile(data.customerNumber);
  const subtotal = Math.max(0, Number(data.subtotal || 0));
  const delivery = Math.max(0, Number(data.delivery || 0));
  const platformFee = Math.max(0, Number(data.platformFee || 0));
  if (!code) throw new HttpsError('invalid-argument', 'Coupon code required.');

  const db = getFirestore();
  const ref = db.collection('coupons').doc(code);
  let result;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');
    const c = snap.data();
    if (c.active === false) throw new HttpsError('failed-precondition', 'Coupon inactive.');
    if (c.validUntil && Date.now() > Number(c.validUntil)) throw new HttpsError('failed-precondition', 'Coupon expired.');
    const count = Number(c.usageCount || 0);
    const usageLimit = Number(c.usageLimit || 0);
    if (usageLimit > 0 && count >= usageLimit) throw new HttpsError('resource-exhausted', 'Coupon usage limit reached.');
    if (subtotal < Number(c.minOrder || 0)) throw new HttpsError('failed-precondition', `Minimum order ${Number(c.minOrder || 0)} required.`);

    if (c.visibility === 'private') {
      const hashes = Array.isArray(c.privateCustomerHashes) ? c.privateCustomerHashes : [];
      const legacy = Array.isArray(c.privateCustomers) ? c.privateCustomers.map(normalizeMobile) : [];
      const allowed = hashes.includes(couponCustomerHash(code, customerNumber)) || legacy.includes(customerNumber);
      if (!customerNumber || !allowed) throw new HttpsError('permission-denied', 'Private coupon is not valid for this mobile number.');
    }

    const perCustomerLimit = Number(c.perCustomerLimit || 0);
    const customerHash = customerNumber ? couponCustomerHash(code, customerNumber) : '';
    const usageMap = (c.usageByCustomer && typeof c.usageByCustomer === 'object') ? c.usageByCustomer : {};
    if (perCustomerLimit > 0 && customerHash && Number(usageMap[customerHash] || 0) >= perCustomerLimit) {
      throw new HttpsError('resource-exhausted', 'Per-customer coupon limit reached.');
    }

    const beforeCoupon = subtotal + delivery + platformFee;
    let discount = 0;
    if (c.benefit === 'free_delivery') {
      discount = Math.min(delivery, beforeCoupon);
    } else if (c.type === 'percent') {
      discount = subtotal * Number(c.value || 0) / 100;
    } else {
      discount = Number(c.value || 0);
    }
    if (c.benefit !== 'free_delivery' && Number(c.maxDiscount || 0) > 0) discount = Math.min(discount, Number(c.maxDiscount));
    discount = Math.max(0, Math.min(discount, beforeCoupon));

    const nextMap = { ...usageMap };
    if (customerHash) nextMap[customerHash] = Number(nextMap[customerHash] || 0) + 1;
    const update = { usageCount: count + 1, lastRedeemedAt: Date.now() };
    if (customerHash) update.usageByCustomer = nextMap;
    tx.update(ref, update);
    result = { ...publicCouponData(code, c), couponDiscount: discount, grandTotal: Math.max(0, beforeCoupon - discount) };
  });
  return result;
});

exports.migratePrivateCoupons = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Admin login required.');
  const db = getFirestore();
  const adminSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!adminSnap.exists || adminSnap.data().role !== 'admin') throw new HttpsError('permission-denied', 'Only admin can migrate coupons.');
  const snap = await db.collection('coupons').where('visibility', '==', 'private').get();
  if (snap.empty) return { migrated: 0 };
  const batch = db.batch();
  let migrated = 0;
  snap.docs.forEach(doc => {
    const c = doc.data();
    const mobiles = Array.isArray(c.privateCustomers) ? c.privateCustomers.map(normalizeMobile).filter(Boolean) : [];
    if (!mobiles.length) return;
    const hashes = Array.from(new Set(mobiles.map(m => couponCustomerHash(doc.id, m))));
    batch.update(doc.ref, { privateCustomerHashes: hashes, privateCustomers: [] });
    migrated += 1;
  });
  await batch.commit();
  return { migrated };
});

