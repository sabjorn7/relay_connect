-- sha256(payload below, вставлять БЕЗ этой строки): 24fd55ffeb5e5f5036ef398988b864952d4f9933eb6615bd777a45a63303ba49

drop function if exists public.verify_prodamus_sign(text, text);
drop table if exists public.payment_secrets;
