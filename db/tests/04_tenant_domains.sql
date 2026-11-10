-- =====================================================================
-- Tests de dominios propios (Sprint 2 · migración 0800)
-- =====================================================================
\ir lib/setup.sql

-- ---------------------------------------------------------------------
-- Alta: solo Cleo Admin, con validación de formato
-- ---------------------------------------------------------------------
:as_owner_a
select tests.throws(format($$select public.admin_add_tenant_domain(%L, 'turnos.fresas.test')$$, :A),
                    'dueña: no puede agregar dominios', 'Solo Cleo Admin');
select tests.throws($$insert into public.tenant_domains (tenant_id, domain) values ('10000000-0000-4000-a000-000000000001', 'x.test')$$,
                    'dueña: no puede insertar dominios directo', 'permission denied');

:as_admin
select public.admin_add_tenant_domain(:A, '  Turnos.FresasStudio.com. ') as dom_a \gset
select public.admin_add_tenant_domain(:B, 'estudioprueba.com.ar') as dom_b \gset
select tests.ok((select domain = 'turnos.fresasstudio.com' and status = 'pending'
                 from public.tenant_domains where id = :'dom_a'),
                'admin: el dominio se normaliza (minúsculas, sin espacios ni punto final) y nace pendiente');
select tests.throws(format($$select public.admin_add_tenant_domain(%L, 'otro.cleo.com.ar')$$, :A),
                    'admin: no acepta subdominios de la plataforma', 'tenant_domains_not_platform');
select tests.throws(format($$select public.admin_add_tenant_domain(%L, 'fresas.localhost')$$, :A),
                    'admin: no acepta localhost', 'tenant_domains_not_platform');
select tests.throws(format($$select public.admin_add_tenant_domain(%L, 'no es un dominio')$$, :A),
                    'admin: rechaza formatos inválidos', 'tenant_domains_format');
select tests.throws(format($$select public.admin_add_tenant_domain(%L, '127.0.0.1')$$, :A),
                    'admin: rechaza IPs', 'tenant_domains_format');
select tests.throws(format($$select public.admin_add_tenant_domain(%L, 'turnos.fresasstudio.com')$$, :B),
                    'admin: un dominio no puede ser de dos estudios', 'duplicate');

-- ---------------------------------------------------------------------
-- Resolución: solo dominios verificados de estudios operativos
-- ---------------------------------------------------------------------
:as_anon
select tests.ok((select public.resolve_custom_domain('turnos.fresasstudio.com')) is null,
                'anon: un dominio pendiente no resuelve');

:as_admin
select public.admin_set_domain_status(:'dom_a', 'verified');
select tests.ok((select verified_at is not null from public.tenant_domains where id = :'dom_a'),
                'admin: al verificar queda la fecha');

:as_anon
select tests.ok((select public.resolve_custom_domain('turnos.fresasstudio.com')) = 'fresas',
                'anon: un dominio verificado resuelve al slug del estudio');
select tests.ok((select public.resolve_custom_domain('TURNOS.fresasstudio.com.')) = 'fresas',
                'anon: resuelve sin importar mayúsculas ni punto final');
select tests.ok((select public.resolve_custom_domain('nada.test')) is null,
                'anon: un dominio desconocido no resuelve');
select tests.throws('select * from public.tenant_domains', 'anon: no puede leer la tabla', 'permission denied');

:as_admin
select public.admin_set_domain_status(:'dom_b', 'verified');
select public.admin_set_tenant_status(:B, 'suspended');
:as_anon
select tests.ok((select public.resolve_custom_domain('estudioprueba.com.ar')) is null,
                'anon: el dominio de un estudio suspendido no resuelve');

:as_admin
select public.admin_set_tenant_status(:B, 'active');
select public.admin_set_domain_status(:'dom_a', 'disabled');
select tests.ok((select verified_at is null from public.tenant_domains where id = :'dom_a'),
                'admin: al deshabilitar se borra la fecha de verificación');
:as_anon
select tests.ok((select public.resolve_custom_domain('turnos.fresasstudio.com')) is null,
                'anon: un dominio deshabilitado no resuelve');

-- ---------------------------------------------------------------------
-- Aislamiento: cada estudio ve solo los suyos y solo con settings.manage
-- ---------------------------------------------------------------------
:as_owner_a
select tests.ok((select count(*) = 1 from public.tenant_domains), 'dueña A: ve solo su dominio');
select tests.ok((select count(*) = 0 from public.tenant_domains where tenant_id = :B), 'dueña A: no ve los dominios de B');
select tests.throws(format($$update public.tenant_domains set status = 'verified' where id = %L$$, :'dom_a'),
                    'dueña A: no puede verificar su propio dominio', 'permission denied');
select tests.throws(format($$select public.admin_set_domain_status(%L, 'verified')$$, :'dom_a'),
                    'dueña A: no puede usar la función de Cleo Admin', 'Solo Cleo Admin');

:as_pro_a
select tests.ok((select count(*) = 0 from public.tenant_domains), 'profesional A (sin settings.manage): no ve dominios');

:as_owner_b
select tests.ok((select count(*) = 1 from public.tenant_domains where tenant_id = :B), 'dueña B: ve el suyo');
select tests.ok((select count(*) = 0 from public.tenant_domains where tenant_id = :A), 'dueña B: no ve los de A');

:as_super
select tests.ok((select count(*) = 2 from public.audit_logs where entity_type = 'tenant_domains' and action = 'insert'),
                'auditoría: las altas de dominios quedan registradas');

\ir lib/finish.sql
