import { parseDeliveryMessage } from './parser';

/**
 * parser returns an object with a date and a list of deliveries with client names,
 * package measurements, and any errors encountered during parsing.
 */

describe('Client parsing', () => {
    it('should append measurements for valid client names', () => {
        const message = "Cliente Valido\n10x20x30 10";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ], errors: []
            }]
        );
    });

    it('should append measurements to the last valid client name', () => {
        const message = "Cliente Valido\n10x20x30 10\nCliente Valido 2\n5x5x5 2";
        const { deliveries } = parseDeliveryMessage(message);
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

    it('should add an error message for invalid client names', () => {
        const message = "Cliente Valido\n10x20x30 10\nCliente Invalido\n5x5x5 2";
        const { deliveries } = parseDeliveryMessage(message);
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

    it('should add an error message for messages without client names', () => {
        const message = "10x20x30 10\n5x5x5 2";
        const { deliveries } = parseDeliveryMessage(message);
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
    it('should parse measurements in "LxWxH" format', () => {
        const message = "Cliente Valido\n10x20x30";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 1 }],
                errors: []
            }]
        );
    });

    it('should parse measurements in "QtyxLxWxH" format', () => {
        const message = "Cliente Valido\n10 10x20x30";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }],
                errors: []
            }]
        );
    });

    it('should parse measurements in "LxWxH Qty" format', () => {
        const message = "Cliente Valido\n10x20x30 10";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }],
                errors: []
            }]
        );
    });

    it('should parse multiple measurements in a single message', () => {
        const message = "Cliente Valido\n10x20x30 10\n5x5x5 2";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                    { length: 5, width: 5, height: 5, quantity: 2 },
                ], errors: []
            }
        ]);
    });

    it('should add an error message for invalid measurements', () => {
        const message = "Cliente Valido\n10x20x30x10x10";
        const { deliveries } = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [], errors: ["Medición inválida: \"10x20x30x10x10\""]
            }
        ]);
    });
});

describe('Date parsing', () => {
    it('should attach the current date if none is provided', () => {
        const before = new Date();
        const message = "Cliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        const after = new Date();
        expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should parse a date in "DD/MM" format', () => {
        const message = "05/06\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        expect(date.getDate()).toBe(5);
        expect(date.getMonth()).toBe(5); // 0-indexed
        expect(date.getFullYear()).toBe(new Date().getFullYear());
    });

    it('should parse a date in "DD/MM/YYYY" format', () => {
        const message = "05/06/2025\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        expect(date.getDate()).toBe(5);
        expect(date.getMonth()).toBe(5); // 0-indexed
        expect(date.getFullYear()).toBe(2025);
    });

    it('should ignore an invalid date and fall back to current date', () => {
        const before = new Date();
        const message = "31/02/2025\nCliente Valido\n10x10x10"; // Feb 31 doesn't exist
        const { date } = parseDeliveryMessage(message);
        const after = new Date();
        expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
    });
});

describe('Day name parsing', () => {
    // Helper: returns the date of the last occurrence of a given day (0=Sun … 6=Sat),
    // including today if it matches.
    function lastOccurrenceOfDay(targetDay: number): Date {
        const today = new Date();
        const daysAgo = (today.getDay() - targetDay + 7) % 7;
        const result = new Date(today);
        result.setDate(today.getDate() - daysAgo);
        return result;
    }

    it('should resolve "Viernes" to the most recent Friday', () => {
        const message = "Viernes\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        const expected = lastOccurrenceOfDay(5);
        expect(date).toEqual(expected);
    });

    it('should resolve "lunes" (lowercase) to the most recent Monday', () => {
        const message = "lunes\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        const expected = lastOccurrenceOfDay(1);
        expect(date).toEqual(expected);
    });

    it('should resolve "miercoles" (no accent) to the most recent Wednesday', () => {
        const message = "miercoles\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        const expected = lastOccurrenceOfDay(3);
        expect(date).toEqual(expected);
    });

    it('should resolve "miércoles" (with accent) to the most recent Wednesday', () => {
        const message = "miércoles\nCliente Valido\n10x10x10";
        const { date } = parseDeliveryMessage(message);
        const expected = lastOccurrenceOfDay(3);
        expect(date).toEqual(expected);
    });

    it('should return today if the day name matches today', () => {
        const todayName = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date().getDay()];
        const message = `${todayName}\nCliente Valido\n10x10x10`;
        const { date } = parseDeliveryMessage(message);
        const today = new Date();
        expect(date).toEqual(today);
    });
});