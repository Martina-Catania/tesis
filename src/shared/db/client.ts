import { PrismaClient } from '@prisma/client';
import { AddressZone } from '../../modules/admin/types';

// ─── Normalisation helper ─────────────────────────────────────────────────────

function normalise(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Finds a client by their canonical name or any of their aliases.
 * Returns the client id and name, or null if not found.
 */
export async function findClient(prisma: PrismaClient, name: string) {
    console.log(`[Storage] Looking up client by name: "${name}"`);

    const target = normalise(name);

    const clients: Array<{
        id: number;
        name: string;
        aliases: Array<{ alias: string }>;
    }> = await prisma.client.findMany({
        select: {
            id: true,
            name: true,
            aliases: { select: { alias: true } },
        },
    });

    const byName = clients.find(client => normalise(client.name) === target);
    if (byName) {
        console.log(`[Storage] Client found by name: "${name}" (id: ${byName.id})`);
        return { id: byName.id, name: byName.name };
    }

    console.log(`[Storage] Client not found by name, trying alias: "${name}"`);
    const byAlias = clients.find(client =>
        client.aliases.some(alias => normalise(alias.alias) === target),
    );

    if (byAlias) {
        console.log(`[Storage] Client found by alias: "${name}" → "${byAlias.name}" (id: ${byAlias.id})`);
        return { id: byAlias.id, name: byAlias.name };
    }

    console.log(`[Storage] Client not found by name or alias: "${name}"`);
    return null;
}

// ─── Client CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new client. Throws if a client with the same name already exists.
 */
export async function createClient(
    prisma: PrismaClient,
    name: string,
    aliases: string[] = [],
) {
    console.log(`[Storage] Creating client: "${name}"${aliases.length ? `, aliases: [${aliases.join(', ')}]` : ''}`);

    const client = await prisma.client.create({
        data: {
            name,
            aliases: aliases.length
                ? { create: aliases.map(alias => ({ alias })) }
                : undefined,
        },
        include: { aliases: true },
    });

    console.log(`[Storage] Client created: id ${client.id}`);
    return client;
}

/**
 * Soft-deletes a client by checking whether they have any linked records.
 * If they do, returns { deleted: false, reason } so the caller can warn the user.
 * If not, hard-deletes the client and their aliases.
 *
 * NOTE: Hard-deleting a client with deliveries/remitos would break FK constraints.
 * We intentionally block the deletion in that case — an admin should archive instead.
 */
export async function deleteClient(
    prisma: PrismaClient,
    clientId: number,
): Promise<{ deleted: true } | { deleted: false; reason: string }> {
    console.log(`[Storage] Attempting to delete client id ${clientId}`);

    const [deliveries, remitos, matches] = await Promise.all([
        prisma.measurementData.count({ where: { clientId } }),
        prisma.remito.count({ where: { clientId } }),
        prisma.deliveryMatch.count({ where: { clientId } }),
    ]);

    if (deliveries > 0 || remitos > 0 || matches > 0) {
        const reason =
            `No se puede eliminar: el cliente tiene ${deliveries} entrega(s), ` +
            `${remitos} remito(s) y ${matches} match(es) asociados.`;
        console.log(`[Storage] Client id ${clientId} deletion blocked: ${reason}`);
        return { deleted: false, reason };
    }

    // Safe to delete — remove child rows first so SQLite foreign keys do not block the client delete.
    await prisma.$transaction([
        prisma.alias.deleteMany({ where: { clientId } }),
        prisma.address.deleteMany({ where: { clientId } }),
        prisma.client.delete({ where: { id: clientId } }),
    ]);

    console.log(`[Storage] Client id ${clientId} deleted successfully`);
    return { deleted: true };
}

// ─── Address CRUD ─────────────────────────────────────────────────────────────

/**
 * Creates a new active address for a client.
 * Used both by the admin module and the remitos interactive flow.
 */
export async function createAddress(
    prisma: PrismaClient,
    clientId: number,
    address: string,
    zone: AddressZone,
) {
    console.log(
        `[Storage] Creating address for clientId ${clientId}: "${address}" (zone: ${zone})`,
    );

    const newAddress = await prisma.address.create({
        data: {
            clientId,
            address,
            zone: zone as any, // cast to Prisma Zone enum
            active: true,
        },
    });

    console.log(`[Storage] Address created: id ${newAddress.id}`);
    return newAddress;
}

/**
 * Deactivates an address (soft-delete). Returns false if the address was not
 * found or does not belong to the given client.
 */
export async function deactivateAddress(
    prisma: PrismaClient,
    addressId: number,
    clientId?: number, // optional — used to scope the check
): Promise<{ deactivated: true; address: string } | { deactivated: false; reason: string }> {
    console.log(`[Storage] Deactivating address id ${addressId}`);

    const existing = await prisma.address.findUnique({ where: { id: addressId } });

    if (!existing) {
        return { deactivated: false, reason: `No existe una dirección con id ${addressId}.` };
    }

    if (clientId !== undefined && existing.clientId !== clientId) {
        return {
            deactivated: false,
            reason: `La dirección id ${addressId} no pertenece al cliente indicado.`,
        };
    }

    if (!existing.active) {
        return { deactivated: false, reason: `La dirección id ${addressId} ya estaba inactiva.` };
    }

    await prisma.address.update({
        where: { id: addressId },
        data: { active: false },
    });

    console.log(`[Storage] Address id ${addressId} deactivated`);
    return { deactivated: true, address: existing.address };
}

/**
 * Returns all active addresses for a client, with id, address string, and zone.
 */
export async function listClientAddresses(
    prisma: PrismaClient,
    clientId: number,
) {
    return prisma.address.findMany({
        where: { clientId, active: true },
        select: { id: true, address: true, zone: true },
        orderBy: { id: 'asc' },
    });
}