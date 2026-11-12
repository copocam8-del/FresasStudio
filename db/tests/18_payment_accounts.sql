-- =====================================================================
-- Tests de cuentas de Mercado Pago (Sprint 5 · migración 2300)
-- =====================================================================
\ir lib/setup.sql
\set H1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set H2 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set H3 '''3333333333333333333333333333333333333333333333333333333333333333'''
\set HB '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
\set ENC '''v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbb'''

-- En el seed Fresas ya tiene pagos conectados (para el pago simulado). Se empieza de cero.
:as_super
update public.tenant_settings set payments_connected = false where tenant_id = :A;

-- ---------------------------------------------------------------------
-- Empezar: solo payments.manage (la dueña), solo en su estudio
-- ---------------------------------------------------------------------
:as_owner_a
select public.begin_mp_connection(:A, :H1, 'v1.verif.icador');
select tests.ok(true, 'dueña: empieza la conexión de Mercado Pago');
:as_manager_a
select tests.throws(format('select public.begin_mp_connection(%L, %L, %L)', :A, :H2, 'v1.x.y'),
                    'encargada: no puede conectar Mercado Pago (P5)', 'Solo la dueña');
:as_owner_b
select tests.throws(format('select public.begin_mp_connection(%L, %L, %L)', :A, :H2, 'v1.x.y'),
                    'dueña de B: no puede empezar una conexión en A', 'Solo la dueña');
:as_anon
select tests.throws(format('select public.begin_mp_connection(%L, %L, %L)', :A, :H2, 'v1.x.y'),
                    'anon: no puede empezar una conexión', 'permission denied');

-- ---------------------------------------------------------------------
-- Reclamar el state: misma usuaria y estudio, un solo uso, 10 minutos
-- ---------------------------------------------------------------------
:as_owner_b
select tests.throws(format('select public.claim_mp_connection(%L, %L)', :A, :H1),
                    'state: la dueña de B no puede usar un state de A', 'Solo la dueña');
:as_owner_a
select tests.throws(format('select public.claim_mp_connection(%L, %L)', :A, :H2),
                    'state: uno inexistente no sirve', 'venció o ya se usó');
select tests.ok(public.claim_mp_connection(:A, :H1) = 'v1.verif.icador', 'state: devuelve el verificador PKCE cifrado');
select tests.throws(format('select public.claim_mp_connection(%L, %L)', :A, :H1),
                    'state: es de un solo uso', 'venció o ya se usó');

-- Vencido
select public.begin_mp_connection(:A, :H3, 'v1.x.y');
:as_super
update public.payment_oauth_states set expires_at = now() - interval '1 second' where state_hash = :H3;
:as_owner_a
select tests.throws(format('select public.claim_mp_connection(%L, %L)', :A, :H3),
                    'state: uno vencido no sirve', 'venció o ya se usó');

-- ---------------------------------------------------------------------
-- Guardar la conexión
-- ---------------------------------------------------------------------
select tests.throws(format($$select public.save_mp_connection(%L, %L, 555, 'FRESAS', 'MLA', false, %L, %L, 1::smallint, now() + interval '180 days')$$,
                           :A, :H3, :ENC, :ENC),
                    'guardar: sin un state reclamado no se guarda nada', 'venció o ya se usó');

-- Cuenta de otro país
select public.begin_mp_connection(:A, :H2, 'v1.x.y');
select public.claim_mp_connection(:A, :H2);
select tests.throws(format($$select public.save_mp_connection(%L, %L, 555, 'FRESAS', 'MLB', false, %L, %L, 1::smallint, now() + interval '180 days')$$,
                           :A, :H2, :ENC, :ENC),
                    'guardar: la cuenta tiene que ser de Argentina', 'Argentina');

-- La buena (el state de MLB quedó usado por el rollback del error: se reclama otro)
:as_super
delete from public.payment_oauth_states where tenant_id = :A;
:as_owner_a
select public.begin_mp_connection(:A, :H1, 'v1.x.y');
select public.claim_mp_connection(:A, :H1);
select public.save_mp_connection(:A, :H1, 555, 'FRESAS.STUDIO', 'MLA', false, :ENC, :ENC, 1::smallint, now() + interval '180 days');
select tests.ok((select status = 'connected' and mp_user_id = 555 and not live_mode
                 from public.payment_accounts where tenant_id = :A),
                'dueña: conecta la cuenta y la ve como conectada');
