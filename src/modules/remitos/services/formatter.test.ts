import { formatRemitoReply } from './formatter';
import { ParsedRemito } from '../types';

describe('formatRemitoReply', () => {
    // ─── Success ───────────────────────────────────────────────────────────────

    it('shows a success header and all three fields when there are no errors', () => {
        const remito: ParsedRemito = {
            data: { clientName: 'ACME S.A.', address: 'Av. Corrientes 1234', packages: 3 },
            errors: [],
        };

        const result = formatRemitoReply(remito);

        expect(result).toBe(
            '✅ *Remito guardado*\n\n' +
            '*Cliente:* ACME S.A.\n' +
            '*Dir:* Av. Corrientes 1234\n' +
            '*Bultos:* 3',
        );
    });

    // ─── Partial data + errors ─────────────────────────────────────────────────

    it('shows a warning header, partial data, and errors when some fields are missing', () => {
        const remito: ParsedRemito = {
            data: { clientName: 'ACME S.A.' },
            errors: [
                'No se pudo identificar la dirección en el remito',
                'No se pudo identificar la cantidad de bultos en el remito',
            ],
        };

        const result = formatRemitoReply(remito);

        expect(result).toBe(
            '⚠️ *Remito guardado con advertencias*\n\n' +
            '*Cliente:* ACME S.A.\n' +
            '*Dir:* —\n' +
            '*Bultos:* —\n\n' +
            '   - No se pudo identificar la dirección en el remito\n' +
            '   - No se pudo identificar la cantidad de bultos en el remito',
        );
    });

    it('renders packages as — when only address was extracted', () => {
        const remito: ParsedRemito = {
            data: { address: 'Calle Falsa 123' },
            errors: [
                'No se pudo identificar el cliente en el remito',
                'No se pudo identificar la cantidad de bultos en el remito',
            ],
        };

        const result = formatRemitoReply(remito);

        expect(result).toContain('*Cliente:* —');
        expect(result).toContain('*Dir:* Calle Falsa 123');
        expect(result).toContain('*Bultos:* —');
        expect(result).toContain('⚠️ *Remito guardado con advertencias*');
    });

    it('shows the unknown-client error from DB validation alongside extracted data', () => {
        const remito: ParsedRemito = {
            data: { clientName: 'Desconocido S.A.', address: 'Calle 1', packages: 2 },
            errors: ['Cliente desconocido: "Desconocido S.A."'],
        };

        const result = formatRemitoReply(remito);

        expect(result).toBe(
            '⚠️ *Remito guardado con advertencias*\n\n' +
            '*Cliente:* Desconocido S.A.\n' +
            '*Dir:* Calle 1\n' +
            '*Bultos:* 2\n\n' +
            '   - Cliente desconocido: "Desconocido S.A."',
        );
    });

    // ─── Full failure ──────────────────────────────────────────────────────────

    it('shows a failure header with only errors and no data block when nothing was extracted', () => {
        const remito: ParsedRemito = {
            data: {},
            errors: [
                'No se pudo identificar el cliente en el remito',
                'No se pudo identificar la dirección en el remito',
                'No se pudo identificar la cantidad de bultos en el remito',
            ],
        };

        const result = formatRemitoReply(remito);

        expect(result).toBe(
            '❌ *No se pudo procesar el remito*\n\n' +
            '   - No se pudo identificar el cliente en el remito\n' +
            '   - No se pudo identificar la dirección en el remito\n' +
            '   - No se pudo identificar la cantidad de bultos en el remito',
        );
        // No data block when nothing was extracted
        expect(result).not.toContain('*Cliente:*');
    });

    // ─── Edge case: packages = 0 ───────────────────────────────────────────────

    it('renders packages as 0 (not —) when packages is explicitly 0', () => {
        const remito: ParsedRemito = {
            data: { clientName: 'ACME', address: 'Calle 1', packages: 0 },
            errors: [],
        };

        const result = formatRemitoReply(remito);
        expect(result).toContain('*Bultos:* 0');
    });
});