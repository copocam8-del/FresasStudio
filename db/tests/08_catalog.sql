-- =====================================================================
-- Tests del catálogo: categorías, servicios y profesionales (Sprint 3 · 1200)
-- =====================================================================
\ir lib/setup.sql
\ir lib/clean_catalog.sql

:as_super
select id as mem_pro_a   from public.memberships where user_id = :'uid_pro_a' \gset
select id as mem_owner_b from public.memberships where user_id = :'uid_owner_b' \gset

-- ---------------------------------------------------------------------
-- Alta por quien tiene services.manage
-- ---------------------------------------------------------------------
:as_manager_a
insert into public.service_categories (tenant_id, name, position) values (:A, '  Uñas ', 1) returning id as cat_unas \gset
select tests.ok((select name = 'Uñas' from public.service_categories where id = :'cat_unas'), 'categoría: se crea con el nombre normalizado');
select tests.throws(format($$insert into public.service_categories (tenant_id, name) values (%L, 'UÑAS')$$, :A),
                    'categoría: nombre repetido (sin importar mayúsculas)', 'duplicate');

insert into public.services (tenant_id, category_id, name, duration_minutes, buffer_after_minutes, price_minor, deposit_percent)
values (:A, :'cat_unas', 'Esmaltado semipermanente', 60, 10, 1250000, 30)
returning id as srv_semi \gset
insert into public.services (tenant_id, category_id, name, duration_minutes, price_minor, price_is_from)
values (:A, :'cat_unas', 'Esculpidas', 120, 2000000, true)
returning id as srv_esc \gset
select tests.ok((select price_minor = 1250000 and deposit_percent = 30 and buffer_after_minutes = 10 from public.services where id = :'srv_semi'),
                'servicio: precio en centavos, seña propia y tiempo extra');

-- Validaciones
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'X', 30, 100)$$, :A),
                    'servicio: nombre muy corto', 'services_name');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Corte', 7, 100)$$, :A),
                    'servicio: duración que no es múltiplo de 5', 'services_duration');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Corte', 605, 100)$$, :A),
                    'servicio: duración mayor a 10 horas', 'services_duration');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, buffer_after_minutes, price_minor) values (%L, 'Corte', 30, 3, 100)$$, :A),
                    'servicio: tiempo extra que no es múltiplo de 5', 'services_buffer');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Corte', 30, -1)$$, :A),
                    'servicio: precio negativo', 'services_price');
-- Por la API los valores llegan como texto: '10.5' no es un bigint válido.
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Corte', 30, '10.5')$$, :A),
                    'servicio: precio con decimales (tiene que ser entero en centavos)', 'bigint');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor, deposit_percent) values (%L, 'Corte', 30, 100, 101)$$, :A),
                    'servicio: seña mayor a 100%%', 'services_deposit');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor, photo_path) values (%L, 'Corte', 30, 100, '%s/services/a1b2c3d4-0000-4000-8000-000000000000.png')$$, :A, :B),
                    'servicio: foto de la carpeta de otro estudio', 'services_photo');

-- Profesionales: con cuenta (vinculada a la membresía) y sin cuenta
insert into public.professionals (tenant_id, membership_id, display_name) values (:A, :'mem_pro_a', 'Pro A')
returning id as pro_a \gset
insert into public.professionals (tenant_id, display_name, bio) values (:A, ' Caro ', '  ')
returning id as pro_caro \gset
select tests.ok((select display_name = 'Caro' and membership_id is null and bio is null from public.professionals where id = :'pro_caro'),
                'profesional sin cuenta: se crea (nombre normalizado, bio vacía = null)');
select tests.throws(format($$insert into public.professionals (tenant_id, membership_id, display_name) values (%L, %L, 'Otra vez')$$, :A, :'mem_pro_a'),
                    'profesional: una membresía no puede ser dos profesionales', 'duplicate');

insert into public.professional_services (tenant_id, professional_id, service_id) values (:A, :'pro_a', :'srv_semi');
insert into public.professional_services (tenant_id, professional_id, service_id, price_minor_override, duration_minutes_override)
values (:A, :'pro_caro', :'srv_semi', 1100000, 75);
select tests.ok((select count(*) = 2 from public.professional_services where service_id = :'srv_semi'),
                'asignación: dos profesionales hacen el servicio (una con precio y duración propios)');
select tests.throws(format($$insert into public.professional_services (tenant_id, professional_id, service_id, duration_minutes_override) values (%L, %L, %L, 33)$$, :A, :'pro_a', :'srv_esc'),
                    'asignación: duración propia que no es múltiplo de 5', 'professional_services_duration');

-- ---------------------------------------------------------------------
-- Integridad entre estudios (claves compuestas)
-- ---------------------------------------------------------------------
:as_owner_b
insert into public.services (tenant_id, name, duration_minutes, price_minor) values (:B, 'Servicio de B', 30, 500000)
returning id as srv_b \gset
insert into public.service_categories (tenant_id, name) values (:B, 'Cat B') returning id as cat_b \gset

:as_super
-- Incluso como superusuario (sin RLS), la base impide mezclar estudios.
select tests.throws(format($$insert into public.professional_services (tenant_id, professional_id, service_id) values (%L, %L, %L)$$, :A, :'pro_a', :'srv_b'),
                    'integridad: no se puede asignar un servicio de B a una profesional de A', 'professional_services_service_fk');
