-- =====================================================================
-- Tests de acceso del equipo e invitaciones (Sprint 2 · migración 0900)
-- =====================================================================
\ir lib/setup.sql

-- Usuarias extra para estos tests
:as_super
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-b000-000000000001', 'sinconfirmar@fresasstudio.test', null, '{}'),
  ('00000000-0000-4000-b000-000000000002', 'recepcion@fresasstudio.test', now(), '{}');
\set as_sinconfirmar 'reset role; do $x$ begin perform tests.login(''sinconfirmar@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_recepcion    'reset role; do $x$ begin perform tests.login(''recepcion@fresasstudio.test''); end $x$; set local role authenticated;'

-- ---------------------------------------------------------------------
-- Vista previa de invitaciones
-- ---------------------------------------------------------------------
:as_anon
select tests.ok((select status = 'invalid' and studio_slug is null from public.get_invitation_preview('abc')),
                'preview: un token con formato inválido da "invalid" sin datos');
select tests.ok((select status = 'invalid' from public.get_invitation_preview(null)),
                'preview: token nulo da "invalid"');
select tests.ok((select status = 'invalid' and studio_name is null
                 from public.get_invitation_preview(repeat('a', 64))),
                'preview: un token bien formado pero inexistente da "invalid" sin datos');

:as_owner_a
select public.create_invitation(:A, 'recepcion@fresasstudio.test', :'role_receptionist') as tok_rec \gset
select public.create_invitation(:A, 'sinconfirmar@fresasstudio.test', :'role_receptionist') as tok_sin \gset

:as_anon
select tests.ok((select status = 'valid' and studio_slug = 'fresas' and studio_name = 'Fresas Studio'
                        and role_name = 'Recepción' and expires_at > now()
                 from public.get_invitation_preview(:'tok_rec')),
                'preview (anon): invitación válida muestra estudio, rol y vencimiento');
select tests.ok((select email_masked = 'r***@fresasstudio.test' from public.get_invitation_preview(:'tok_rec')),
                'preview: el email se muestra enmascarado');
select tests.ok(not exists (
                  select 1 from information_schema.routines r
                  join information_schema.parameters p on p.specific_name = r.specific_name
                  where r.routine_schema = 'public' and r.routine_name = 'get_invitation_preview'
                    and p.parameter_mode = 'OUT'
                    and (p.parameter_name in ('id', 'tenant_id', 'role_id', 'email', 'token_hash')
                         or p.parameter_name like '%\_id')),
                'preview: no devuelve ids, email completo ni hash');

-- ---------------------------------------------------------------------
-- Aceptar exige email confirmado
-- ---------------------------------------------------------------------
:as_sinconfirmar
select tests.throws(format('select public.accept_invitation(%L)', :'tok_sin'),
                    'aceptar: sin email confirmado no se puede', 'Confirmá tu email');
:as_super
select tests.ok(not exists (select 1 from public.memberships
                            where user_id = '00000000-0000-4000-b000-000000000001'),
                'aceptar: la cuenta sin confirmar no quedó en el equipo');

:as_recepcion
select tests.ok((select public.accept_invitation(:'tok_rec')) = :A::uuid,
                'aceptar: con email confirmado entra al estudio');
:as_anon
select tests.ok((select status = 'used' from public.get_invitation_preview(:'tok_rec')),
                'preview: una invitación aceptada da "used"');

:as_owner_a
select public.create_invitation(:A, 'otra@fresasstudio.test', :'role_receptionist') as tok_rev \gset
select id as inv_rev from public.invitations where email = 'otra@fresasstudio.test' and revoked_at is null \gset
select public.revoke_invitation(:'inv_rev');
:as_anon
select tests.ok((select status = 'revoked' from public.get_invitation_preview(:'tok_rev')),
                'preview: una invitación anulada da "revoked"');

:as_owner_a
select public.create_invitation(:A, 'vencida@fresasstudio.test', :'role_receptionist') as tok_exp \gset
:as_super
update public.invitations set expires_at = now() - interval '1 minute' where email = 'vencida@fresasstudio.test';
:as_anon
select tests.ok((select status = 'expired' from public.get_invitation_preview(:'tok_exp')),
                'preview: una invitación vencida da "expired"');

:as_owner_b
select public.create_invitation(:B, 'alguien@estudioprueba.test', :'role_receptionist') as tok_b \gset
:as_admin
select public.admin_set_tenant_status(:B, 'suspended');
:as_anon
select tests.ok((select status = 'unavailable' and studio_slug = 'estudio-prueba'
                 from public.get_invitation_preview(:'tok_b')),
                'preview: la invitación de un estudio suspendido da "unavailable"');
:as_admin
select public.admin_set_tenant_status(:B, 'active');

-- ---------------------------------------------------------------------
-- Nombre desde los metadatos de Google
-- ---------------------------------------------------------------------
:as_super
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-b000-000000000010', 'google1@gmail.test', '{"full_name": "  Ana Pérez  "}'),
  ('00000000-0000-4000-b000-000000000011', 'google2@gmail.test', '{"name": "Bea"}'),
  ('00000000-0000-4000-b000-000000000012', 'google3@gmail.test', jsonb_build_object('full_name', repeat('x', 300))),
  ('00000000-0000-4000-b000-000000000013', 'google4@gmail.test', '{}');
select tests.ok((select full_name = 'Ana Pérez' from public.profiles where id = '00000000-0000-4000-b000-000000000010'),
                'perfil: toma full_name de Google (sin espacios sobrantes)');
select tests.ok((select full_name = 'Bea' from public.profiles where id = '00000000-0000-4000-b000-000000000011'),
                'perfil: si no hay full_name usa name');
select tests.ok((select char_length(full_name) = 120 from public.profiles where id = '00000000-0000-4000-b000-000000000012'),
                'perfil: el nombre se recorta a 120 caracteres');
select tests.ok((select full_name is null from public.profiles where id = '00000000-0000-4000-b000-000000000013'),
                'perfil: sin metadatos queda sin nombre');

-- ---------------------------------------------------------------------
-- Equipo del estudio
-- ---------------------------------------------------------------------
:as_owner_a
select tests.ok((select count(*) = 4 from public.team_members(:A)),
                'equipo: la dueña de A ve a las 4 personas de A (incluida la nueva recepcionista)');
select tests.ok((select bool_and(email like '%@fresasstudio.test') from public.team_members(:A)),
                'equipo: ve los emails del equipo');
select tests.ok((select count(*) = 1 from public.team_members(:A) where is_me and role_key = 'owner'),
                'equipo: se marca a sí misma');
select tests.throws(format('select * from public.team_members(%L)', :B),
                    'equipo: la dueña de A no ve el equipo de B', 'No tenés permiso');

:as_pro_a
select tests.throws(format('select * from public.team_members(%L)', :A),
                    'equipo: una profesional (sin team.read) no ve el equipo', 'No tenés permiso');

:as_anon
select tests.throws(format('select * from public.team_members(%L)', :A),
                    'equipo: anon no puede llamar a la función', 'permission denied');

\ir lib/finish.sql
