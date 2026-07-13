import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { parseDeliveryMessage } from './parser';

/**
 * parser returns an object with a date and a list of deliveries with client names,
 * package measurements, and any errors encountered during parsing.
 */

// ─── Setup ───────────────────────────────────────────────────────────────────

const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
    mockReset(prismaMock);
    // Default: no clients in DB. Tests that need specific clients call
    // mockValidClients(...names) again to override this.
    mockValidClients();
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Makes prismaMock behave as if the given names are valid clients in the DB.
// findClient now calls prisma.client.findMany and resolves names in JS,
// so we mock findMany to return a list of client rows with empty aliases.
function mockValidClients(...names: string[]) {
    prismaMock.client.findMany.mockResolvedValue(
        names.map((name, i) => ({ id: i + 1, name, aliases: [] })),
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Client parsing', () => {
    it('should append measurements for valid client names', async () => {
        mockValidClients('Cliente Valido');
        const message = "Cliente Valido\n10x20x30 10";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ], errors: []
            }]
        );
    });

    it('should append measurements to the last valid client name', async () => {
        mockValidClients('Cliente Valido', 'Cliente Valido 2');
        const message = "Cliente Valido\n10x20x30 10\nCliente Valido 2\n5x5x5 2";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ], errors: []
            },
            {
                client: "Cliente Valido 2", packages: [
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ], errors: []
            }
        ]);
    });

    it('should add an error message for invalid client names', async () => {
        mockValidClients('Cliente Valido'); // 'Cliente Invalido' not in DB
        const message = "Cliente Valido\n10x20x30 10\nCliente Invalido\n5x5x5 2";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ], errors: []
            },
            {
                client: "Cliente Invalido", packages: [
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ], errors: ["Cliente no encontrado en la base de datos"]
            }
        ]);
    });

    it('should add an error message for messages without client names', async () => {
        mockValidClients(); // no valid clients
        const message = "10x20x30 10\n5x5x5 2";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Desconocido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ], errors: ["No se encontró un cliente válido en el mensaje"]
            }
        ]);
    });
});

describe('Format parsing', () => {
    beforeEach(() => mockValidClients('Cliente Valido'));

    it('should parse measurements in "LxWxH" format', async () => {
        const message = "Cliente Valido\n10x20x30";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 1 }],
                errors: []
            }]
        );
    });

    it('should parse measurements in "QtyxLxWxH" format', async () => {
        const message = "Cliente Valido\n10 10x20x30";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }],
                errors: []
            }]
        );
    });

    it('should parse measurements in "LxWxH Qty" format', async () => {
        const message = "Cliente Valido\n10x20x30 10";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }],
                errors: []
            }]
        );
    });

    it('should parse multiple measurements in a single message', async () => {
        const message = "Cliente Valido\n10x20x30 10\n5x5x5 2";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                    { length: 5, width: 5, height: 5, quantity: 2 },
                ], errors: []
            }
        ]);
    });

    it('should add an error message for invalid measurements', async () => {
        const message = "Cliente Valido\n10x20x30x10x10";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [], errors: ["Medición inválida: \"10x20x30x10x10\""]
            }
        ]);
    });
});

describe('Date parsing', () => {
    beforeEach(() => mockValidClients('Cliente Valido'));

    it('should attach the current date if none is provided', async () => {
        const before = new Date();
        before.setMilliseconds(0);
        const message = "Cliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const after = new Date();
        after.setMilliseconds(0);
        expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should parse a date in "DD/MM" format', async () => {
        const message = "05/06\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        expect(date.getDate()).toBe(5);
        expect(date.getMonth()).toBe(5); // 0-indexed
        expect(date.getFullYear()).toBe(new Date().getFullYear());
    });

    it('should parse a date in "DD/MM/YYYY" format', async () => {
        const message = "05/06/2025\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        expect(date.getDate()).toBe(5);
        expect(date.getMonth()).toBe(5); // 0-indexed
        expect(date.getFullYear()).toBe(2025);
    });

    it('should ignore an invalid date and fall back to current date', async () => {
        const before = new Date();
        before.setMilliseconds(0);
        const message = "31/02/2025\nCliente Valido\n10x10x10"; // Feb 31 doesn't exist
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const after = new Date();
        after.setMilliseconds(0);
        expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
    });
});

describe('Day name parsing', () => {
    beforeEach(() => mockValidClients('Cliente Valido'));

    function lastOccurrenceOfDay(targetDay: number): Date {
        const today = new Date();
        const daysAgo = (today.getDay() - targetDay + 7) % 7;
        const result = new Date(today);
        result.setDate(today.getDate() - daysAgo);
        result.setMilliseconds(0);
        return result;
    }

    it('should resolve "Viernes" to the most recent Friday', async () => {
        const message = "Viernes\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const expected = lastOccurrenceOfDay(5);
        expect(date).toEqual(expected);
    });

    it('should resolve "lunes" (lowercase) to the most recent Monday', async () => {
        const message = "lunes\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const expected = lastOccurrenceOfDay(1);
        expect(date).toEqual(expected);
    });

    it('should resolve "miercoles" (no accent) to the most recent Wednesday', async () => {
        const message = "miercoles\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const expected = lastOccurrenceOfDay(3);
        expect(date).toEqual(expected);
    });

    it('should resolve "miércoles" (with accent) to the most recent Wednesday', async () => {
        const message = "miércoles\nCliente Valido\n10x10x10";
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const expected = lastOccurrenceOfDay(3);
        expect(date).toEqual(expected);
    });

    it('should return today if the day name matches today', async () => {
        const todayName = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date().getDay()];
        const message = `${todayName}\nCliente Valido\n10x10x10`;
        const { date } = await parseDeliveryMessage(prismaMock, message);
        const today = new Date();
        today.setMilliseconds(0);
        expect(date).toEqual(today);
    });
});

describe('Irrelevant message handling', () => {
    it('ignores a plain chat message with no measurements or known structure', async () => {
        mockValidClients();
        const message = "Hiii";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores a greeting with punctuation', async () => {
        mockValidClients();
        const message = "Hola, cómo estás?";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores a message that is only a date', async () => {
        mockValidClients();
        const message = "05/06";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores a message that is only a day name', async () => {
        mockValidClients();
        const message = "Viernes";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores a valid client name with no following measurements', async () => {
        mockValidClients('Cliente Valido');
        const message = "Cliente Valido";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores an unrecognised client name with no following measurements', async () => {
        mockValidClients();
        const message = "Cliente Invalido";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('ignores a blank / whitespace-only message', async () => {
        mockValidClients();
        const message = "   \n  \n  ";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([]);
    });

    it('keeps a delivery with an invalid measurement line (error, but clearly intended)', async () => {
        mockValidClients('Cliente Valido');
        const message = "Cliente Valido\n10x20x30x10x10";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido",
                packages: [],
                errors: ['Medición inválida: "10x20x30x10x10"'],
            },
        ]);
    });

    it('keeps a delivery for an unrecognised client that has valid packages', async () => {
        mockValidClients();
        const message = "Cliente Invalido\n10x20x30";
        const { deliveries } = await parseDeliveryMessage(prismaMock, message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Invalido",
                packages: [{ length: 10, width: 20, height: 30, quantity: 1 }],
                errors: ["Cliente no encontrado en la base de datos"],
            },
        ]);
    });
});