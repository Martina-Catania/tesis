import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { saveRemito, saveRemitoError, findMatchingAddress } from './storage';

// ─── Setup ───────────────────────────────────────────────────────────────────

const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
    mockReset(prismaMock);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── Mock Data ────────────────────────────────────────────────────────────────

const remitoDate = new Date('2026-05-20');
const rawText = 'Cliente: ACME S.A.\nDir: Av. Corrientes 1234\nBultos: 3';

const mockRemito = {
    id: 1,
    createdAt: new Date(),
    date: remitoDate,
    rawText,
    clientName: 'ACME S.A.',
    address: 'Av. Corrientes 1234',
    packages: 3,
    clientId: null,
    addressId: null,
    confirmed: false,
};

const mockRemitoError = {
    id: 99,
    createdAt: new Date(),
    date: remitoDate,
    rawText: 'texto irreconocible',
    clientName: null,
    address: null,
    packages: null,
    errors: ['No se pudo identificar el cliente en el remito'],
};

// ─── saveRemito ────────────────────────────────────────────────────────────────

describe('saveRemito', () => {
    it('creates a remito with all extracted fields', async () => {
        prismaMock.remito.create.mockResolvedValue(mockRemito);

        const result = await saveRemito(prismaMock, {
            date: remitoDate,
            rawText,
            clientName: 'ACME S.A.',
            address: 'Av. Corrientes 1234',
            packages: 3,
        });

        expect(result).toEqual(mockRemito);
        expect(prismaMock.remito.create).toHaveBeenCalledWith({
            data: {
                date: remitoDate,
                rawText,
                clientName: 'ACME S.A.',
                address: 'Av. Corrientes 1234',
                packages: 3,
                clientId: null,
                addressId: null,
                confirmed: false,
            },
        });
    });

    it('sets optional fields to null when not provided', async () => {
        prismaMock.remito.create.mockResolvedValue({
            ...mockRemito,
            clientName: null,
            address: null,
            packages: null,
        });

        await saveRemito(prismaMock, { date: remitoDate, rawText });

        expect(prismaMock.remito.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                clientName: null,
                address: null,
                packages: null,
                clientId: null,
                addressId: null,
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

    it('stores a pre-resolved clientId and addressId when provided', async () => {
        prismaMock.remito.create.mockResolvedValue({ ...mockRemito, clientId: 7, addressId: 42 });

        await saveRemito(prismaMock, { date: remitoDate, rawText, clientId: 7, addressId: 42 });

        expect(prismaMock.remito.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ clientId: 7, addressId: 42 }),
            }),
        );
    });
});

// ─── saveRemitoError ───────────────────────────────────────────────────────────

describe('saveRemitoError', () => {
    it('saves a remito error with all available context', async () => {
        prismaMock.remitoError.create.mockResolvedValue(mockRemitoError);

        const result = await saveRemitoError(prismaMock, {
            date: remitoDate,
            rawText: 'texto irreconocible',
            errors: ['No se pudo identificar el cliente en el remito'],
        });

        expect(result).toEqual(mockRemitoError);
        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                date: remitoDate,
                rawText: 'texto irreconocible',
                clientName: null,
                address: null,
                packages: null,
                errors: ['No se pudo identificar el cliente en el remito'],
            }),
        });
    });

    it('saves partial data when some fields were extracted before the error', async () => {
        prismaMock.remitoError.create.mockResolvedValue({
            ...mockRemitoError,
            clientName: 'ACME S.A.',
            packages: 2,
        });

        await saveRemitoError(prismaMock, {
            date: remitoDate,
            rawText: 'Cliente: ACME S.A.\nBultos: 2',
            clientName: 'ACME S.A.',
            packages: 2,
            errors: ['No se pudo identificar la dirección en el remito'],
        });

        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                clientName: 'ACME S.A.',
                packages: 2,
                address: null,
            }),
        });
    });

    it('sets rawText to null when the Gemini call itself failed', async () => {
        prismaMock.remitoError.create.mockResolvedValue({ ...mockRemitoError, rawText: null });

        await saveRemitoError(prismaMock, {
            date: remitoDate,
            errors: ['No se pudo identificar el cliente en el remito'],
        });

        expect(prismaMock.remitoError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ rawText: null }),
        });
    });
});

// ─── findMatchingAddress ───────────────────────────────────────────────────────

describe('findMatchingAddress', () => {
    const CLIENT_ID = 1;

    function mockAddresses(...addresses: Array<{ id: number; address: string }>) {
        prismaMock.address.findMany.mockResolvedValue(
            addresses.map((a) => ({ ...a, clientId: CLIENT_ID, zone: 'CABA' as any, active: true })),
        );
    }

    // ─── Exact / near-exact matches ─────────────────────────────────────────

    it('matches an identical address', async () => {
        mockAddresses({ id: 10, address: 'Av. Corrientes 1234' });

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1234');

        expect(result.matched).toBe(true);
        if (result.matched) {
            expect(result.addressId).toBe(10);
        }
    });

    it('matches despite different casing', async () => {
        mockAddresses({ id: 10, address: 'Av. Corrientes 1234' });

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'av. corrientes 1234');

        expect(result.matched).toBe(true);
    });

    it('matches after expanding the "Av." abbreviation', async () => {
        mockAddresses({ id: 10, address: 'Avenida Corrientes 1234' });

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1234');

        expect(result.matched).toBe(true);
    });

    it('matches despite accent differences (e.g. OCR dropping accents)', async () => {
        mockAddresses({ id: 10, address: 'Córdoba 567' });

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Cordoba 567');

        expect(result.matched).toBe(true);
    });

    it('matches with minor OCR noise (one character off)', async () => {
        mockAddresses({ id: 10, address: 'Av. Corrientes 1234' });

        // Single substitution: '1234' → '1235'
        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1235');

        expect(result.matched).toBe(true);
    });

    it('returns the best match when there are multiple addresses', async () => {
        mockAddresses(
            { id: 10, address: 'Av. Corrientes 1234' },
            { id: 11, address: 'Calle Falsa 742' },
        );

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1234');

        expect(result.matched).toBe(true);
        if (result.matched) {
            expect(result.addressId).toBe(10);
        }
    });

    // ─── No match ────────────────────────────────────────────────────────────

    it('returns matched: false for a completely different address', async () => {
        mockAddresses({ id: 10, address: 'Av. Corrientes 1234' });

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Belgrano 9999');

        expect(result.matched).toBe(false);
    });

    it('returns matched: false when the client has no active addresses', async () => {
        prismaMock.address.findMany.mockResolvedValue([]);

        const result = await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1234');

        expect(result.matched).toBe(false);
    });

    it('queries only active addresses for the given client', async () => {
        prismaMock.address.findMany.mockResolvedValue([]);

        await findMatchingAddress(prismaMock, CLIENT_ID, 'Av. Corrientes 1234');

        expect(prismaMock.address.findMany).toHaveBeenCalledWith({
            where: { clientId: CLIENT_ID, active: true },
            select: { id: true, address: true },
        });
    });
});