import { formatDeliveryReply } from './formatter';
import { Delivery } from '../types';

describe('formatDeliveryReply', () => {
    it('returns a warning when no deliveries are provided', () => {
        expect(formatDeliveryReply([])).toBe('⚠️ No se encontraron entregas en el mensaje.');
    });

    it('formats a single successful delivery with one package', () => {
        const deliveries: Delivery[] = [
            {
                client: 'ACME',
                packages: [{ length: 10, width: 20, height: 30, quantity: 1 }],
                errors: [],
            },
        ];

        const result = formatDeliveryReply(deliveries);
        expect(result).toBe('✅ *Guardado correctamente (1)*\n\n*ACME*\n   - 10x20x30');
    });

    it('formats a failed delivery with quantity > 1 and an error', () => {
        const deliveries: Delivery[] = [
            {
                client: 'ACME',
                packages: [{ length: 10, width: 20, height: 30, quantity: 2 }],
                errors: ['Medición inválida'],
            },
        ];

        const result = formatDeliveryReply(deliveries);
        expect(result).toBe('❌ *Con errores (1)*\n\n*ACME*\n   - 2x 10x20x30\n   - Medición inválida');
    });

    it('formats mixed successful and failed deliveries in separate sections', () => {
        const successful: Delivery = {
            client: 'Good',
            packages: [{ length: 1, width: 2, height: 3, quantity: 1 }],
            errors: [],
        };

        const failed: Delivery = {
            client: 'Bad',
            packages: [{ length: 4, width: 5, height: 6, quantity: 3 }],
            errors: ['No existe cliente'],
        };

        const result = formatDeliveryReply([successful, failed]);

        const expected =
            '✅ *Guardado correctamente (1)*\n\n*Good*\n   - 1x2x3\n\n' +
            '❌ *Con errores (1)*\n\n*Bad*\n   - 3x 4x5x6\n   - No existe cliente';

        expect(result).toBe(expected);
    });
});
