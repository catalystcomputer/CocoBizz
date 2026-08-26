const { onCall, HttpsError } = require('firebase-functions/v2/https');
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
