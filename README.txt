# CocoBiz Updated

Changes included:
1. Firebase/Firestore order sync improvements + offline persistence/retry queue.
2. Admin Panel hidden from the header; tap the CocoBiz logo to open login/admin.
3. Firebase Auth LOCAL persistence: login remains until logout.
4. Product search on the main page.
5. Return-item system in Admin Orders; returned items and net total appear on the bill.
6. Unique order-complete popup with Contact and Call buttons.
7. Fixed deployed filename mismatches by using index.html, script.js and styles.css.

IMPORTANT - Firebase Firestore Rules:
Use firestore.rules in Firebase Console > Firestore Database > Rules.
The public website can create orders, but only authenticated users can read/update/delete orders.

Upload these 3 website files to your hosting:
- index.html
- script.js
- styles.css

Keep firestore.rules for Firebase configuration.
