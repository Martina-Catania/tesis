import { parseAdminCommand, isAdminCommand } from './parser';

// ─── isAdminCommand ───────────────────────────────────────────────────────────

describe('isAdminCommand', () => {
    it('recognises "Nuevo cliente:" trigger', () => {
        expect(isAdminCommand('Nuevo cliente: ACME')).toBe(true);
    });

    it('recognises "Nueva dirección:" with accent', () => {
        expect(isAdminCommand('Nueva dirección: Av. Corrientes 1234\nCliente: ACME\nZona: CABA')).toBe(true);
    });

    it('recognises "Nueva direccion:" without accent', () => {
        expect(isAdminCommand('Nueva direccion: Calle Falsa 123\nCliente: ACME\nZona: AMBA 1')).toBe(true);
    });

    it('recognises "Baja cliente:"', () => {
        expect(isAdminCommand('Baja cliente: ACME')).toBe(true);
    });

    it('recognises "Baja dirección:" with accent', () => {
        expect(isAdminCommand('Baja dirección: 42')).toBe(true);
    });

    it('recognises "Baja direccion:" without accent', () => {
        expect(isAdminCommand('Baja direccion: 42')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isAdminCommand('NUEVO CLIENTE: ACME')).toBe(true);
        expect(isAdminCommand('nuevo cliente: ACME')).toBe(true);
    });

    it('returns false for regular delivery messages', () => {
        expect(isAdminCommand('ACME\n10x20x30 5')).toBe(false);
        expect(isAdminCommand('Hola')).toBe(false);
        expect(isAdminCommand('match')).toBe(false);
    });
});

// ─── Nuevo cliente ────────────────────────────────────────────────────────────

describe('parseAdminCommand — nuevo_cliente', () => {
    it('parses a minimal new-client command', () => {
        const result = parseAdminCommand('Nuevo cliente: Distribuidora Norte');

        expect(result.errors).toHaveLength(0);
        expect(result.command.kind).toBe('nuevo_cliente');
        if (result.command.kind === 'nuevo_cliente') {
            expect(result.command.name).toBe('Distribuidora Norte');
            expect(result.command.aliases).toEqual([]);
        }
    });

    it('parses aliases from a second line', () => {
        const result = parseAdminCommand('Nuevo cliente: Distribuidora Norte\nAlias: Distri Norte, DN');

        expect(result.errors).toHaveLength(0);
        if (result.command.kind === 'nuevo_cliente') {
            expect(result.command.aliases).toEqual(['Distri Norte', 'DN']);
        }
    });

    it('trims whitespace from name and aliases', () => {
        const result = parseAdminCommand('Nuevo cliente:   El Super   \nAlias:  A1 ,  A2  ');

        if (result.command.kind === 'nuevo_cliente') {
            expect(result.command.name).toBe('El Super');
            expect(result.command.aliases).toEqual(['A1', 'A2']);
        }
    });

    it('reports an error when the name is missing', () => {
        const result = parseAdminCommand('Nuevo cliente:');

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('nombre');
    });

    it('is case-insensitive for the trigger keyword', () => {
        const result = parseAdminCommand('NUEVO CLIENTE: ACME S.A.');

        expect(result.errors).toHaveLength(0);
        if (result.command.kind === 'nuevo_cliente') {
            expect(result.command.name).toBe('ACME S.A.');
        }
    });
});

// ─── Nueva dirección ──────────────────────────────────────────────────────────

