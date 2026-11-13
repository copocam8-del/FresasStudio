-- =====================================================================
-- Cleo · Migración 2750 · Fichas de clientas, agenda e indicadores
-- Épica 08 (CAL-01 a CAL-04) · Épica 09 (CRM-01 a CRM-04) · Épica 10 (ATT-02 a ATT-05)
-- docs/sprint-6-plan.md C16–C21
--
--   * La profesional ve solo SUS clientas (clients.read_own, C19): se le saca
--     clients.read al rol Profesional en todos los estudios.
--   * client_notes: notas internas, solo para el equipo; no se editan ni se borran
--     (se ocultan). client_preferences: alergias y preferencias, editables con
--     clients.manage; la auditoría guarda qué campo cambió, nunca el valor.
--   * Agenda: turnos y horarios de un rango en una consulta.
--   * Indicadores: atendidas, faltas, cancelaciones tardías; frecuentes (3+ en 90
--     días) y faltas repetidas (2+ en 180 días). Todo sale de los turnos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permiso nuevo: ver solo las clientas propias (C19)
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('clients.read_own', 'clients', 'Ver las fichas de las clientas que atendió o va a atender')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'clients.read_own' from public.roles r
-- También dueña, encargada y recepción (ya ven todas con clients.read): así nadie del
-- equipo tiene un permiso que su encargada no tiene (reglas anti-escalada).
where r.tenant_id is null and r.key in ('owner', 'manager', 'receptionist', 'professional')
on conflict do nothing;
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id and r.tenant_id is null and r.key = 'professional' and rp.permission_code = 'clients.read';

-- ¿Puede la usuaria actual ver esta clienta?
create or replace function app.can_read_client(p_tenant uuid, p_client uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_tenant, 'clients.read')
      or (app.has_permission(p_tenant, 'clients.read_own') and exists (
            select 1 from public.appointments a
            where a.tenant_id = p_tenant and a.client_profile_id = p_client
              and a.professional_id = app.my_professional_id(p_tenant)))
$$;
revoke execute on function app.can_read_client(uuid, uuid) from public, anon;
grant execute on function app.can_read_client(uuid, uuid) to authenticated;

drop policy client_profiles_select on public.client_profiles;
create policy client_profiles_select on public.client_profiles for select to authenticated
  using (user_id = auth.uid() or app.can_read_client(tenant_id, id));

-- Búsqueda sin mayúsculas ni acentos ("nunez" encuentra "Núñez")
create or replace function app.search_norm(p_text text)
returns text
language sql immutable set search_path = '' as $$
  select translate(lower(p_text collate "und-x-icu"), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')
$$;

-- ---------------------------------------------------------------------
-- Notas internas (C20)
-- ---------------------------------------------------------------------
create table public.client_notes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  client_profile_id  uuid not null,
  body               text not null,
  author_user_id     uuid,
  created_at         timestamptz not null default now(),
  hidden_at          timestamptz,
  hidden_by          uuid,
  constraint client_notes_client_fk foreign key (tenant_id, client_profile_id)
    references public.client_profiles (tenant_id, id) on delete restrict,
  constraint client_notes_body check (char_length(btrim(body)) between 1 and 1000),
  constraint client_notes_hidden check ((hidden_at is null) = (hidden_by is null))
);
create index client_notes_client on public.client_notes (tenant_id, client_profile_id, created_at desc);
comment on table public.client_notes is
  'Notas internas del equipo sobre una clienta. La clienta nunca las ve. No se editan ni se borran: se ocultan.';

-- El texto, la autora y la fecha no cambian; ocultar es una sola vez; no se borra.
create or replace function app.guard_client_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las notas no se borran: se ocultan' using errcode = '42501';
  end if;
  if (new.tenant_id, new.client_profile_id, new.body, new.author_user_id, new.created_at)
     is distinct from (old.tenant_id, old.client_profile_id, old.body, old.author_user_id, old.created_at)
     or (old.hidden_at is not null and (new.hidden_at, new.hidden_by) is distinct from (old.hidden_at, old.hidden_by)) then
    raise exception 'Una nota no se puede editar' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger client_notes_guard before update or delete on public.client_notes
  for each row execute function app.guard_client_note();
create trigger client_notes_no_truncate before truncate on public.client_notes
  for each statement execute function app.prevent_mutation();

