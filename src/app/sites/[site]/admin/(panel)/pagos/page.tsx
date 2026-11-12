import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/panel/panel-ui";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTimeLong } from "@/lib/booking-format";
import { paymentsConfig } from "@/lib/payments/config";
import { serverSupabase } from "@/lib/supabase/server";
import { ConnectButton, DisconnectButton } from "./payments-buttons";

export const metadata: Metadata = { title: "Mercado Pago" };

type Status = {
  status: "connected" | "needs_reconnect" | null;
  mp_nickname: string | null;
  live_mode: boolean | null;
  connected_at: string | null;
  connected_by_name: string | null;
  token_expires_at: string | null;
  last_error: string | null;
  pending_online: number;
  online_booking_enabled: boolean;
};

const ERRORS: Record<string, string> = {
  cancelado: "No se completó la conexión en Mercado Pago. Podés probar de nuevo cuando quieras.",
  vencido: "La conexión venció o ya se usó. Tocá «Conectar Mercado Pago» de nuevo.",
  permiso: "Solo la dueña puede conectar Mercado Pago.",
  otra_cuenta: "Esa cuenta de Mercado Pago ya está conectada a otro estudio. Usá la cuenta de este estudio.",
  pais: "La cuenta de Mercado Pago tiene que ser de Argentina.",
  sin_renovacion: "Mercado Pago no dio permiso para mantener la conexión activa. Probá de nuevo; si sigue, avisanos.",
  mercadopago: "Mercado Pago no respondió bien. Probá de nuevo en unos minutos.",
  no_configurado: "Mercado Pago todavía no está disponible. Avisanos y lo activamos.",
  error: "Algo salió mal al guardar la conexión. Probá de nuevo en unos minutos.",
};

export default async function PaymentsPage({ params, searchParams }: PageProps<"/sites/[site]/admin/pagos">) {
  const { site } = await params;
  const q = await searchParams;
  const ctx = await requireStaff(site, "/admin/pagos");
  const canManage = can(ctx, "payments.manage");
  if (!canManage && !can(ctx, "settings.manage")) notFound();

  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("get_payments_status", { p_tenant: ctx.tenantId });
  if (error) throw new Error(`No se pudo leer el estado de pagos: ${error.code}`);
  const s = (data as Status[])[0];
  const tz = ctx.studio.timezone;
  const available = Boolean(paymentsConfig());
  const errorMsg = typeof q.error === "string" ? (ERRORS[q.error] ?? ERRORS.error) : null;
  const okMsg = q.ok === "conectado" ? "¡Listo! Mercado Pago quedó conectado. Ya podés activar las reservas online en «Reservas»." : null;

  return (
    <>
      <PageHeader
        title="Mercado Pago"
        description="Las señas de las reservas online se cobran en la cuenta de Mercado Pago del estudio."
        action={can(ctx, "cash.read") ? { href: "/admin/pagos/movimientos", label: "Ver pagos recibidos" } : undefined}
      />
      {errorMsg && <p role="alert" className="rounded-2xl border border-[#8d4d49] bg-status-cancel/70 p-3.5 text-status-cancel-foreground text-sm text-destructive">{errorMsg}</p>}
      {okMsg && <p role="status" className="rounded-2xl border border-border bg-[#1d1716]/85 p-3.5 text-sm text-foreground">{okMsg}</p>}

      <section className="flex flex-col gap-4 glass rounded-[1.1rem] p-5">
        {s?.status === "connected" && (
          <>
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-card-foreground">
                Conectado{s.mp_nickname ? <> como <span className="break-all">{s.mp_nickname}</span></> : null}
              </p>
              {s.live_mode === false && (
                <p className="text-sm font-medium text-destructive">Cuenta de prueba: los pagos no son reales.</p>
              )}
              {s.connected_at && (
                <p className="text-sm text-muted-foreground">
                  Desde el {formatDateTimeLong(s.connected_at, tz)}{s.connected_by_name ? ` · lo conectó ${s.connected_by_name}` : ""}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                La conexión se renueva sola. Las reservas online están {s.online_booking_enabled ? "activadas" : "apagadas (se activan en «Reservas»)"}.
              </p>
            </div>
            {canManage && <DisconnectButton pendingOnline={s.pending_online} />}
          </>
        )}

        {s?.status === "needs_reconnect" && (
          <>
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-destructive">Hay que volver a conectar Mercado Pago</p>
              <p className="text-sm text-muted-foreground">
                Mercado Pago dejó de darnos acceso a la cuenta{s.mp_nickname ? ` ${s.mp_nickname}` : ""} (por ejemplo, si se quitó
                el permiso desde Mercado Pago). Mientras tanto no se pueden cobrar señas y las reservas online están apagadas.
              </p>
            </div>
            {canManage && <ConnectButton disabled={!available} label="Volver a conectar" />}
            {canManage && <DisconnectButton pendingOnline={s.pending_online} />}
          </>
        )}

        {!s?.status && (
          <>
            <div className="flex flex-col gap-2 text-sm text-card-foreground">
              <p className="font-semibold">Mercado Pago no está conectado</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li>La plata de cada seña va directo a la cuenta de Mercado Pago del estudio.</li>
                <li>Mercado Pago cobra su comisión de cada pago, como en cualquier cobro con su cuenta.</li>
                <li>Las reservas se confirman solas cuando Mercado Pago aprueba el pago.</li>
                <li>Te va a pedir que inicies sesión con la cuenta del estudio y que autorices la conexión.</li>
              </ul>
            </div>
            {canManage ? (
              <ConnectButton disabled={!available} label="Conectar Mercado Pago" />
            ) : (
              <p className="text-sm text-muted-foreground">Solo la dueña puede conectar la cuenta.</p>
            )}
            {canManage && !available && (
              <p className="text-sm text-muted-foreground">Mercado Pago todavía no está disponible. Avisanos y lo activamos.</p>
            )}
          </>
        )}
      </section>
    </>
  );
}
