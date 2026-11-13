import "server-only";
import type { StaffContext } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Fichas de clientas (Épica 09). La base decide quién ve qué: clients.read (todas) o
 * clients.read_own (la profesional, solo sus clientas, sin pagos ni saldo).
 */
export type ClientRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  has_account: boolean;
  last_visit: string | null;
  next_visit: string | null;
  attended_90: number;
  no_shows_180: number;
  is_frequent: boolean;
  repeat_no_shows: boolean;
  credit_minor: number | null;
  total_count: number;
};

export type ClientFile = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  has_account: boolean;
  source: string;
  created_at: string;
  is_frequent: boolean;
  repeat_no_shows: boolean;
  attended_90: number;
  no_shows_180: number;
  attended: number;
  no_shows: number;
  late_cancels: number;
  timely_cancels: number;
  studio_cancels: number;
  reschedules: number;
  last_visit: string | null;
  allergies: string | null;
  preferences: string | null;
  preferred_professional: string | null;
  preferred_professional_id: string | null;
  credit_minor: number | null;
  only_own: boolean;
};

export type ClientAppointment = {
  id: string;
  code: string;
  starts_at: string;
  service_name: string;
  professional_name: string;
  status: string;
  deposit_status: string;
  price_minor: number;
  deposit_minor: number;
  credit_applied_minor: number;
  currency: string;
  deposit_outcome: string | null;
  deposit_outcome_minor: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  source: string;
};

export type ClientNote = { id: string; body: string; author_name: string; is_mine: boolean; created_at: string; hidden_at: string | null };

export type ClientCreditLot = {
  lot_id: string;
  kind: string;
  original_minor: number;
  remaining_minor: number;
  currency: string;
  expires_at: string;
  created_at: string;
  appointment_code: string | null;
};

export type ClientPayment = {
  created_at: string;
  appointment_code: string;
  amount_minor: number;
  refunded_minor: number;
  currency: string;
  status: string;
  outcome: string | null;
  payment_method: string | null;
  payment_type: string | null;
};

export const CLIENT_FILTERS = [
  { key: "all", label: "Todas" },
  { key: "frequent", label: "Frecuentes" },
  { key: "no_shows", label: "Con faltas" },
  { key: "credit", label: "Con saldo" },
] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number]["key"];

export const PAGE_SIZE = 30;

export async function listClients(ctx: StaffContext, search: string, filter: ClientFilter, page: number) {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("list_clients", {
    p_tenant: ctx.tenantId, p_search: search || null, p_filter: filter, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
  });
  if (error) throw new Error(`No se pudieron cargar las clientas: ${error.message}`);
  const rows = (data ?? []) as ClientRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

/** Ficha completa, o null si no existe o no la puede ver. */
export async function loadClientFile(id: string, withPayments: boolean) {
  const supabase = await serverSupabase();
  const file = await supabase.rpc("client_file", { p_client: id });
  if (file.error || !file.data) return null;
  const f = file.data as ClientFile;
  const [appts, notes, credit, payments] = await Promise.all([
    supabase.rpc("client_appointments", { p_client: id }),
    supabase.rpc("client_notes_list", { p_client: id }),
    f.only_own ? Promise.resolve({ data: [] }) : supabase.rpc("client_credit", { p_client: id }),
    withPayments && !f.only_own ? supabase.rpc("client_payments", { p_client: id }) : Promise.resolve({ data: [] }),
  ]);
  return {
    file: f,
    appointments: (appts.data ?? []) as ClientAppointment[],
    notes: (notes.data ?? []) as ClientNote[],
    credit: (credit.data ?? []) as ClientCreditLot[],
    payments: (payments.data ?? []) as ClientPayment[],
  };
}
