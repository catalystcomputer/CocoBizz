COCOBIZ V68 - SUPABASE ORDER SAVE FIX

The V67 secondary mirror used column names from an older schema. The actual
Supabase orders table created by the CocoBiz migration uses:
- id
- client_id
- customer (jsonb)
- items (jsonb)
- returns
- subtotal
- delivery_charge
- platform_fee
- coupon_code
- coupon_discount
- total
- original_total
- returned_total
- net_total
- paid_amount
- due_amount
- payment_method
- payment_status
- payment_history
- status
- salesman_id/name/number
- delivery_estimate
- delivery_distance_km
- mobile_hash
- utr
- payment_id
- source
- date
- created_at/updated_at (bigint)

V68 now writes that exact shape and checks the Supabase response.
Firebase remains the primary order system during this transition, so a Supabase
failure does not break checkout.

No Firebase Functions deployment is required for this fix.
