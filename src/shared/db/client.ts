import { PrismaClient } from '@prisma/client';

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
    } else {
        console.log(`[Storage] Client not found by name or alias: "${name}"`);
    }

    return null;
}

function normalise(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}