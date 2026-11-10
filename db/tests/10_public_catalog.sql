-- =====================================================================
-- Tests del catálogo público (Sprint 3 · 1400), con los datos del seed de Fresas
-- =====================================================================
\ir lib/setup.sql

:as_anon
select public.get_public_catalog('fresas') as cat \gset

select tests.ok((select jsonb_array_length(:'cat'::jsonb -> 'categories') = 3),
                'catálogo: muestra las 3 categorías de Fresas');
select tests.ok((select jsonb_array_length(:'cat'::jsonb -> 'services') = 6),
                'catálogo: 6 servicios visibles (el que no se ofrece online no aparece)');
select tests.ok(not exists (select 1 from jsonb_array_elements(:'cat'::jsonb -> 'services') s
                            where s ->> 'name' = 'Diseño con henna'),
                'catálogo: un servicio "no visible en el sitio" no aparece');
select tests.ok((select jsonb_array_length(:'cat'::jsonb -> 'professionals') = 2),
                'catálogo: muestra a Sofi y a Caro');
select tests.ok((select (:'cat'::jsonb ->> 'currency') = 'ARS'), 'catálogo: incluye la moneda del estudio');

-- N2: Caro cobra el semipermanente más barato → "desde" el menor
select tests.ok((select (s ->> 'price_minor')::bigint = 1300000 and (s ->> 'price_is_from')::boolean
                 from jsonb_array_elements(:'cat'::jsonb -> 'services') s where s ->> 'name' = 'Esmaltado semipermanente'),
                'N2: si las profesionales cobran distinto, "desde" el menor ($13.000)');
-- Mismo precio para las dos → precio exacto
select tests.ok((select (s ->> 'price_minor')::bigint = 900000 and not (s ->> 'price_is_from')::boolean
                 from jsonb_array_elements(:'cat'::jsonb -> 'services') s where s ->> 'name' = 'Perfilado de cejas'),
                'precio igual para todas: se muestra exacto');
-- N3: servicio "precio desde"
select tests.ok((select (s ->> 'price_is_from')::boolean
                 from jsonb_array_elements(:'cat'::jsonb -> 'services') s where s ->> 'name' = 'Uñas esculpidas'),
                'N3: un servicio "precio desde" se marca como desde');
select tests.ok((select jsonb_array_length(s -> 'professional_ids') = 2
                 from jsonb_array_elements(:'cat'::jsonb -> 'services') s where s ->> 'name' = 'Esmaltado semipermanente'),
                'catálogo: cada servicio indica qué profesionales lo hacen');

-- Nada interno
select tests.ok(not (:'cat' ~ '(membership|user_id|tenant_id|buffer|deposit|archived|show_online|is_active|created|updated|position)'),
                'catálogo: no expone membresías, cuentas, tiempo extra, seña ni campos internos');

-- Archivar u ocultar saca del sitio; un estudio sin catálogo o suspendido no muestra nada
:as_owner_a
update public.services set archived_at = now() where id = '31000000-0000-4000-a000-000000000006';
update public.professionals set show_online = false where id = '32000000-0000-4000-a000-000000000002';
:as_anon
select tests.ok((select jsonb_array_length(public.get_public_catalog('fresas') -> 'services') = 5),
                'archivar un servicio lo saca del sitio');
select tests.ok((select jsonb_array_length(public.get_public_catalog('fresas') -> 'professionals') = 1),
                'ocultar a una profesional la saca del sitio');
select tests.ok((select (s ->> 'price_minor')::bigint = 1500000 and not (s ->> 'price_is_from')::boolean
                 from jsonb_array_elements(public.get_public_catalog('fresas') -> 'services') s
                 where s ->> 'name' = 'Esmaltado semipermanente'),
                'sin Caro visible, el semipermanente vuelve a su precio exacto');

:as_owner_a
update public.service_categories set is_active = false where id = '30000000-0000-4000-a000-000000000002';
:as_anon
select tests.ok(not exists (select 1 from jsonb_array_elements(public.get_public_catalog('fresas') -> 'services') s
                            where s ->> 'name' = 'Lifting de pestañas'),
                'una categoría desactivada oculta sus servicios');

select tests.ok((select public.get_public_catalog('estudio-prueba') = '{"currency": "ARS", "services": [], "categories": [], "professionals": []}'::jsonb),
                'Estudio Prueba: catálogo vacío (no ve nada de Fresas)');
select tests.ok(public.get_public_catalog('no-existe') is null, 'estudio inexistente: null');
:as_admin
select public.admin_set_tenant_status(:A, 'suspended');
:as_anon
select tests.ok(public.get_public_catalog('fresas') is null, 'estudio suspendido: no muestra catálogo');

\ir lib/finish.sql
