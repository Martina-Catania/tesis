import { PrismaClient, Prisma } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PackageInput {
    length: number;
    width: number;
    height: number;
    quantity: number;
}

export interface DeliveryInput {
    clientId: number;
    date: Date;
    periodId?: number;
    packages: PackageInput[];
}

export interface DeliveryErrorInput {
    rawMessage: string;
    date: Date;
    clientName?: string;
    clientId?: number;
    packages?: PackageInput[];
    errors: string[];
}

// ─── Client lookup ───────────────────────────────────────────────────────────

/**
 * Finds a client by their canonical name or any of their aliases.
 * Returns the client id and name, or null if not found.
 */
export async function findClient(prisma: PrismaClient, name: string) {
    const byName = await prisma.client.findUnique({
        where: { name },
        select: { id: true, name: true },
    });
    if (byName) return byName;

    const byAlias = await prisma.alias.findUnique({
        where: { alias: name },
        select: { client: { select: { id: true, name: true } } },
    });
    return byAlias?.client ?? null;
}

// ─── Tariff period lookup ─────────────────────────────────────────────────────

/**
 * Returns the tariff period that was active on a given date,
 * i.e. the period with the latest validFrom that is still <= the delivery date.
 */
export async function findActiveTariffPeriod(prisma: PrismaClient, date: Date) {
    return prisma.tariffPeriod.findFirst({
        where: { validFrom: { lte: date } },
        orderBy: { validFrom: 'desc' },
        select: { id: true, label: true, validFrom: true },
    });
}

// ─── Save delivery ────────────────────────────────────────────────────────────

/**
 * Persists a parsed delivery and its packages in a single transaction.
 * Computes volume for each package before writing.
 */
export async function saveDelivery(prisma: PrismaClient, input: DeliveryInput) {
    return prisma.delivery.create({
        data: {
            clientId: input.clientId,
            date:     input.date,
            periodId: input.periodId ?? null,
            packages: {
                create: input.packages.map((p) => ({
                    length:   p.length,
                    width:    p.width,
                    height:   p.height,
                    quantity: p.quantity,
                    volume:   p.length * p.width * p.height,
                })),
            },
        },
        include: { packages: true },
    });
}

// ─── Save delivery error ──────────────────────────────────────────────────────

/**
 * Persists a delivery message that could not be fully parsed.
 * Stores whatever context was available at the time of the error.
 */
export async function saveDeliveryError(prisma: PrismaClient, input: DeliveryErrorInput) {
    return prisma.deliveryError.create({
        data: {
            rawMessage: input.rawMessage,
            date:       input.date,
            clientName: input.clientName ?? null,
            clientId:   input.clientId   ?? null,
            packages:   input.packages   ?? null,
            errors:     input.errors,
        },
    });
}