select tests.ok((select payments_connected from public.tenant_settings where tenant_id = :A),
                'conectar: el estudio queda con pagos conectados');
select tests.throws(format($$select public.save_mp_connection(%L, %L, 555, 'X', 'MLA', false, %L, %L, 1::smallint, now() + interval '180 days')$$,
                           :A, :H1, :ENC, :ENC),
                    'guardar: el mismo state no se puede usar dos veces', 'venció o ya se usó');
select tests.ok((select status = 'connected' and mp_nickname = 'FRESAS.STUDIO' and pending_online >= 0
                 from public.get_payments_status(:A)),
                'dueña: ve el estado de la conexión (sin secretos)');

-- Nadie lee secretos ni conexiones en curso
select tests.throws('select * from public.payment_account_credentials', 'dueña: no puede leer los tokens cifrados', 'permission denied');
select tests.throws('select * from public.payment_oauth_states', 'dueña: no puede leer las conexiones en curso', 'permission denied');
select tests.throws(format($$update public.payment_accounts set mp_user_id = 1 where tenant_id = %L$$, :A),
                    'dueña: no puede modificar la cuenta directo', 'permission denied');
select tests.throws(format($$insert into public.payment_accounts (tenant_id, mp_user_id, site_id, live_mode, token_expires_at) values (%L, 1, 'MLA', false, now())$$, :A),
                    'dueña: no puede insertar cuentas directo', 'permission denied');
select tests.throws(format('select * from public.svc_mp_credentials((select id from public.payment_accounts where tenant_id = %L))', :A),
                    'dueña: no puede ejecutar las funciones del servidor', 'permission denied');

:as_manager_a
select tests.ok((select count(*) = 1 from public.payment_accounts), 'encargada (settings.manage): ve el estado de la cuenta');
:as_pro_a
select tests.ok((select count(*) = 0 from public.payment_accounts), 'profesional: no ve la cuenta de Mercado Pago');
select tests.throws(format('select * from public.get_payments_status(%L)', :A), 'profesional: no ve el estado de pagos', 'No tenés permiso');
:as_owner_b
select tests.ok((select count(*) = 0 from public.payment_accounts), 'dueña de B: no ve la cuenta de A');
select tests.throws(format('select public.disconnect_mp(%L)', :A), 'dueña de B: no puede desconectar a A', 'Solo la dueña');
:as_admin
select tests.ok((select count(*) = 0 from public.payment_accounts), 'Cleo Admin: no ve cuentas de Mercado Pago');

-- La misma cuenta de Mercado Pago no se conecta en dos estudios
:as_owner_b
select public.begin_mp_connection(:B, :HB, 'v1.x.y');
select public.claim_mp_connection(:B, :HB);
select tests.throws(format($$select public.save_mp_connection(%L, %L, 555, 'FRESAS', 'MLA', false, %L, %L, 1::smallint, now() + interval '180 days')$$,
                           :B, :HB, :ENC, :ENC),
                    'una cuenta de Mercado Pago no se conecta a dos estudios', 'otro estudio');

-- ---------------------------------------------------------------------
-- Servidor: credenciales, bloqueo de renovación, revocación
-- ---------------------------------------------------------------------
:as_super
select id as acc from public.payment_accounts where tenant_id = :A and status = 'connected' \gset
:as_service
select tests.ok((select access_token_enc = :ENC and key_version = 1 from public.svc_mp_credentials(:'acc')),
                'servidor: lee los tokens cifrados');
select tests.ok((select account_id = :'acc' from public.svc_mp_account_by_user(555, false)),
                'servidor: encuentra la cuenta por el usuario de Mercado Pago (avisos)');
select tests.ok((select count(*) = 0 from public.svc_mp_account_by_user(555, true)),
                'servidor: una cuenta de prueba no se confunde con una real');
select tests.ok(public.svc_mp_begin_refresh(:'acc'), 'renovación: toma el bloqueo');
select tests.ok(not public.svc_mp_begin_refresh(:'acc'), 'renovación: una segunda a la vez no puede (no rompe el refresh_token)');
select public.svc_mp_store_refresh(:'acc', 'v2.cccccccccccccccc.dddddddddddddddddddd', 'v2.cccccccccccccccc.dddddddddddddddddddd', 2::smallint, now() + interval '180 days');
select tests.ok((select key_version = 2 from public.svc_mp_credentials(:'acc')), 'renovación: guarda los tokens nuevos y libera el bloqueo');
select tests.ok(public.svc_mp_begin_refresh(:'acc'), 'renovación: después se puede volver a renovar');
select public.svc_mp_refresh_failed(:'acc', false, 'network');
:as_super
select tests.ok((select status = 'connected' and last_error = 'network' from public.payment_accounts where id = :'acc'),
                'renovación con error temporal: sigue conectada y lo anota');
