import {
    AdminCommand,
    AddressZone,
    NuevoClienteCommand,
    NuevaDireccionCommand,
    BajaClienteCommand,
    BajaDireccionCommand,
    ParsedAdminCommand,
} from '../types';

// ─── Zone label → enum value ──────────────────────────────────────────────────

const ZONE_MAP: Record<string, AddressZone> = {
    'caba': 'CABA',
    'amba 1': 'AMBA_1',
    'amba1': 'AMBA_1',
    'amba 2': 'AMBA_2',
    'amba2': 'AMBA_2',
    'amba 3': 'AMBA_3',
    'amba3': 'AMBA_3',
};

function parseZone(raw: string): AddressZone | null {
    return ZONE_MAP[raw.trim().toLowerCase()] ?? null;
}

// ─── Trigger prefixes (case-insensitive) ──────────────────────────────────────

const TRIGGERS = {
    NUEVO_CLIENTE: /^nuevo cliente\s*:/i,
    NUEVA_DIRECCION: /^nueva dirección\s*:/i,  // with accent
    NUEVA_DIR_ALT: /^nueva direccion\s*:/i,  // without accent
    BAJA_CLIENTE: /^baja cliente\s*:/i,
    BAJA_DIRECCION: /^baja dirección\s*:/i,
    BAJA_DIR_ALT: /^baja direccion\s*:/i,
};

/**
 * Returns true if the message starts with any known admin trigger prefix.
 * Used by the controller to short-circuit routing before parsing.
 */
export function isAdminCommand(text: string): boolean {
    const t = text.trim();
    return (
        TRIGGERS.NUEVO_CLIENTE.test(t) ||
        TRIGGERS.NUEVA_DIRECCION.test(t) ||
        TRIGGERS.NUEVA_DIR_ALT.test(t) ||
        TRIGGERS.BAJA_CLIENTE.test(t) ||
        TRIGGERS.BAJA_DIRECCION.test(t) ||
        TRIGGERS.BAJA_DIR_ALT.test(t)
    );
}

// ─── Field extractors ─────────────────────────────────────────────────────────

/**
 * Extracts the value after "Label: ..." from a lines array (case-insensitive).
 * Returns undefined if no matching line is found.
 */
function extractField(lines: string[], label: string): string | undefined {
    const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'i');
    for (const line of lines) {
        const m = line.match(pattern);
        if (m) return m[1].trim();
    }
    return undefined;
}

// ─── Individual parsers ───────────────────────────────────────────────────────

/**
 * "Nuevo cliente: <name>"
 * Optional second+ lines:
 *   "Alias: <alias1>, <alias2>"
 *
 * Example:
 *   Nuevo cliente: Distribuidora Norte
 *   Alias: Distri Norte, Dist. Norte
 */
function parseNuevoCliente(lines: string[]): ParsedAdminCommand {
    const errors: string[] = [];

    // The trigger line itself carries the name after the colon
    const firstLine = lines[0];
    const nameMatch = firstLine.match(/^nuevo cliente\s*:\s*(.+)$/i);
    const name = nameMatch?.[1]?.trim();

    if (!name) {
        errors.push('Falta el nombre del cliente. Formato: "Nuevo cliente: <nombre>"');
    }

    // Optional: "Alias: value1, value2"
    const aliasRaw = extractField(lines.slice(1), 'alias');
    const aliases = aliasRaw
        ? aliasRaw.split(',').map(a => a.trim()).filter(Boolean)
        : [];

    const command: NuevoClienteCommand = {
        kind: 'nuevo_cliente',
        name: name ?? '',
        aliases,
    };

    return { command, errors };
}

/**
 * "Nueva dirección: <address>"
 * Required additional lines:
 *   "Cliente: <name>"
 *   "Zona: CABA | AMBA 1 | AMBA 2 | AMBA 3"
 *
 * Example:
 *   Nueva dirección: Av. Corrientes 1234
 *   Cliente: Distribuidora Norte
 *   Zona: CABA
 */
