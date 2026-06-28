import { parseRemitoText, hasErrors } from './parser';

describe('parseRemitoText', () => {
    // ─── Happy path ────────────────────────────────────────────────────────────

    it('parses a well-formed Gemini response with all three fields', () => {
        const raw = 'Cliente: ACME S.A.\nDir: Av. Corrientes 1234\nBultos: 3';
        const result = parseRemitoText(raw);

        expect(result.errors).toHaveLength(0);
        expect(result.data).toEqual({
            clientName: 'ACME S.A.',
            address:    'Av. Corrientes 1234',
            packages:   3,
        });
    });

    it('is case-insensitive for field labels', () => {
        const raw = 'CLIENTE: ACME\nDIR: Calle Falsa 123\nBULTOS: 5';
        const result = parseRemitoText(raw);

        expect(result.errors).toHaveLength(0);
        expect(result.data.clientName).toBe('ACME');
        expect(result.data.packages).toBe(5);
    });

    it('tolerates extra whitespace around values', () => {
        const raw = 'Cliente:   Distribuidora Norte   \nDir:  Ruta 8 km 34  \nBultos: 2';
        const result = parseRemitoText(raw);

        expect(result.data.clientName).toBe('Distribuidora Norte');
        expect(result.data.address).toBe('Ruta 8 km 34');
    });

    it('tolerates extra blank lines and unrecognised lines from Gemini', () => {
        const raw = 'Cliente: ACME\n\nAlgo extra que Gemini escribió\n\nDir: Calle 1\nBultos: 1';
        const result = parseRemitoText(raw);

        // Extra line should not crash, only the recognised fields matter
        expect(result.data.clientName).toBe('ACME');
        expect(result.data.address).toBe('Calle 1');
        expect(result.data.packages).toBe(1);
    });

    // ─── Partial extraction ────────────────────────────────────────────────────

    it('records an error when the client field is missing', () => {
        const raw = 'Dir: Av. Corrientes 1234\nBultos: 3';
        const result = parseRemitoText(raw);

        expect(result.errors).toContain('No se pudo identificar el cliente en el remito');
        expect(result.data.clientName).toBeUndefined();
        expect(result.data.address).toBe('Av. Corrientes 1234');
        expect(result.data.packages).toBe(3);
    });

    it('records an error when the address field is missing', () => {
        const raw = 'Cliente: ACME\nBultos: 2';
        const result = parseRemitoText(raw);

        expect(result.errors).toContain('No se pudo identificar la dirección en el remito');
        expect(result.data.address).toBeUndefined();
    });

    it('records an error when the packages field is missing', () => {
        const raw = 'Cliente: ACME\nDir: Calle 1';
        const result = parseRemitoText(raw);

        expect(result.errors).toContain('No se pudo identificar la cantidad de bultos en el remito');
        expect(result.data.packages).toBeUndefined();
    });

    it('records an error when packages value is not a number', () => {
        const raw = 'Cliente: ACME\nDir: Calle 1\nBultos: muchos';
        const result = parseRemitoText(raw);

        expect(result.errors).toContain('No se pudo identificar la cantidad de bultos en el remito');
        expect(result.data.packages).toBeUndefined();
    });

    // ─── Full failure ──────────────────────────────────────────────────────────

    it('records all three errors when the response is completely unrecognised', () => {
        const raw = 'No puedo identificar el remito.';
        const result = parseRemitoText(raw);

        expect(result.errors).toHaveLength(3);
        expect(result.data).toEqual({});
    });

    it('records all three errors for an empty response', () => {
        const result = parseRemitoText('');

        expect(result.errors).toHaveLength(3);
        expect(result.data).toEqual({});
    });

    // ─── hasErrors helper ──────────────────────────────────────────────────────

    it('hasErrors returns false for a fully parsed remito', () => {
        const raw = 'Cliente: ACME\nDir: Calle 1\nBultos: 1';
        expect(hasErrors(parseRemitoText(raw))).toBe(false);
    });

    it('hasErrors returns true when any field is missing', () => {
        const raw = 'Cliente: ACME\nBultos: 1';
        expect(hasErrors(parseRemitoText(raw))).toBe(true);
    });
});