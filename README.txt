CocoBiz v20

Dropshipping-ready storefront update:
- Existing CocoBiz business/admin features retained.
- Public store updated for Gifts, Chocolates and Kitchen products.
- Added category filters: All, Gifts, Chocolates, Kitchen.
- Added product category field in Admin -> Products.
- Existing products without a category are treated as Gift by default.
- Contact email changed to help.cocobiz@yahoo.com.
- Product costPrice can continue to be used for supplier/landed cost tracking and profit calculation.


V22 updates:
- PhonePe/static UPI QR integrated using provided QR image.
- UPI ID default: kunalverma5555@ibl.
- Customer can pay by QR or UPI App deep link and submit UTR. Admin verifies manually.
- Platform fee can be enabled/disabled; disabled displays FREE/₹0.
- Delivery charge + free delivery threshold remain configurable in Store Settings.
- UPI/COD/Razorpay payment options can be enabled independently.


V23 fixes: UPI QR is embedded directly in index.html to prevent broken-image errors after deployment. Admin Store Settings navigation now opens correctly. Added QR preview inside Store Settings.


V26 CHANGE: Maximum delivery distance limit removed. Delivery is available at any distance. Within the configured free-delivery radius (default 10 km) delivery is FREE; beyond it, the configured delivery charge applies.


V27 TRACK ORDER FIX
- Customer tracking now reads a dedicated publicOrderTracking/{OrderID} document, so it works without admin login.
- Mobile number is stored only as a SHA-256 hash for the tracking check.
- New orders automatically create their tracking record.
- Admin status/payment/return changes sync to the public tracking record.
- IMPORTANT: deploy the updated Firestore rules before testing Track Order. Existing orders created before V27 may need to be recreated or synced by admin code.
