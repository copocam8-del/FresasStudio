-- =====================================================================
-- Tests del seed de desarrollo (Sprint 2 · paso 2)
-- Las usuarias de prueba tienen que poder iniciar sesión en cleo-dev.
-- =====================================================================
\ir lib/setup.sql

:as_super
select tests.ok((select count(*) = 7 from auth.users where email like '%.test'),
                'seed: crea las 7 usuarias de prueba');
select tests.ok(not exists (select 1 from auth.users where email like '%.test'
                            and encrypted_password is distinct from extensions.crypt('CleoDev-2026', encrypted_password)),
                'seed: todas tienen la contraseña de desarrollo (hash bcrypt válido)');
select tests.ok(not exists (select 1 from auth.users where email like '%.test' and email_confirmed_at is null),
                'seed: todas tienen el email confirmado');
select tests.ok(not exists (select 1 from auth.users u where u.email like '%.test'
                            and not exists (select 1 from auth.identities i
                                            where i.user_id = u.id and i.provider = 'email'
                                              and i.provider_id = u.id::text)),
                'seed: todas tienen su identidad "email"');
select tests.ok(not exists (select 1 from auth.users where email like '%.test'
                            and (confirmation_token is null or recovery_token is null
                                 or email_change_token_new is null or email_change is null)),
                'seed: los tokens de auth quedan en '''' (Supabase Auth falla con NULL)');
select tests.ok((select count(*) = 7 from public.profiles p join auth.users u on u.id = p.id where u.email like '%.test'),
                'seed: cada usuaria tiene su perfil (trigger handle_new_user)');

\ir lib/finish.sql
