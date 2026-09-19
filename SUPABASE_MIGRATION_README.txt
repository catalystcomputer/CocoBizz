CocoBiz Supabase Migration – V66

1. In Supabase Dashboard -> SQL Editor, run supabase/schema.sql completely.
2. Upload the website files from this ZIP.
3. The website is configured for project:
   https://dcbxntolnismscmurfop.supabase.co
4. The browser uses the Supabase anon/publishable client key. Supabase documents this browser pattern; secret/service_role keys must never be put in the browser.
5. Existing Firebase Auth is retained temporarily as a login bridge so the current admin/salesman login and password-reset screens do not break while business data moves to Supabase.
6. Products, orders, customers, users, salesmen, offers, coupons, settings and tracking now use the Supabase database adapter.
7. Orders use clientId as their Supabase document ID, so retries upsert the same order instead of creating duplicates.

IMPORTANT SECURITY NOTE:
The included SQL contains TEMPORARY migration policies because the current login still uses Firebase Auth. That means the Supabase tables are broadly accessible through the anon key during migration. Do not treat this as the final production security model. The next stage should migrate Admin/Salesman Auth to Supabase Auth and replace these policies with authenticated/admin RLS policies.

Do NOT paste or deploy a Supabase secret/service_role key into the website.
