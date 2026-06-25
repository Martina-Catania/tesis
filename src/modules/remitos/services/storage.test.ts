import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { saveRemito, saveRemitoError } from './storage';

// ─── Setup ───────────────────────────────────────────────────────────────────

const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReset(prismaMock);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── Mock Data ────────────────────────────────────────────────────────────────

const remitoDate  = new Date('2026-05-20');
const rawText     = 'Cliente: ACME S.A.\nDir: Av. Corrientes 1234\nBultos: 3';

const mockRemito = {
    id:         1,
    createdAt:  new Date(),
    date:       remitoDate,
    rawText,
    clientName: 'ACME S.A.',
    address:    'Av. Corrientes 1234',
    packages:   3,
    clientId:   null,
    confirmed:  false,
};

const mockRemitoError = {
    id:         99,
    createdAt:  new Date(),
    date:       remitoDate,
    rawText:    'texto irreconocible',
    clientName: null,
    address:    null,
    packages:   null,
    errors:     ['No se pudo identificar el cliente en el remito'],
};

// ─── saveRemito ────────────────────────────────────────────────────────────────

describe('saveRemito', () => {
    it('creates a remito with all extracted fields', async () => {
        prismaMock.remito.create.mockResolvedValue(mockRemito);

        const result = await saveRemito(prismaMock, {
            date:       remitoDate,
            rawText,
            clientName: 'ACME S.A.',
            address:    'Av. Corrientes 1234',
            packages:   3,
        });

        expect(result).toEqual(mockRemito);
        expect(prismaMock.remito.create).toHaveBeenCalledWith({
            data: {
                date:       remitoDate,
                rawText,
                clientName: 'ACME S.A.',
                address:    'Av. Corrientes 1234',
                packages:   3,
                clientId:   null,
                confirmed:  false,
            },
        });
    });

    it('sets optional fields to null when not provided', async () => {
        prismaMock.remito.create.mockResolvedValue({
            ...mockRemito,
            clientName: null,
            address:    null,
            packages:   null,
        });

        await saveRemito(prismaMock, { date: remitoDate, rawText });

        expect(prismaMock.remito.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                clientName: null,
                address:    null,
                packages:   null,
                clientId:   null,
            }),
        });
    });

    it('sets confirmed to false on creation', async () => {
        prismaMock.remito.create.mockResolvedValue(mockRemito);

        await saveRemito(prismaMock, { date: remitoDate, rawText });

        expect(prismaMock.remito.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ confirmed: false }),
            }),
        );
    });

    it('stores a pre-resolved clientId when provided', async () => {
        prismaMock.remito.create.mockResolvedValue({ ...mockRemito, clientId: 7 });

        await saveRemito(prismaMock, { date: remitoDate, rawText, clientId: 7 });

        expect(prismaMock.remito.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ clientId: 7 }),
            }),
        );
    });
});

// ─── saveRemitoError ───────────────────────────────────────────────────────────

describe('saveRemitoError', () => {
    it('saves a remito error with all available context', async () => {
        prismaMock.remitoError.create.mockResolvedValue(mockRemitoError);

        const result = await saveRemitoError(prismaMock, {
            date:   remitoDate,
            rawText: 'texto irreconocible',
            errors: ['No se pudo identificar el cliente en el remito'],
        });

        expect(result).toEqual(mockRemitoError);
        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                date:       remitoDate,
                rawText:    'texto irreconocible',
                clientName: null,
                address:    null,
                packages:   null,
                errors:     ['No se pudo identificar el cliente en el remito'],
            }),
        });
    });

    it('saves partial data when some fields were extracted before the error', async () => {
        prismaMock.remitoError.create.mockResolvedValue({
            ...mockRemitoError,
            clientName: 'ACME S.A.',
            packages:   2,
        });

        await saveRemitoError(prismaMock, {
            date:       remitoDate,
            rawText:    'Cliente: ACME S.A.\nBultos: 2',
            clientName: 'ACME S.A.',
            packages:   2,
            errors:     ['No se pudo identificar la dirección en el remito'],
        });

        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                clientName: 'ACME S.A.',
                packages:   2,
                address:    null,
            }),
        });
    });

    it('sets rawText to null when the Gemini call itself failed', async () => {
        prismaMock.remitoError.create.mockResolvedValue({ ...mockRemitoError, rawText: null });

        await saveRemitoError(prismaMock, {
            date:   remitoDate,
            errors: ['No se pudo identificar el cliente en el remito'],
        });

        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ rawText: null }),
        });
    });
});