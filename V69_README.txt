COCOBIZ V69 - SUPABASE ORDER WRITE FIX

Two issues found in V68:
1) Supabase initialization was not awaited, so a fast checkout could run before the
   Supabase JS client finished loading.
2) The order mirror used .select() after upsert. Your RLS setup intentionally has
   no public SELECT policy on orders, so Supabase could reject the write response.

V69:
- awaits Supabase initialization before the app continues
- writes orders with upsert + ignoreDuplicates and no SELECT/returning
- keeps Firebase as the primary live system during transition
- does not require Firebase Functions deployment
- does not expose orders to anonymous SELECT