describe('parseAdminCommand — nueva_direccion', () => {
    const VALID = [
        'Nueva dirección: Av. Corrientes 1234',
        'Cliente: ACME',
        'Zona: CABA',
    ].join('\n');

    it('parses a well-formed new-address command', () => {
        const result = parseAdminCommand(VALID);

        expect(result.errors).toHaveLength(0);
        expect(result.command.kind).toBe('nueva_direccion');
        if (result.command.kind === 'nueva_direccion') {
            expect(result.command.address).toBe('Av. Corrientes 1234');
            expect(result.command.clientName).toBe('ACME');
            expect(result.command.zone).toBe('CABA');
        }
    });

    it('accepts "Nueva direccion:" without accent', () => {
        const result = parseAdminCommand(
            'Nueva direccion: Calle 1\nCliente: ACME\nZona: AMBA 1',
        );

        expect(result.errors).toHaveLength(0);
        if (result.command.kind === 'nueva_direccion') {
            expect(result.command.zone).toBe('AMBA_1');
        }
    });

    it('maps all zone labels correctly', () => {
        const zones: Array<[string, string]> = [
            ['CABA', 'CABA'],
            ['AMBA 1', 'AMBA_1'],
            ['AMBA1', 'AMBA_1'],
            ['AMBA 2', 'AMBA_2'],
            ['AMBA2', 'AMBA_2'],
            ['AMBA 3', 'AMBA_3'],
            ['AMBA3', 'AMBA_3'],
        ];

        for (const [input, expected] of zones) {
            const result = parseAdminCommand(
                `Nueva dirección: Calle 1\nCliente: ACME\nZona: ${input}`,
            );
            expect(result.errors).toHaveLength(0);
            if (result.command.kind === 'nueva_direccion') {
                expect(result.command.zone).toBe(expected);
            }
        }
    });

    it('reports an error when address is missing', () => {
        const result = parseAdminCommand('Nueva dirección:\nCliente: ACME\nZona: CABA');

        expect(result.errors.some(e => e.includes('dirección'))).toBe(true);
    });

    it('reports an error when client line is missing', () => {
        const result = parseAdminCommand('Nueva dirección: Av. Corrientes 1234\nZona: CABA');

        expect(result.errors.some(e => e.toLowerCase().includes('cliente'))).toBe(true);
    });

    it('reports an error when zone line is missing', () => {
        const result = parseAdminCommand('Nueva dirección: Av. Corrientes 1234\nCliente: ACME');

        expect(result.errors.some(e => e.toLowerCase().includes('zona'))).toBe(true);
    });

    it('reports an error for an invalid zone value', () => {
        const result = parseAdminCommand(
            'Nueva dirección: Av. Corrientes 1234\nCliente: ACME\nZona: GBA',
        );

        expect(result.errors.some(e => e.includes('GBA'))).toBe(true);
    });

    it('reports all three errors when only the trigger line is present', () => {
        const result = parseAdminCommand('Nueva dirección: Calle 1');

        // Missing: cliente + zona
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
});

// ─── Baja cliente ─────────────────────────────────────────────────────────────

describe('parseAdminCommand — baja_cliente', () => {
    it('parses a valid baja-cliente command', () => {
        const result = parseAdminCommand('Baja cliente: Distribuidora Norte');

        expect(result.errors).toHaveLength(0);
        expect(result.command.kind).toBe('baja_cliente');
        if (result.command.kind === 'baja_cliente') {
            expect(result.command.name).toBe('Distribuidora Norte');
        }
    });

    it('reports an error when the name is missing', () => {
        const result = parseAdminCommand('Baja cliente:');

        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('trims whitespace from the name', () => {
        const result = parseAdminCommand('Baja cliente:   El Super   ');

        if (result.command.kind === 'baja_cliente') {
            expect(result.command.name).toBe('El Super');
        }
    });
});

// ─── Baja dirección ───────────────────────────────────────────────────────────

describe('parseAdminCommand — baja_direccion', () => {
    it('parses a valid baja-dirección command', () => {
        const result = parseAdminCommand('Baja dirección: 42');

        expect(result.errors).toHaveLength(0);
        expect(result.command.kind).toBe('baja_direccion');
        if (result.command.kind === 'baja_direccion') {
            expect(result.command.addressId).toBe(42);
        }
    });

    it('accepts "Baja direccion:" without accent', () => {
        const result = parseAdminCommand('Baja direccion: 7');

        expect(result.errors).toHaveLength(0);
        if (result.command.kind === 'baja_direccion') {
            expect(result.command.addressId).toBe(7);
        }
    });

    it('reports an error when the id is not a number', () => {
        const result = parseAdminCommand('Baja dirección: abc');

        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports an error when the id is missing', () => {
        const result = parseAdminCommand('Baja dirección:');

        expect(result.errors.length).toBeGreaterThan(0);
    });
});