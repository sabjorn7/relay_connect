-- sha256(payload below): 7f0c721428baf7a1260ed8c52030cdfdf4e32f65e6fa8a844f8d380ab16885e8
-- Откат: удалить ровно импортированные записи (user_id LIKE 'tg-import-vvk-%') из rating/comment.
-- Реальные отзывы/оценки не затрагиваются.
update public.course set
  rating = (select coalesce(jsonb_agg(e), '[]'::jsonb)
            from jsonb_array_elements(coalesce(rating,'[]'::jsonb)) e
            where coalesce(e->>'user_id','') not like 'tg-import-vvk-%'),
  comment = (select coalesce(jsonb_agg(e), '[]'::jsonb)
             from jsonb_array_elements(coalesce(comment,'[]'::jsonb)) e
             where coalesce(e->>'user_id','') not like 'tg-import-vvk-%')
where slug = 'vvodnyy-seminar-po-kineziologii';