function parseNuevaDireccion(lines: string[]): ParsedAdminCommand {
    const errors: string[] = [];

    const firstLine = lines[0];
    const addrMatch = firstLine.match(/^nueva direcci[oó]n\s*:\s*(.+)$/i);
    const address = addrMatch?.[1]?.trim();

    if (!address) {
        errors.push('Falta la dirección. Formato: "Nueva dirección: <dirección>"');
    }

    const clientName = extractField(lines.slice(1), 'cliente');
    if (!clientName) {
        errors.push('Falta el nombre del cliente. Agregá "Cliente: <nombre>" en una línea separada.');
    }

    const zoneRaw = extractField(lines.slice(1), 'zona');
    const zone = zoneRaw ? parseZone(zoneRaw) : null;

    if (!zoneRaw) {
        errors.push('Falta la zona. Agregá "Zona: CABA | AMBA 1 | AMBA 2 | AMBA 3" en una línea separada.');
    } else if (!zone) {
        errors.push(`Zona inválida: "${zoneRaw}". Valores válidos: CABA, AMBA 1, AMBA 2, AMBA 3.`);
    }

    const command: NuevaDireccionCommand = {
        kind: 'nueva_direccion',
        clientName: clientName ?? '',
        address: address ?? '',
        zone: zone ?? 'CABA',
    };

    return { command, errors };
}

/**
 * "Baja cliente: <name>"
 *
 * Example:
 *   Baja cliente: Distribuidora Norte
 */
function parseBajaCliente(lines: string[]): ParsedAdminCommand {
    const errors: string[] = [];

    const firstLine = lines[0];
    const nameMatch = firstLine.match(/^baja cliente\s*:\s*(.+)$/i);
    const name = nameMatch?.[1]?.trim();

    if (!name) {
        errors.push('Falta el nombre del cliente. Formato: "Baja cliente: <nombre>"');
    }

    const command: BajaClienteCommand = {
        kind: 'baja_cliente',
        name: name ?? '',
    };

    return { command, errors };
}

/**
 * "Baja dirección: <id>"
 *
 * The address ID is used because addresses are not globally unique.
 * The driver can look up the ID from the listing sent after "Nueva dirección" confirmations.
 *
 * Example:
 *   Baja dirección: 42
 */
function parseBajaDireccion(lines: string[]): ParsedAdminCommand {
    const errors: string[] = [];

    const firstLine = lines[0];
    const idMatch = firstLine.match(/^baja direcci[oó]n\s*:\s*(\d+)$/i);
    const addressId = idMatch ? parseInt(idMatch[1], 10) : null;

    if (addressId === null) {
        errors.push(
            'Formato incorrecto. Usá el ID numérico de la dirección: "Baja dirección: <id>".\n' +
            'Podés ver el ID en la confirmación que recibiste al guardar la dirección.',
        );
    }

    const command: BajaDireccionCommand = {
        kind: 'baja_direccion',
        addressId: addressId ?? 0,
    };

    return { command, errors };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Parses a raw WhatsApp text message into a typed AdminCommand.
 * Returns errors if required fields are missing or invalid.
 * Always returns a command object — the caller checks errors before saving.
 */
export function parseAdminCommand(rawText: string): ParsedAdminCommand {
    const lines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    if (lines.length === 0) {
        return {
            command: { kind: 'nuevo_cliente', name: '', aliases: [] },
            errors: ['Mensaje vacío.'],
        };
    }

    const firstLine = lines[0];

    if (TRIGGERS.NUEVO_CLIENTE.test(firstLine)) {
        return parseNuevoCliente(lines);
    }

    if (TRIGGERS.NUEVA_DIRECCION.test(firstLine) || TRIGGERS.NUEVA_DIR_ALT.test(firstLine)) {
        return parseNuevaDireccion(lines);
    }

    if (TRIGGERS.BAJA_CLIENTE.test(firstLine)) {
        return parseBajaCliente(lines);
    }

    if (TRIGGERS.BAJA_DIRECCION.test(firstLine) || TRIGGERS.BAJA_DIR_ALT.test(firstLine)) {
        return parseBajaDireccion(lines);
    }

    // Should not be reached if isAdminCommand() was called first
    return {
        command: { kind: 'nuevo_cliente', name: '', aliases: [] },
        errors: ['Comando no reconocido.'],
    };
}