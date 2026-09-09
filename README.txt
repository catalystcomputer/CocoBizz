CocoBiz v20

Added:
1. Two-step customer checkout: customer/products/details -> payment -> confirm.
2. Admin Settings: UPI ID + optional business QR upload; dynamic exact-amount UPI QR is generated from the UPI ID.
3. Coupon system: admin can generate multiple percentage/fixed coupons, set minimum order, max uses, start/end validity, and delete them.
4. Public order tracking using Order ID + mobile number. Delivery window shows 7-15 days only when customer location is within 25 km of the store location configured in Admin -> Settings.
5. Admin can set store coordinates from the admin device's browser location permission.
6. Tracking record is stored separately with a SHA-256 mobile hash; full mobile number is not stored in the public tracking record.

Deployment:
- Replace the website files in GitHub/Vercel with this version.
- Deploy firestore.rules to Firebase.
- Existing Firebase Cloud Functions remain in functions/.

Important:
- Set UPI ID in Admin -> Settings for exact-amount QR payment.
- Set store location once in Admin -> Settings using the device location button.
- Online UPI payment is not automatically verified by this client-only checkout; admin should mark payment received after confirming payment.
