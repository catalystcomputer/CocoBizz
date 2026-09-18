COCOBIZ SUPABASE MIGRATION – STARTER

This package keeps your existing CocoBiz website/features and adds the Supabase migration foundation.

IMPORTANT:
- Your current V63 code is still Firebase-based. I have NOT silently replaced every Firebase call because doing so without your Supabase project URL/key and database setup could break the existing store.
- First create the Supabase project and run supabase/schema.sql in Supabase SQL Editor.
- Then copy supabase/supabase-config.example.js to a config file and enter ONLY the Supabase Project URL and anon/public key.
- Do NOT put a Supabase service_role key in the website.

What is prepared:
- Products table
- Orders table
- Customers table
- Salesmen table
- Offers table
- Coupons table
- Store settings
- Public order tracking
- Basic RLS/public catalogue policies

Next migration stage:
1. Create the Supabase project.
2. Run schema.sql.
3. Provide the project URL + anon key (these are safe client-side credentials).
4. Migrate the existing JS data operations from Firestore to Supabase.
5. Test customer order -> database -> Admin Orders.
6. Only after successful testing, remove Firebase dependencies.

DO NOT delete your existing Firebase project/data yet.
