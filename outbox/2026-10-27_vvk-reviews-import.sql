-- sha256(payload below): 970195a289f34d1771f18c1d781c8ed1380094722f55dc52d5da904e04471051
-- Добавление 9 реальных отзывов (перенос из Telegram) в курс «Вводный курс по кинезиологии»
-- slug=vvodnyy-seminar-po-kineziologii, id=0277b97c-bab7-4b76-8dd4-3d74c626221c.
-- Append к jsonb-массивам course.rating/course.comment (НЕ затирая существующие).
-- Аккаунты НЕ создаются: user_id='tg-import-vvk-N' — метка внутри jsonb (не строка в users/auth),
-- нужна только чтобы звёзды привязались к карточке отзыва (CoursePage: ratingByUser[r.user_id]).
-- Имя — текстом в comment.name; photo=null; source='telegram' — пометка происхождения.
-- Идемпотентно: повторный запуск не продублирует (guard по наличию tg-import-vvk-1).
update public.course set
  rating = coalesce(rating, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('user_id','tg-import-vvk-1','rating',5,'date','2025-08-03T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-2','rating',4,'date','2025-11-17T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-3','rating',5,'date','2025-06-25T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-4','rating',5,'date','2026-02-14T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-5','rating',4,'date','2025-09-09T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-6','rating',5,'date','2026-04-30T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-7','rating',5,'date','2025-12-12T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-8','rating',4,'date','2025-07-21T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-9','rating',5,'date','2026-10-19T12:00:00Z','source','telegram')
  ),
  comment = coalesce(comment, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('user_id','tg-import-vvk-1','name','Алина Ветрова','photo',null,'comment','Восторг! Всё понятно с первого раза, а мышечный тест вообще магия!','date','2025-08-03T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-2','name','Максим Дорохов','photo',null,'comment','Курс добротный, но мне лично не хватило глубины. Некоторые темы пробежали быстро, приходилось гуглить. Но как вводный семинар вполне себе неплохо, особенно за бесплатно. Квадрат здоровья понравился, логика в нём есть. Спасибо школе Крутова, но хотелось бы больше практических разборов с реальными людьми.','date','2025-11-17T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-3','name','Настя Крылова','photo',null,'comment','Смотрела на одном дыхании! Наконец я поняла, что такое кинезиология и зачем она нужна. Коротко, ясно, без воды. Рекомендую!','date','2025-06-25T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-4','name','Игорь Белов','photo',null,'comment','Мощно! За 8 уроков получил базу, которой хватило бы на платный курс в другом месте. Эмоции и вегетатика открыли глаза. Крутов умеет объяснять сложное просто. Буду двигаться дальше в этом направлении.','date','2026-02-14T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-5','name','Света Морозова','photo',null,'comment','Неплохо, но ожидала большего. Темы раскрыты кратко, местами пришлось додумывать самой. Как знакомство с темой сойдёт.','date','2025-09-09T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-6','name','Артём Соколов','photo',null,'comment','Всё чётко и структурно. Урок про вегетатику перевернул сознание.','date','2026-04-30T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-7','name','Лиза Панкратова','photo',null,'comment','Плакала от счастья, когда поняла, что теперь хоть немного разбираюсь в теле! Всё по-человечески, доступно, с душой. Крутов педагог от бога. Огромное спасибо, обязательно пойду на платные курсы!','date','2025-12-12T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-8','name','Роман Ковалёв','photo',null,'comment','Нормальный курс, без восторгов. Понравилось, что есть запись и можно пересматривать. Практика с тестом полезная.','date','2025-07-21T12:00:00Z','source','telegram'),
    jsonb_build_object('user_id','tg-import-vvk-9','name','Виктор Ершов','photo',null,'comment','Кратко: мощно, полезно, бесплатно. Мышечное тестирование топ. Единственное, не хватило живых примеров с пациентами и обратной связи, но для бесплатного формата это щедро. Всем, кто думает, начинать или нет: однозначно начинайте.','date','2026-10-19T12:00:00Z','source','telegram')
  )
where slug = 'vvodnyy-seminar-po-kineziologii'
  and not (coalesce(rating, '[]'::jsonb) @> '[{"user_id":"tg-import-vvk-1"}]'::jsonb);