-- Auditoría sin el texto de la nota
create or replace function app.audit_client_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (new.tenant_id, auth.uid(), case when tg_op = 'INSERT' then 'insert' else 'hide' end, 'client_notes',
          new.id::text, null, jsonb_build_object('client_profile_id', new.client_profile_id));
  return null;
end $$;
create trigger audit_client_notes after insert or update on public.client_notes
  for each row execute function app.audit_client_note();

revoke all on public.client_notes from anon, authenticated;
grant select on public.client_notes to authenticated;
grant all on public.client_notes to service_role;
alter table public.client_notes enable row level security;
alter table public.client_notes force row level security;
-- Solo el equipo que puede ver la ficha. La clienta NUNCA (no hay "or es mía").
create policy client_notes_select on public.client_notes for select to authenticated
  using (app.can_read_client(tenant_id, client_profile_id));

-- ---------------------------------------------------------------------
-- Preferencias y alergias (C21)
-- ---------------------------------------------------------------------
create table public.client_preferences (
  tenant_id                  uuid not null references public.tenants (id) on delete restrict,
  client_profile_id          uuid not null,
  allergies                  text,
  preferences                text,
  preferred_professional_id  uuid,
  updated_by                 uuid,
  updated_at                 timestamptz not null default now(),
  primary key (tenant_id, client_profile_id),
  constraint client_preferences_client_fk foreign key (tenant_id, client_profile_id)
    references public.client_profiles (tenant_id, id) on delete restrict,
  constraint client_preferences_professional_fk foreign key (tenant_id, preferred_professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint client_preferences_allergies check (allergies is null or char_length(allergies) between 1 and 500),
  constraint client_preferences_preferences check (preferences is null or char_length(preferences) between 1 and 1000)
);
comment on table public.client_preferences is
  'Alergias (dato de salud) y preferencias de una clienta. Solo el equipo; la auditoría no guarda valores.';

create or replace function app.audit_client_preferences() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fields text[];
begin
  select coalesce(array_agg(n.key order by n.key), '{}') into v_fields
  from jsonb_each(to_jsonb(new)) n
  where n.key not in ('updated_at', 'updated_by')
    and (tg_op = 'INSERT' or n.value is distinct from (to_jsonb(old) -> n.key));
  insert into public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (new.tenant_id, auth.uid(), lower(tg_op), 'client_preferences', new.client_profile_id::text, null,
          jsonb_build_object('changed_fields', to_jsonb(v_fields)));
  return null;
end $$;
create trigger audit_client_preferences after insert or update on public.client_preferences
  for each row execute function app.audit_client_preferences();
create trigger client_preferences_no_delete before delete on public.client_preferences
  for each row execute function app.prevent_mutation();

revoke all on public.client_preferences from anon, authenticated;
grant select on public.client_preferences to authenticated;
grant all on public.client_preferences to service_role;
alter table public.client_preferences enable row level security;
alter table public.client_preferences force row level security;
create policy client_preferences_select on public.client_preferences for select to authenticated
  using (app.can_read_client(tenant_id, client_profile_id));

-- ---------------------------------------------------------------------
-- Escritura de notas y preferencias
-- ---------------------------------------------------------------------
create or replace function public.add_client_note(p_client uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.can_read_client(v_tenant, p_client) or not app.tenant_is_writable(v_tenant) then
    raise exception 'No tenés permiso para escribir notas de esta clienta' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then
    raise exception 'La nota tiene que tener entre 1 y 1000 caracteres' using errcode = '22023';
  end if;
  insert into public.client_notes (tenant_id, client_profile_id, body, author_user_id)
  values (v_tenant, p_client, btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_client_note(uuid, text) from public, anon;
grant execute on function public.add_client_note(uuid, text) to authenticated;

create or replace function public.hide_client_note(p_note uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note public.client_notes%rowtype;
begin
  select * into v_note from public.client_notes where id = p_note for update;
  if v_note.id is null or not app.can_read_client(v_note.tenant_id, v_note.client_profile_id)
     or not app.tenant_is_writable(v_note.tenant_id)
     or not (v_note.author_user_id = auth.uid() or app.can(v_note.tenant_id, 'clients.manage')) then
    raise exception 'Solo la autora o quien administra fichas puede ocultar esta nota' using errcode = '42501';
  end if;
  if v_note.hidden_at is not null then
    return;
  end if;
  update public.client_notes set hidden_at = now(), hidden_by = auth.uid() where id = p_note;
end $$;
revoke execute on function public.hide_client_note(uuid) from public, anon;
grant execute on function public.hide_client_note(uuid) to authenticated;

create or replace function public.client_notes_list(p_client uuid, p_include_hidden boolean default false)
returns table (id uuid, body text, author_name text, is_mine boolean, created_at timestamptz, hidden_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.can_read_client(v_tenant, p_client) then
    raise exception 'No encontramos esa clienta' using errcode = 'P0002';
  end if;
  return query
    select n.id, n.body, coalesce(nullif(btrim(pr.full_name), ''), 'Alguien del equipo'),
           n.author_user_id = auth.uid(), n.created_at, n.hidden_at
    from public.client_notes n
    left join public.profiles pr on pr.id = n.author_user_id
    where n.client_profile_id = p_client and (p_include_hidden or n.hidden_at is null)
    order by n.created_at desc
    limit 200;
end $$;
revoke execute on function public.client_notes_list(uuid, boolean) from public, anon;
grant execute on function public.client_notes_list(uuid, boolean) to authenticated;

create or replace function public.set_client_preferences(
  p_client uuid, p_allergies text, p_preferences text, p_preferred_professional uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_all text := nullif(btrim(p_allergies), '');
  v_pref text := nullif(btrim(p_preferences), '');
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.can(v_tenant, 'clients.manage') then
    raise exception 'No tenés permiso para editar esta ficha' using errcode = '42501';
  end if;
  if v_all is not null and char_length(v_all) > 500 then
    raise exception 'Las alergias pueden tener hasta 500 caracteres' using errcode = '22023';
  end if;
  if v_pref is not null and char_length(v_pref) > 1000 then
    raise exception 'Las preferencias pueden tener hasta 1000 caracteres' using errcode = '22023';
  end if;
  if p_preferred_professional is not null and not exists (
       select 1 from public.professionals where id = p_preferred_professional and tenant_id = v_tenant and archived_at is null) then
    raise exception 'Esa profesional no es de este estudio' using errcode = '22023';
  end if;
  insert into public.client_preferences (tenant_id, client_profile_id, allergies, preferences, preferred_professional_id, updated_by)
  values (v_tenant, p_client, v_all, v_pref, p_preferred_professional, auth.uid())
  on conflict (tenant_id, client_profile_id) do update
    set allergies = excluded.allergies, preferences = excluded.preferences,
        preferred_professional_id = excluded.preferred_professional_id,
        updated_by = excluded.updated_by, updated_at = now()
    where (client_preferences.allergies, client_preferences.preferences, client_preferences.preferred_professional_id)
          is distinct from (excluded.allergies, excluded.preferences, excluded.preferred_professional_id);
end $$;
revoke execute on function public.set_client_preferences(uuid, text, text, uuid) from public, anon;
grant execute on function public.set_client_preferences(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Asistencia de una clienta (o del estudio) en un período. Solo turnos que ya pasaron.
--   atendidas · faltas · canceló tarde · canceló a tiempo · canceló el estudio · reprogramó
-- ---------------------------------------------------------------------
create or replace function app.attendance_counts(
  p_tenant uuid, p_client uuid, p_professional uuid, p_from timestamptz, p_to timestamptz
) returns table (attended bigint, no_shows bigint, late_cancels bigint, timely_cancels bigint,
                 studio_cancels bigint, reschedules bigint)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where a.status = 'completed'),
         count(*) filter (where a.status = 'no_show'),
         count(*) filter (where a.status = 'cancelled' and a.cancelled_by = 'client' and a.deposit_outcome = 'forfeited'),
         count(*) filter (where a.status = 'cancelled' and a.cancelled_by = 'client' and a.deposit_outcome <> 'forfeited'),
         count(*) filter (where a.status = 'cancelled' and a.cancelled_by = 'studio'),
         count(*) filter (where a.status = 'rescheduled')
  from public.appointments a
  where a.tenant_id = p_tenant
    and (p_client is null or a.client_profile_id = p_client)
    and (p_professional is null or a.professional_id = p_professional)
    and a.starts_at >= p_from and a.starts_at < least(p_to, now())
$$;
revoke execute on function app.attendance_counts(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Etiquetas de una clienta (C17): frecuente (3+ atendidas en 90 días) y faltas en 180 días
create or replace function app.client_tags(p_tenant uuid, p_client uuid)
returns table (attended_90 bigint, no_shows_180 bigint, is_frequent boolean, repeat_no_shows boolean)
language sql stable security definer set search_path = '' as $$
  select f.attended, n.no_shows, f.attended >= 3, n.no_shows >= 2
  from app.attendance_counts(p_tenant, p_client, null, now() - interval '90 days', now()) f,
       app.attendance_counts(p_tenant, p_client, null, now() - interval '180 days', now()) n
$$;
revoke execute on function app.client_tags(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Directorio y ficha (CRM-01, CRM-02, CRM-04)
-- ---------------------------------------------------------------------
create or replace function public.list_clients(
  p_tenant uuid, p_search text default null, p_filter text default 'all', p_limit integer default 50, p_offset integer default 0
) returns table (
  id uuid, full_name text, phone text, email text, has_account boolean,
  last_visit timestamptz, next_visit timestamptz, attended_90 bigint, no_shows_180 bigint,
  is_frequent boolean, repeat_no_shows boolean, credit_minor bigint, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_all  boolean := app.has_permission(p_tenant, 'clients.read');
  v_own  boolean := app.has_permission(p_tenant, 'clients.read_own');
  v_pro  uuid := app.my_professional_id(p_tenant);
  v_q    text := nullif(app.search_norm(btrim(p_search)), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
begin
  if not v_all and not v_own then
    raise exception 'No tenés permiso para ver clientas' using errcode = '42501';
  end if;
  if p_filter is null or p_filter not in ('all', 'frequent', 'no_shows', 'credit') then
    raise exception 'Filtro inválido' using errcode = '22023';
  end if;
  if p_search is not null and char_length(p_search) > 100 then
    raise exception 'La búsqueda es demasiado larga' using errcode = '22023';
  end if;
  return query
    with base as (
      select c.id, c.full_name, c.phone, c.email, c.user_id is not null as has_account,
             (select max(a.starts_at) from public.appointments a
              where a.client_profile_id = c.id and a.status = 'completed') as last_visit,
             (select min(a.starts_at) from public.appointments a
              where a.client_profile_id = c.id and a.status in ('confirmed', 'pending_payment') and a.starts_at > now()
                and (a.status = 'confirmed' or a.hold_expires_at > now())) as next_visit,
             t.attended_90, t.no_shows_180, t.is_frequent, t.repeat_no_shows,
             case when v_all then app.credit_available(p_tenant, c.id) end as credit_minor
      from public.client_profiles c
      cross join lateral app.client_tags(p_tenant, c.id) t
      where c.tenant_id = p_tenant and c.status = 'active'
        and (v_all or exists (select 1 from public.appointments a
                              where a.tenant_id = p_tenant and a.client_profile_id = c.id and a.professional_id = v_pro))
        and (v_q is null
             or app.search_norm(c.full_name) like '%' || v_q || '%'
             or (c.email is not null and c.email like '%' || lower(btrim(p_search)) || '%')
             or (v_digits is not null and char_length(v_digits) >= 3
                 and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
    ), filtered as (
      select * from base b
      where p_filter = 'all'
         or (p_filter = 'frequent' and b.is_frequent)
         or (p_filter = 'no_shows' and b.no_shows_180 > 0)
         or (p_filter = 'credit' and coalesce(b.credit_minor, 0) > 0)
    )
    select f.id, f.full_name, f.phone, f.email, f.has_account, f.last_visit, f.next_visit, f.attended_90,
           f.no_shows_180, f.is_frequent, f.repeat_no_shows, f.credit_minor, count(*) over ()
    from filtered f
    order by f.next_visit nulls last, f.last_visit desc nulls last, app.search_norm(f.full_name)
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke execute on function public.list_clients(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_clients(uuid, text, text, integer, integer) to authenticated;

create or replace function public.create_client(p_tenant uuid, p_full_name text, p_phone text, p_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := nullif(lower(btrim(p_email)), '');
  v_phone text := nullif(btrim(p_phone), '');
begin
  if not app.can(p_tenant, 'clients.manage') then
    raise exception 'No tenés permiso para cargar clientas' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 120 then
    raise exception 'Ingresá el nombre (de 2 a 120 caracteres)' using errcode = '22023';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Ingresá un teléfono o un email para poder contactarla' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,30}$' then
    raise exception 'El teléfono no es válido' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'El email no es válido' using errcode = '22023';
  end if;
  if v_email is not null and exists (select 1 from public.client_profiles where tenant_id = p_tenant and email = v_email) then
    raise exception 'Ya hay una clienta con ese email' using errcode = '23505';
  end if;
  insert into public.client_profiles (tenant_id, full_name, phone, email, source, created_by)
  values (p_tenant, btrim(p_full_name), v_phone, v_email, 'staff', auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_client(uuid, text, text, text) from public, anon;
grant execute on function public.create_client(uuid, text, text, text) to authenticated;

-- Ficha: datos, etiquetas, indicadores de siempre, preferencias y saldo (si corresponde)
create or replace function public.client_file(p_client uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c      public.client_profiles%rowtype;
  v_all    boolean;
  v_pro    uuid;
  v_tags   record;
  v_counts record;
  v_pref   public.client_preferences%rowtype;
begin
  select * into v_c from public.client_profiles where id = p_client;
  if v_c.id is null or not app.can_read_client(v_c.tenant_id, v_c.id) then
    raise exception 'No encontramos esa clienta' using errcode = 'P0002';
  end if;
  v_all := app.has_permission(v_c.tenant_id, 'clients.read');
  v_pro := case when v_all then null else app.my_professional_id(v_c.tenant_id) end;
  select * into v_tags from app.client_tags(v_c.tenant_id, v_c.id);
  select * into v_counts from app.attendance_counts(v_c.tenant_id, v_c.id, v_pro, '-infinity', now());
  select * into v_pref from public.client_preferences where client_profile_id = v_c.id and tenant_id = v_c.tenant_id;

  return jsonb_build_object(
    'id', v_c.id, 'full_name', v_c.full_name, 'phone', v_c.phone, 'email', v_c.email,
    'has_account', v_c.user_id is not null, 'source', v_c.source, 'created_at', v_c.created_at,
    'is_frequent', v_tags.is_frequent, 'repeat_no_shows', v_tags.repeat_no_shows,
    'attended_90', v_tags.attended_90, 'no_shows_180', v_tags.no_shows_180,
    'attended', v_counts.attended, 'no_shows', v_counts.no_shows, 'late_cancels', v_counts.late_cancels,
    'timely_cancels', v_counts.timely_cancels, 'studio_cancels', v_counts.studio_cancels,
    'reschedules', v_counts.reschedules,
    'last_visit', (select max(a.starts_at) from public.appointments a where a.client_profile_id = v_c.id
                   and a.status = 'completed' and (v_pro is null or a.professional_id = v_pro)),
    'allergies', v_pref.allergies, 'preferences', v_pref.preferences,
    'preferred_professional', (select p.display_name from public.professionals p where p.id = v_pref.preferred_professional_id),
    'preferred_professional_id', v_pref.preferred_professional_id,
    'credit_minor', case when v_all then app.credit_available(v_c.tenant_id, v_c.id) end,
    'only_own', not v_all
  );
end $$;
revoke execute on function public.client_file(uuid) from public, anon;
grant execute on function public.client_file(uuid) to authenticated;

-- Historial de turnos de la clienta (la profesional con clients.read_own: solo los suyos)
create or replace function public.client_appointments(p_client uuid)
returns table (
  id uuid, code text, starts_at timestamptz, service_name text, professional_name text,
  status public.appointment_status, deposit_status public.deposit_status, price_minor bigint, deposit_minor bigint,
  credit_applied_minor bigint, currency text, deposit_outcome public.deposit_outcome, deposit_outcome_minor bigint,
  cancelled_by public.cancel_party, cancel_reason text, source public.appointment_source
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_all boolean;
  v_pro uuid;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.can_read_client(v_tenant, p_client) then
    raise exception 'No encontramos esa clienta' using errcode = 'P0002';
  end if;
  v_all := app.has_permission(v_tenant, 'clients.read') and app.has_permission(v_tenant, 'agenda.read_all');
  v_pro := app.my_professional_id(v_tenant);
  return query
    select a.id, a.code, a.starts_at, a.service_name, a.professional_name,
           case when a.status = 'pending_payment' and a.hold_expires_at <= now()
                then 'expired'::public.appointment_status else a.status end,
           a.deposit_status, a.price_minor, a.deposit_minor, a.credit_applied_minor, a.currency::text,
           a.deposit_outcome, a.deposit_outcome_minor, a.cancelled_by, a.cancel_reason, a.source
    from public.appointments a
    where a.client_profile_id = p_client and a.tenant_id = v_tenant
      and (v_all or a.professional_id = v_pro)
    order by a.starts_at desc
    limit 300;
end $$;
revoke execute on function public.client_appointments(uuid) from public, anon;
grant execute on function public.client_appointments(uuid) to authenticated;

-- Pagos de Mercado Pago de la clienta (caja)
create or replace function public.client_payments(p_client uuid)
returns table (created_at timestamptz, appointment_code text, amount_minor bigint, refunded_minor bigint, currency text,
               status text, outcome text, payment_method text, payment_type text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.has_permission(v_tenant, 'clients.read') or not app.has_permission(v_tenant, 'cash.read') then
    raise exception 'No tenés permiso para ver los pagos de esta clienta' using errcode = '42501';
  end if;
  return query
    select p.created_at, a.code, p.amount_minor, p.refunded_minor, p.currency::text, p.status, p.outcome,
           p.payment_method, p.payment_type
    from public.payments p join public.appointments a on a.id = p.appointment_id
    where a.client_profile_id = p_client and p.tenant_id = v_tenant
    order by p.created_at desc
    limit 200;
end $$;
revoke execute on function public.client_payments(uuid) from public, anon;
grant execute on function public.client_payments(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Agenda (CAL-01 a CAL-04): turnos y horarios de un rango, en una consulta
-- ---------------------------------------------------------------------
create or replace function public.agenda_range(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, code text, starts_at timestamptz, ends_at timestamptz, occupied_until timestamptz,
  status public.appointment_status, deposit_status public.deposit_status, source public.appointment_source,
  professional_id uuid, professional_name text, service_name text,
  client_profile_id uuid, client_name text, client_phone text,
  checked_in_at timestamptz, started_at timestamptz, finished_at timestamptz, hold_expires_at timestamptz,
  is_frequent boolean, no_shows_180 bigint, has_allergies boolean, unclosed boolean, can_mark boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_all boolean := app.has_permission(p_tenant, 'agenda.read_all');
  v_own boolean := app.has_permission(p_tenant, 'agenda.read_own');
  v_pro uuid := app.my_professional_id(p_tenant);
  v_manage boolean := app.can(p_tenant, 'agenda.manage');
  v_mark_own boolean := app.can(p_tenant, 'agenda.mark_own');
  v_clients boolean := app.has_permission(p_tenant, 'clients.read') or app.has_permission(p_tenant, 'clients.read_own');
begin
  if not v_all and not v_own then
    raise exception 'No tenés permiso para ver la agenda' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;
  return query
    select a.id, a.code, a.starts_at, a.ends_at, a.occupied_until,
           case when a.status = 'pending_payment' and a.hold_expires_at <= now()
                then 'expired'::public.appointment_status else a.status end,
           a.deposit_status, a.source, a.professional_id, a.professional_name, a.service_name,
           a.client_profile_id, c.full_name, case when v_clients then c.phone end,
           a.checked_in_at, a.started_at, a.finished_at, a.hold_expires_at,
           t.is_frequent, t.no_shows_180,
           exists (select 1 from public.client_preferences cp
                   where cp.client_profile_id = a.client_profile_id and cp.allergies is not null),
           a.status = 'confirmed' and a.ends_at < now(),
           a.status = 'confirmed' and (v_manage or (v_mark_own and a.professional_id = v_pro))
    from public.appointments a
    join public.client_profiles c on c.id = a.client_profile_id
    cross join lateral app.client_tags(p_tenant, a.client_profile_id) t
    where a.tenant_id = p_tenant
      and a.starts_at < p_to and a.ends_at > p_from
      and (v_all or a.professional_id = v_pro)
    order by a.starts_at, a.professional_name;
end $$;
revoke execute on function public.agenda_range(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_range(uuid, timestamptz, timestamptz) to authenticated;

-- Cuándo atiende cada profesional en el rango (horario, descansos y bloqueos ya aplicados)
create or replace function public.agenda_hours(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (professional_id uuid, professional_name text, sort_order integer, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_all boolean := app.has_permission(p_tenant, 'agenda.read_all');
  v_own boolean := app.has_permission(p_tenant, 'agenda.read_own');
  v_pro uuid := app.my_professional_id(p_tenant);
begin
  if not v_all and not v_own then
    raise exception 'No tenés permiso para ver la agenda' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;
  return query
    select p.id, p.display_name, p.position, lower(r), upper(r)
    from public.professionals p
    cross join lateral app.working_intervals(p_tenant, p.id, p_from, p_to) r
    where p.tenant_id = p_tenant and p.is_active and p.archived_at is null
      and (v_all or p.id = v_pro)
    order by p.position, p.display_name, lower(r);
end $$;
revoke execute on function public.agenda_hours(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_hours(uuid, timestamptz, timestamptz) to authenticated;

-- Avisos para el inicio y la agenda: turnos pasados sin cerrar y faltas del mes
create or replace function public.agenda_alerts(p_tenant uuid)
returns table (unclosed bigint, no_shows_month bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_all boolean := app.has_permission(p_tenant, 'agenda.read_all');
  v_pro uuid := app.my_professional_id(p_tenant);
  v_tz text;
begin
  if not v_all and not app.has_permission(p_tenant, 'agenda.read_own') then
    raise exception 'No tenés permiso para ver la agenda' using errcode = '42501';
  end if;
  select timezone into v_tz from public.tenants where id = p_tenant;
  return query
    select count(*) filter (where a.status = 'confirmed' and a.ends_at < now()),
           count(*) filter (where a.status = 'no_show'
                              and a.starts_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz))
    from public.appointments a
    where a.tenant_id = p_tenant and (v_all or a.professional_id = v_pro)
      and a.starts_at > now() - interval '62 days';
end $$;
revoke execute on function public.agenda_alerts(uuid) from public, anon;
grant execute on function public.agenda_alerts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Indicadores de asistencia del estudio (ATT-03 a ATT-05): reports.read
-- ---------------------------------------------------------------------
create or replace function public.attendance_stats(
  p_tenant uuid, p_from timestamptz, p_to timestamptz, p_professional uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_counts record;
begin
  if not app.has_permission(p_tenant, 'reports.read') then
    raise exception 'No tenés permiso para ver los indicadores' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_professional is not null and not exists (select 1 from public.professionals where id = p_professional and tenant_id = p_tenant) then
    raise exception 'Esa profesional no es de este estudio' using errcode = '22023';
  end if;
  select * into v_counts from app.attendance_counts(p_tenant, null, p_professional, p_from, p_to);
  return jsonb_build_object(
    'attended', v_counts.attended, 'no_shows', v_counts.no_shows, 'late_cancels', v_counts.late_cancels,
    'timely_cancels', v_counts.timely_cancels, 'studio_cancels', v_counts.studio_cancels,
    'reschedules', v_counts.reschedules,
    'rate', case when v_counts.attended + v_counts.no_shows > 0
                 then round(100.0 * v_counts.attended / (v_counts.attended + v_counts.no_shows), 1) end,
    'frequent', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'attended', x.attended,
                                          'last_visit', x.last_visit) order by x.attended desc, x.last_visit desc)
      from (select c.id, c.full_name, count(*) as attended, max(a.starts_at) as last_visit
            from public.appointments a join public.client_profiles c on c.id = a.client_profile_id
            where a.tenant_id = p_tenant and a.status = 'completed'
              and a.starts_at >= p_from and a.starts_at < least(p_to, now())
              and (p_professional is null or a.professional_id = p_professional)
            group by c.id, c.full_name having count(*) >= 3
            order by count(*) desc, max(a.starts_at) desc limit 20) x), '[]'::jsonb),
    'repeat_no_shows', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'no_shows', x.no_shows,
                                          'attended', x.attended, 'last_no_show', x.last_no_show)
                       order by x.no_shows desc, x.last_no_show desc)
      from (select c.id, c.full_name,
                   count(*) filter (where a.status = 'no_show') as no_shows,
                   count(*) filter (where a.status = 'completed') as attended,
                   max(a.starts_at) filter (where a.status = 'no_show') as last_no_show
            from public.appointments a join public.client_profiles c on c.id = a.client_profile_id
            where a.tenant_id = p_tenant and a.status in ('no_show', 'completed')
              and a.starts_at >= p_from and a.starts_at < least(p_to, now())
              and (p_professional is null or a.professional_id = p_professional)
            group by c.id, c.full_name having count(*) filter (where a.status = 'no_show') >= 2
            order by 3 desc, 5 desc limit 20) x), '[]'::jsonb)
  );
end $$;
revoke execute on function public.attendance_stats(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.attendance_stats(uuid, timestamptz, timestamptz, uuid) to authenticated;