:as_service
select tests.ok((select count(*) = 1 from public.svc_mp_accounts_to_refresh(now() + interval '200 days')), 'renovación diaria: lista las que vencen pronto');

-- Revocada desde Mercado Pago (P7): hay que volver a conectar y se apagan las reservas online
:as_super
update public.tenant_settings set online_booking_enabled = true where tenant_id = :A;
:as_service
select public.svc_mp_refresh_failed(:'acc', true, 'invalid_grant');
:as_super
select tests.ok((select a.status = 'needs_reconnect' and not s.payments_connected and not s.online_booking_enabled
                 from public.payment_accounts a join public.tenant_settings s on s.tenant_id = a.tenant_id where a.id = :'acc'),
                'acceso revocado: "hay que volver a conectar", sin pagos y sin reservas online (P7)');
:as_service
select tests.ok((select count(*) = 0 from public.svc_mp_credentials(:'acc')), 'acceso revocado: sus tokens ya no se usan');

-- Reconectar la misma cuenta
:as_owner_a
select public.begin_mp_connection(:A, :H2, 'v1.x.y');
select public.claim_mp_connection(:A, :H2);
select public.save_mp_connection(:A, :H2, 555, 'FRESAS.STUDIO', 'MLA', false, :ENC, :ENC, 1::smallint, now() + interval '180 days');
select tests.ok((select count(*) = 1 and bool_and(status = 'connected' and id = :'acc') from public.payment_accounts where tenant_id = :A),
                'reconectar la misma cuenta: vuelve a "conectada" con tokens nuevos');

-- ---------------------------------------------------------------------
-- Desconectar (P6)
-- ---------------------------------------------------------------------
:as_super
update public.tenant_settings set online_booking_enabled = true where tenant_id = :A;
:as_manager_a
select tests.throws(format('select public.disconnect_mp(%L)', :A), 'encargada: no puede desconectar', 'Solo la dueña');
:as_owner_a
select public.disconnect_mp(:A);
:as_super
select tests.ok((select status = 'disconnected' and disconnected_at is not null from public.payment_accounts where id = :'acc'),
                'desconectar: la cuenta queda como historia');
select tests.ok((select count(*) = 0 from public.payment_account_credentials where account_id = :'acc'),
                'desconectar: los tokens se borran');
select tests.ok((select not payments_connected and not online_booking_enabled from public.tenant_settings where tenant_id = :A),
                'desconectar: sin pagos y con las reservas online apagadas (P6)');
:as_owner_a
select tests.throws(format('select public.disconnect_mp(%L)', :A), 'desconectar dos veces: avisa que no hay cuenta', 'No hay una cuenta');

-- Ahora la cuenta 555 queda libre para otro estudio
:as_owner_b
select public.save_mp_connection(:B, :HB, 555, 'OTRA', 'MLA', false, :ENC, :ENC, 1::smallint, now() + interval '180 days');
select tests.ok((select count(*) = 1 from public.payment_accounts where tenant_id = :B and status = 'connected'),
                'una cuenta desconectada de A se puede conectar en B');

-- Auditoría sin secretos
:as_super
select tests.ok((select count(*) >= 3 from public.audit_logs where tenant_id = :A and action like 'payments.%'),
                'auditoría: conectar, revocar y desconectar quedan registrados');
select tests.ok((select count(*) = 0 from public.audit_logs
                 where (coalesce(old_data, '{}') || coalesce(new_data, '{}'))::text ~ 'v[0-9]+\.[A-Za-z0-9_-]{8,}\.'),
                'auditoría: nunca guarda tokens');

-- Meta: ninguna función svc_* se puede ejecutar desde la API
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'svc\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'meta: las funciones svc_* no las ejecuta anon ni authenticated');
select tests.ok(not exists (
  select 1 from public.payment_account_credentials c
  where c.access_token_enc !~ '^v[0-9]+\.' or c.refresh_token_enc !~ '^v[0-9]+\.'),
  'meta: no hay tokens sin cifrar');

\ir lib/finish.sql
