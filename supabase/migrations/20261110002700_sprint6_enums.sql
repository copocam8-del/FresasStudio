-- =====================================================================
-- Cleo · Migración 2700 · Estados nuevos (Sprint 6, Épicas 07–10)
--
-- Van solos en esta migración porque Postgres no deja usar un valor nuevo de un
-- enum en la misma transacción en la que se agrega.
--
--   appointment_status: rescheduled (se movió a otro turno), completed (atendida),
--                       no_show (faltó).
--   deposit_status:     credit (la seña la cubrió el saldo a favor),
--                       transferred (la seña vino de un turno reprogramado a tiempo).
--   cancel_party:       quién canceló (la clienta o el estudio).
--   deposit_outcome:    qué pasó con la seña al cerrar el turno.
-- =====================================================================

alter type public.appointment_status add value if not exists 'rescheduled';
alter type public.appointment_status add value if not exists 'completed';
alter type public.appointment_status add value if not exists 'no_show';

alter type public.deposit_status add value if not exists 'credit';
alter type public.deposit_status add value if not exists 'transferred';

create type public.cancel_party as enum ('client', 'studio');

create type public.deposit_outcome as enum (
  'applied',      -- atendida: la seña cuenta como pago del turno
  'credited',     -- pasó al saldo a favor de la clienta
  'forfeited',    -- se perdió (cancelación tardía, reprogramación tardía o falta)
  'refunded',     -- se devolvió el dinero (cancelación del estudio)
  'transferred'   -- pasó entera al turno nuevo (reprogramación a tiempo)
);
