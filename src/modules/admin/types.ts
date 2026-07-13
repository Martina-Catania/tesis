// ─── Zone (mirrors the Prisma enum) ──────────────────────────────────────────

export type AddressZone = 'CABA' | 'AMBA_1' | 'AMBA_2' | 'AMBA_3';

// ─── Command kinds ────────────────────────────────────────────────────────────

export type AdminCommandKind =
    | 'nuevo_cliente'
    | 'nueva_direccion'
    | 'baja_cliente'
    | 'baja_direccion';

// ─── Parsed commands ──────────────────────────────────────────────────────────

export interface NuevoClienteCommand {
    kind: 'nuevo_cliente';
    name: string;
    aliases: string[]; // optional, may be empty
}

export interface NuevaDireccionCommand {
    kind: 'nueva_direccion';
    clientName: string;
    address: string;
    zone: AddressZone;
}

export interface BajaClienteCommand {
    kind: 'baja_cliente';
    name: string;
}

export interface BajaDireccionCommand {
    kind: 'baja_direccion';
    addressId: number;
}

export type AdminCommand =
    | NuevoClienteCommand
    | NuevaDireccionCommand
    | BajaClienteCommand
    | BajaDireccionCommand;

// ─── Parse result ─────────────────────────────────────────────────────────────

export interface ParsedAdminCommand {
    command: AdminCommand;
    errors: string[]; // non-empty → missing/invalid fields; do NOT save
}

// ─── Pending confirmation (stored in Cache) ───────────────────────────────────

/**
 * Stored in Cache keyed by the outgoing interactive message ID.
 * On confirmation the controller replays the command against the DB.
 */
export interface PendingAdminConfirmation {
    command: AdminCommand;
}