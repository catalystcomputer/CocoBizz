COCOBIZ V67 - SAFE SUPABASE TRANSITION

V66 is not used in this build because its Firestore-to-Supabase adapter made the storefront depend on a partially migrated backend.

V67 restores the proven V63 Firebase application unchanged for authentication, products, admin, salesmen, offers, coupons and all existing features. Supabase is connected as a non-blocking secondary order mirror. This prevents the storefront/admin from breaking while the Supabase migration is completed safely.

Next stage, after this version is confirmed working:
1. Migrate existing Firebase products/orders/settings into Supabase.
2. Add Supabase Auth and roles.
3. Move admin writes behind authenticated Supabase policies/functions.
4. Remove Firebase only after end-to-end testing.

Do not delete the Firebase project yet.
