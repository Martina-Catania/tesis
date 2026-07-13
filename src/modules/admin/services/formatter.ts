import { AdminCommand, AddressZone } from '../types';

// ─── Zone display labels ──────────────────────────────────────────────────────

const ZONE_LABEL: Record<AddressZone, string> = {
    CABA: 'CABA',
    AMBA_1: 'AMBA 1',
    AMBA_2: 'AMBA 2',
    AMBA_3: 'AMBA 3',
};

// ─── Review message (shown before saving) ────────────────────────────────────

/**
 * Builds the interactive-message body that lets the user review the parsed
 * command before confirming. The two buttons are always "Confirmar" / "Cancelar".
 */
export function formatAdminReviewMessage(command: AdminCommand): string {
    switch (command.kind) {
        case 'nuevo_cliente': {
            const aliasLine = command.aliases.length
                ? `\n*Aliases:* ${command.aliases.join(', ')}`
                : '';
            return (
                `🆕 *Nuevo cliente*\n\n` +
                `*Nombre:* ${command.name}` +
                aliasLine +
                `\n\n¿Confirmás el alta?`
            );
        }

        case 'nueva_direccion':
            return (
                `🆕 *Nueva dirección*\n\n` +
                `*Cliente:* ${command.clientName}\n` +
                `*Dirección:* ${command.address}\n` +
                `*Zona:* ${ZONE_LABEL[command.zone]}\n\n` +
                `¿Confirmás el alta?`
            );

        case 'baja_cliente':
            return (
                `🗑️ *Baja de cliente*\n\n` +
                `*Nombre:* ${command.name}\n\n` +
                `⚠️ Esta acción es irreversible si el cliente no tiene registros.\n` +
                `¿Confirmás la baja?`
            );

        case 'baja_direccion':
            return (
                `🗑️ *Baja de dirección*\n\n` +
                `*ID dirección:* ${command.addressId}\n\n` +
                `La dirección quedará *inactiva* (no se elimina, solo se desactiva).\n` +
                `¿Confirmás la baja?`
            );
    }
}

// ─── Success messages (shown after saving) ────────────────────────────────────

export function formatAdminSuccessMessage(command: AdminCommand, extra?: string): string {
    switch (command.kind) {
        case 'nuevo_cliente': {
            const aliasLine = command.aliases.length
                ? `\n*Aliases:* ${command.aliases.join(', ')}`
                : '';
            return (
                `✅ *Cliente dado de alta*\n\n` +
                `*Nombre:* ${command.name}` +
                aliasLine +
                (extra ? `\n\n${extra}` : '')
            );
        }

        case 'nueva_direccion':
            return (
                `✅ *Dirección guardada*\n\n` +
                `*Cliente:* ${command.clientName}\n` +
                `*Dirección:* ${command.address}\n` +
                `*Zona:* ${ZONE_LABEL[command.zone]}` +
                (extra ? `\n\n${extra}` : '')
            );

        case 'baja_cliente':
            return (
                `✅ *Cliente eliminado*\n\n` +
                `*Nombre:* ${command.name}` +
                (extra ? `\n\n${extra}` : '')
            );

        case 'baja_direccion':
            return (
                `✅ *Dirección desactivada*\n\n` +
                `*ID:* ${command.addressId}` +
                (extra ? `\n\n_${extra}_` : '')
            );
    }
}

// ─── Cancellation message ─────────────────────────────────────────────────────

export function formatAdminCancelMessage(): string {
    return '❌ Operación cancelada. No se realizaron cambios.';
}

// ─── Parse-error message (sent immediately, no interactive buttons) ───────────

export function formatAdminParseErrorMessage(errors: string[]): string {
    const errorList = errors.map(e => `   - ${e}`).join('\n');
    return (
        `⚠️ *No se pudo procesar el comando*\n\n` +
        `Corregí los siguientes campos y volvé a enviar:\n\n` +
        errorList
    );
}

// ─── Help / usage hint ────────────────────────────────────────────────────────

export function formatAdminHelpMessage(): string {
    return (
        `📋 *Comandos disponibles*\n\n` +
        `*Alta de cliente:*\n` +
        `_Nuevo cliente: <nombre>_\n` +
        `_Alias: <alias1>, <alias2>_ _(opcional)_\n\n` +
        `*Alta de dirección:*\n` +
        `_Nueva dirección: <dirección>_\n` +
        `_Cliente: <nombre>_\n` +
        `_Zona: CABA | AMBA 1 | AMBA 2 | AMBA 3_\n\n` +
        `*Baja de cliente:*\n` +
        `_Baja cliente: <nombre>_\n\n` +
        `*Baja de dirección:*\n` +
        `_Baja dirección: <id>_`
    );
}