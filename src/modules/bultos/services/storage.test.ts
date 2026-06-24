import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import {
    findClient,
    findActiveTariffPeriod,
    saveDelivery,
    saveDeliveryError,
    PackageInput,
} from './storage';

// ─── Setup ───────────────────────────────────────────────────────────────────

const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
    mockReset(prismaMock);
});

// ─── Mock Data ────────────────────────────────────────────────────────────────

const mockClient = { id: 1, name: 'Supermercado Norte' };

const mockPeriod = {
    id: 2,
    label: 'Mayo 2026',
    validFrom: new Date('2026-05-12'),
};

const mockPackages: PackageInput[] = [
    { length: 10, width: 20, height: 30, quantity: 2 },
    { length: 5,  width: 5,  height: 5,  quantity: 1 },
];

const deliveryDate = new Date('2026-05-20');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('findClient', () => {
    it('returns the client when found by name', async () => {
        prismaMock.client.findUnique.mockResolvedValue(mockClient);

        const result = await findClient(prismaMock, 'Supermercado Norte');

        expect(result).toEqual(mockClient);
        expect(prismaMock.client.findUnique).toHaveBeenCalledWith({
            where: { name: 'Supermercado Norte' },
            select: { id: true, name: true },
        });
    });

    it('falls back to alias lookup when name is not found', async () => {
        prismaMock.client.findUnique.mockResolvedValue(null);
        prismaMock.alias.findUnique.mockResolvedValue({ client: mockClient } as any);

        const result = await findClient(prismaMock, 'Supermercado N.');

        expect(result).toEqual(mockClient);
        expect(prismaMock.alias.findUnique).toHaveBeenCalledWith({
            where: { alias: 'Supermercado N.' },
            select: { client: { select: { id: true, name: true } } },
        });
    });

    it('returns null when neither name nor alias is found', async () => {
        prismaMock.client.findUnique.mockResolvedValue(null);
        prismaMock.alias.findUnique.mockResolvedValue(null);

        const result = await findClient(prismaMock, 'Desconocido');

        expect(result).toBeNull();
    });
});

describe('findActiveTariffPeriod', () => {
    it('returns the most recent period whose validFrom is on or before the delivery date', async () => {
        prismaMock.tariffPeriod.findFirst.mockResolvedValue(mockPeriod);

        const result = await findActiveTariffPeriod(prismaMock, deliveryDate);

        expect(result).toEqual(mockPeriod);
        expect(prismaMock.tariffPeriod.findFirst).toHaveBeenCalledWith({
            where: { validFrom: { lte: deliveryDate } },
            orderBy: { validFrom: 'desc' },
            select: { id: true, label: true, validFrom: true },
        });
    });

    it('returns null when no period has started yet', async () => {
        prismaMock.tariffPeriod.findFirst.mockResolvedValue(null);

        const result = await findActiveTariffPeriod(prismaMock, new Date('2020-01-01'));

        expect(result).toBeNull();
    });
});

describe('saveDelivery', () => {
    const mockSavedDelivery = {
        id: 10,
        clientId: mockClient.id,
        date: deliveryDate,
        periodId: mockPeriod.id,
        packages: [
            { id: 1, deliveryId: 10, length: 10, width: 20, height: 30, quantity: 2, volume: 6000 },
            { id: 2, deliveryId: 10, length: 5,  width: 5,  height: 5,  quantity: 1, volume: 125  },
        ],
    };

    it('creates a delivery with computed volumes for each package', async () => {
        prismaMock.delivery.create.mockResolvedValue(mockSavedDelivery);

        const result = await saveDelivery(prismaMock, {
            clientId: mockClient.id,
            date:     deliveryDate,
            periodId: mockPeriod.id,
            packages: mockPackages,
        });

        expect(result).toEqual(mockSavedDelivery);
        expect(prismaMock.delivery.create).toHaveBeenCalledWith({
            data: {
                clientId: mockClient.id,
                date:     deliveryDate,
                periodId: mockPeriod.id,
                packages: {
                    create: [
                        { length: 10, width: 20, height: 30, quantity: 2, volume: 6000 },
                        { length: 5,  width: 5,  height: 5,  quantity: 1, volume: 125  },
                    ],
                },
            },
            include: { packages: true },
        });
    });

    it('sets periodId to null when not provided', async () => {
        prismaMock.delivery.create.mockResolvedValue({ ...mockSavedDelivery, periodId: null });

        await saveDelivery(prismaMock, {
            clientId: mockClient.id,
            date:     deliveryDate,
            packages: mockPackages,
        });

        expect(prismaMock.delivery.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ periodId: null }),
            })
        );
    });
});

describe('saveDeliveryError', () => {
    const rawMessage = 'Cliente Invalido\n10x20x30x5';
    const mockSavedError = {
        id: 99,
        createdAt: new Date(),
        date: deliveryDate,
        rawMessage,
        clientName: 'Cliente Invalido',
        clientId: null,
        packages: null,
        errors: ['Cliente no encontrado en la base de datos', 'Medición inválida: "10x20x30x5"'],
    };

    it('saves a delivery error with all available context', async () => {
        prismaMock.deliveryError.create.mockResolvedValue(mockSavedError);

        const result = await saveDeliveryError(prismaMock, {
            rawMessage,
            date:       deliveryDate,
            clientName: 'Cliente Invalido',
            errors:     ['Cliente no encontrado en la base de datos', 'Medición inválida: "10x20x30x5"'],
        });

        expect(result).toEqual(mockSavedError);
        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                rawMessage,
                date:       deliveryDate,
                clientName: 'Cliente Invalido',
                clientId:   null,
                errors:     ['Cliente no encontrado en la base de datos', 'Medición inválida: "10x20x30x5"'],
            }),
        });
    });

    it('saves a delivery error with partial packages when parsing got partway through', async () => {
        const partialPackages: PackageInput[] = [{ length: 10, width: 20, height: 30, quantity: 1 }];
        prismaMock.deliveryError.create.mockResolvedValue({ ...mockSavedError, packages: partialPackages });

        await saveDeliveryError(prismaMock, {
            rawMessage,
            date:       deliveryDate,
            clientName: 'Cliente Invalido',
            packages:   partialPackages,
            errors:     ['Medición inválida: "10x20x30x5"'],
        });

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ packages: partialPackages }),
        });
    });

    it('uses null when no packages are present', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({ ...mockSavedError, packages: null });

        await saveDeliveryError(prismaMock, {
            rawMessage,
            date:   deliveryDate,
            errors: ['No se encontró un cliente válido en el mensaje'],
        });

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ packages: null }),
        });
    });
});