import { parseDeliveryMessage } from './parser';

/**
 * parser returns a json object of clients and the measurements of the packages they are sending.
 */

describe('Client parsing', () => {
    // Drivers include the client name in the line before the measurements
    // The parser should check if it is a valid client name before appending the measurements to the deliveries array
    it('should append measurements for valid client names', () => {
        const message = "Cliente Valido\n10x20x30 10";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ]
            }]
        );
    });

    it('should append measurements to the last valid client name', () => {
        const message = "Cliente Valido\n10x20x30 10\nCliente Valido 2\n5x5x5 2";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ]
            },
            {
                client: "Cliente Valido 2", packages: [
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ]
            }
        ]);
    });

    it('should add an error message for invalid client names', () => {
        const message = "Cliente Valido\n10x20x30 10\nCliente Invalido\n5x5x5 2";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                ]
            },
            {
                client: "Cliente Invalido", packages: [
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ], error: "Cliente no encontrado en la base de datos"
            }
        ]);
    });

    it('should add an error message for messages without client names', () => {
        const message = "10x20x30 10\n5x5x5 2";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Desconocido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                    { length: 5, width: 5, height: 5, quantity: 2 }
                ], error: "No se encontró un cliente válido en el mensaje"
            }
        ]);
    });

});

describe('Format parsing', () => {
    // There are three possible formats drivers use to send package measurements
    // 1. "LxWxH" (e.g. "10x20x30") - Qty is assumed to be 1
    // 2. "QtyxLxWxH (e.g. "10 10x20x30")
    // 3. "LxWxH Qty" (e.g. "10x20x30 10")
    // All three formats should be parsed correctly because drivers are inconsistent
    it('should parse measurements in "LxWxH" format', () => {
        const message = "Cliente Valido\n10x20x30";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 1 }]
            },
            ]
        );
    });

    it('should parse measurements in "QtyxLxWxH" format', () => {
        const message = "Cliente Valido\n10 10x20x30";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }]
            }],
        );
    });

    it('should parse measurements in "LxWxH Qty" format', () => {
        const message = "Cliente Valido\n10x20x30 10";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual(
            [{
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 }]
            }],
        );
    });

    it('should parse multiple measurements in a single message', () => {
        const message = "Cliente Valido\n10x20x30 10\n5x5x5 2";
        const deliveries = parseDeliveryMessage(message);
        expect(deliveries).toEqual([
            {
                client: "Cliente Valido", packages: [
                    { length: 10, width: 20, height: 30, quantity: 10 },
                    { length: 5, width: 5, height: 5, quantity: 2 },
                ]
            }
        ]);
    });
});

describe('Date parsing', () => {
    // Sometimes drivers send the day of the week alongside the clients and measurements
    // If present the parser should add the date to the delivery object, if not it should add the current date
    // E.g. "Lunes\nCliente Valido\n10x20x30 10" means the whole message should be associated with the date of the last Monday/current date if today is Monday

});