select tests.throws(format($$insert into public.professional_services (tenant_id, professional_id, service_id) values (%L, %L, %L)$$, :B, :'pro_a', :'srv_b'),
                    'integridad: ni declarando el estudio B', 'professional_services_professional_fk');
select tests.throws(format($$insert into public.services (tenant_id, category_id, name, duration_minutes, price_minor) values (%L, %L, 'Mezcla', 30, 100)$$, :A, :'cat_b'),
                    'integridad: un servicio de A no puede usar una categoría de B', 'services_category_fk');
select tests.throws(format($$insert into public.professionals (tenant_id, membership_id, display_name) values (%L, %L, 'Robada')$$, :A, :'mem_owner_b'),
                    'integridad: una profesional de A no puede vincularse a una membresía de B', 'professionals_membership_fk');
select tests.throws(format($$update public.services set tenant_id = %L where id = %L$$, :B, :'srv_semi'),
                    'integridad: un servicio no se puede mover de estudio', 'otro estudio');

-- ---------------------------------------------------------------------
-- Permisos por rol
-- ---------------------------------------------------------------------
:as_pro_a
select tests.ok((select count(*) = 2 from public.services), 'profesional A: ve los servicios de su estudio');
select tests.ok((select tests.affected(format($$update public.services set price_minor = 1 where id = %L$$, :'srv_semi'))) = 0,
                'profesional A (sin services.manage): no puede cambiar precios');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Nuevo', 30, 100)$$, :A),
                    'profesional A: no puede crear servicios', 'row-level security');

:as_owner_b
select tests.ok((select count(*) = 0 from public.services where tenant_id = :A), 'dueña B: no ve servicios de A');
select tests.ok((select count(*) = 0 from public.professionals where tenant_id = :A), 'dueña B: no ve profesionales de A');
select tests.ok((select tests.affected(format($$update public.services set price_minor = 1 where id = %L$$, :'srv_semi'))) = 0,
                'dueña B: no puede cambiar precios de A');
select tests.throws(format($$insert into public.services (tenant_id, name, duration_minutes, price_minor) values (%L, 'Intrusa', 30, 100)$$, :A),
                    'dueña B: no puede crear servicios en A', 'row-level security');

:as_admin
select tests.ok((select count(*) = 0 from public.services), 'Cleo Admin: no ve el catálogo por tablas');

:as_anon
select tests.throws('select * from public.services', 'anon: no puede leer servicios', 'permission denied');
select tests.throws('select * from public.professionals', 'anon: no puede leer profesionales', 'permission denied');

-- ---------------------------------------------------------------------
-- Archivar sí, borrar no; auditoría de precios
-- ---------------------------------------------------------------------
:as_owner_a
select tests.throws(format($$delete from public.services where id = %L$$, :'srv_esc'), 'servicio: no se puede borrar', 'permission denied');
select tests.throws(format($$delete from public.professionals where id = %L$$, :'pro_caro'), 'profesional: no se puede borrar', 'permission denied');
update public.services set archived_at = now(), is_active = false where id = :'srv_esc';
select tests.ok((select archived_at is not null from public.services where id = :'srv_esc'), 'servicio: se archiva');
select tests.ok((select tests.affected(format($$delete from public.professional_services where professional_id = %L and service_id = %L$$, :'pro_a', :'srv_semi'))) = 1,
                'asignación: se puede quitar un servicio a una profesional');

update public.services set price_minor = 1350000 where id = :'srv_semi';
:as_super
select tests.ok(exists (select 1 from public.audit_logs where entity_type = 'services' and entity_id = :'srv_semi' and action = 'update'
                        and (old_data ->> 'price_minor')::bigint = 1250000 and (new_data ->> 'price_minor')::bigint = 1350000),
                'auditoría: el cambio de precio queda con el valor anterior y el nuevo');

-- Estudio suspendido: solo lectura
:as_admin
select public.admin_set_tenant_status(:A, 'suspended');
:as_owner_a
select tests.ok((select tests.affected(format($$update public.services set price_minor = 1 where id = %L$$, :'srv_semi'))) = 0,
                'estudio suspendido: no se pueden cambiar precios');
select tests.ok((select count(*) > 0 from public.services), 'estudio suspendido: el catálogo se sigue viendo');
:as_admin
select public.admin_set_tenant_status(:A, 'active');

-- ---------------------------------------------------------------------
-- Storage: bucket "catalog"
-- ---------------------------------------------------------------------
:as_super
select tests.ok((select public and file_size_limit = 1048576 and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
                 from storage.buckets where id = 'catalog'),
                'bucket catalog: público, 1 MB, sin SVG');
:as_manager_a
insert into storage.objects (bucket_id, name) values ('catalog', :A || '/services/a0000000-0000-4000-8000-000000000001.webp');
select tests.ok(true, 'encargada A: sube una foto de servicio a su carpeta');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('catalog', '%s/services/a0000000-0000-4000-8000-000000000002.png')$$, :B),
                    'encargada A: no puede subir a la carpeta de B', 'row-level security');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('catalog', '%s/otra/a0000000-0000-4000-8000-000000000002.png')$$, :A),
                    'encargada A: solo en services/ o professionals/', 'row-level security');
:as_pro_a
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('catalog', '%s/professionals/a0000000-0000-4000-8000-000000000003.png')$$, :A),
                    'profesional A: no puede subir fotos', 'row-level security');

\ir lib/finish.sql
