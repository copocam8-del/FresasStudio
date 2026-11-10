-- =====================================================================
-- Tests del renombre a Cleo (Sprint 2 · migración 0700)
-- =====================================================================
\ir lib/setup.sql

-- ---------------------------------------------------------------------
-- Slugs reservados y liberados
-- ---------------------------------------------------------------------
:as_admin
select tests.throws($$select * from public.admin_create_studio('cleo', 'X', 'x@x.test')$$,
                    'slug "cleo" reservado', 'reservada');
select tests.throws($$select * from public.admin_create_studio('cleo-admin', 'X', 'x@x.test')$$,
                    'slug "cleo-admin" reservado', 'reservada');
select tests.throws($$select * from public.admin_create_studio('mail', 'X', 'x@x.test')$$,
                    'slug de infraestructura "mail" reservado', 'reservada');
select tests.throws($$select * from public.admin_create_studio('invitacion', 'X', 'x@x.test')$$,
                    'slug de producto "invitacion" reservado', 'reservada');
select tests.throws($$select * from public.admin_create_studio('xn--abc', 'X', 'x@x.test')$$,
                    'slug punycode "xn--abc" rechazado', 'xn--');
select tests.ok((select count(*) = 1 from public.admin_create_studio('xna-estudio', 'Estudio XNA', 'x@x.test')),
                'un slug que empieza con "xn" pero no con "xn--" se acepta');

:as_super
select tests.ok(not exists (select 1 from app.reserved_slugs where slug = 'fresas'),
                '"fresas" ya no está reservado');
select tests.ok((select status = 'active' from public.tenants where slug = 'fresas'),
                'Fresas Studio usa el slug "fresas"');
select tests.ok((select count(*) >= 40 from app.reserved_slugs),
                'la lista de reservados conserva los anteriores y suma los nuevos');

:as_anon
select tests.ok((select name = 'Fresas Studio' from public.get_public_studio('fresas')),
                'anon: ve la página pública en el slug "fresas"');

-- ---------------------------------------------------------------------
-- Mensajes con "Cleo Admin" y ninguno con "Fresas Admin"
-- ---------------------------------------------------------------------
:as_owner_a
select tests.throws($$select * from public.admin_create_studio('otro', 'Otro', 'x@x.test')$$,
                    'dueña: mensaje de crear estudio dice Cleo Admin', 'Solo Cleo Admin');
-- Cambiar la URL ya lo frena el permiso de columna (antes del trigger); el trigger
-- es una segunda defensa, así que se controla su texto directamente.
select tests.throws($$update public.tenants set slug = 'fresas-nuevo' where slug = 'fresas'$$,
                    'dueña: no puede cambiar la URL de su estudio', 'permission denied');

:as_super
select tests.ok((select prosrc like '%''Solo Cleo Admin puede cambiar la dirección%'
                 from pg_proc where oid = 'app.validate_tenant'::regproc),
                'el trigger de estudios responde "Solo Cleo Admin…"');
-- Solo los mensajes de error (los comentarios internos no los ve nadie).
select tests.ok(not exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname in ('public', 'app')
                    and p.prosrc ~* 'raise\s+exception\s+''[^'']*Fresas Admin'),
                'ningún mensaje de error de public o app menciona "Fresas Admin"');
-- Control del propio test: con el regex de arriba, la función vieja sí habría fallado.
select tests.ok('raise exception ''Solo Fresas Admin puede'' using' ~* 'raise\s+exception\s+''[^'']*Fresas Admin',
                'el chequeo de mensajes detecta un "Fresas Admin" real');
select tests.ok((select obj_description('app'::regnamespace, 'pg_namespace') ilike '%Cleo%'),
                'el comentario del esquema app dice Cleo');

\ir lib/finish.sql
