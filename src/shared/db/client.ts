import { PrismaClient } from '@prisma/client';

/**
 * Finds a client by their canonical name or any of their aliases.
 * Returns the client id and name, or null if not found.
 */
export async function findClient(prisma: PrismaClient, name: string) {
    console.log(`[Storage] Looking up client by name: "${name}"`);

    const byName = await prisma.client.findUnique({
        where: { name },
        select: { id: true, name: true },
    });
    if (byName) {
        console.log(`[Storage] Client found by name: "${name}" (id: ${byName.id})`);
        return byName;
    }

    console.log(`[Storage] Client not found by name, trying alias: "${name}"`);
    const byAlias = await prisma.alias.findUnique({
        where: { alias: name },
        select: { client: { select: { id: true, name: true } } },
    });

    const client = byAlias?.client ?? null;
    if (client) {
        console.log(`[Storage] Client found by alias: "${name}" → "${client.name}" (id: ${client.id})`);
    } else {
        console.log(`[Storage] Client not found by name or alias: "${name}"`);
    }
    return client;
}