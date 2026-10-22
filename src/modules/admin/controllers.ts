import { prisma } from '../../shared/db/prisma';
import { Cache, isAdminPhoneNumber } from '../../shared/utils';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import {
    findClient,
    createClient,
    deleteClient,
    createAddress,
    deactivateAddress,
} from '../../shared/db/client';
import { isAdminCommand, parseAdminCommand } from './services/parser';
import {
    formatAdminReviewMessage,
    formatAdminSuccessMessage,
    formatAdminCancelMessage,
    formatAdminParseErrorMessage,
} from './services/formatter';
import { PendingAdminConfirmation, AdminCommand } from './types';

// ─── Cache key ────────────────────────────────────────────────────────────────

function pendingCacheKey(outgoingMessageId: string): string {
    return `admin:pending:${outgoingMessageId}`;
}

// ─── Interactive reply IDs ─────────────────────────────────────────────────────

const REPLY_ID = {
    CONFIRM: 'admin_confirm',
    CANCEL: 'admin_cancel',
} as const;

// ─── Step 1 — Text command handler ────────────────────────────────────────────

/**
 * Called from client.ts when a text message arrives.
 * Returns true if the message was recognised as an admin command (and handled),
 * false if the message should be passed to other handlers.
 */
export async function handleAdminCommand(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    const text = message.text ?? '';

    if (!isAdminCommand(text)) {
        return false;
    }

    if (!isAdminPhoneNumber(message.senderPhoneNumber)) {
        console.warn(
            `[Admin Controller] Rejected admin command from unauthorized number: ${message.senderPhoneNumber}`,
        );
        return true;
    }

    console.log(
        `[Admin Controller] Admin command received from ${message.senderPhoneNumber}: "${text.slice(0, 80)}"`,
    );

    const { command, errors } = parseAdminCommand(text);

    // If required fields are missing, reply with the error list immediately — do not save
    if (errors.length > 0) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            formatAdminParseErrorMessage(errors),
        );
        return true;
    }

    // Send an interactive confirmation message so the user can review before saving
    const reviewText = formatAdminReviewMessage(command);

    const outgoingMessage = await GraphApi.messageWithInteractiveReply(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        reviewText,
        [
            { id: REPLY_ID.CONFIRM, title: '✅ Confirmar' },
            { id: REPLY_ID.CANCEL, title: '❌ Cancelar' },
        ],
    ) as { messages?: Array<{ id: string }> };

    const outgoingMessageId = outgoingMessage?.messages?.[0]?.id;

    if (!outgoingMessageId) {
        console.warn('[Admin Controller] Could not retrieve outgoing message ID; aborting.');
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            '⚠️ Hubo un problema al enviar la confirmación. Por favor, intentá de nuevo.',
        );
        return true;
    }

    const pending: PendingAdminConfirmation = { command };
    await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(pending));

    console.log(
        `[Admin Controller] Review sent; pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
    );

    return true;
}

// ─── Step 2 — Interactive reply handler ───────────────────────────────────────

/**
 * Handles the Confirmar / Cancelar interactive reply from the user.
 * Returns true if this reply was part of an admin flow, false otherwise.
 */
export async function handleAdminInteractiveReply(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    if (!isAdminPhoneNumber(message.senderPhoneNumber)) {
        return false;
    }

    const contextMessageId = message.contextMessageId;
    if (!contextMessageId) return false;

    const cacheKey = pendingCacheKey(contextMessageId);
    const cached = await Cache.get(cacheKey);
    if (!cached) return false;

    let pending: PendingAdminConfirmation;
    try {
        pending = JSON.parse(cached) as PendingAdminConfirmation;
    } catch {
        console.error('[Admin Controller] Failed to parse cached admin pending state');
        return false;
    }

    await Cache.remove(cacheKey);

    const replyId = message.interactiveReplyId;

    if (replyId === REPLY_ID.CANCEL) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            formatAdminCancelMessage(),
        );
        console.log(`[Admin Controller] Admin command cancelled by user`);
        return true;
    }

    if (replyId === REPLY_ID.CONFIRM) {
        await executeCommand(phoneNumberId, message, pending.command);
        return true;
    }

    // Unknown reply — consume silently (we own this context)
    console.warn(`[Admin Controller] Unexpected replyId "${replyId}" for admin pending state`);
    return true;
}

// ─── Command execution ────────────────────────────────────────────────────────

async function executeCommand(
    phoneNumberId: string,
    message: Message,
    command: AdminCommand,
): Promise<void> {
    console.log(
        `[Admin Controller] Executing confirmed command: ${command.kind}`,
    );

    try {
        switch (command.kind) {
            case 'nuevo_cliente':
                await executeNuevoCliente(phoneNumberId, message, command);
                break;
            case 'nueva_direccion':
                await executeNuevaDireccion(phoneNumberId, message, command);
                break;
            case 'baja_cliente':
                await executeBajaCliente(phoneNumberId, message, command);
                break;
            case 'baja_direccion':
                await executeBajaDireccion(phoneNumberId, message, command);
                break;
        }
    } catch (error) {
        console.error('[Admin Controller] Error executing admin command:', error);
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            '❌ Ocurrió un error inesperado al procesar el comando. Revisá los logs.',
        );
    }
}

// ── Nuevo cliente ─────────────────────────────────────────────────────────────

async function executeNuevoCliente(
    phoneNumberId: string,
    message: Message,
    command: Extract<AdminCommand, { kind: 'nuevo_cliente' }>,
): Promise<void> {
    // Guard: check if a client with this name already exists
    const existing = await findClient(prisma, command.name);
    if (existing) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            `⚠️ Ya existe un cliente con el nombre "${existing.name}" (id: ${existing.id}). No se realizaron cambios.`,
        );
        return;
    }

    const created = await createClient(prisma, command.name, command.aliases);

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        formatAdminSuccessMessage(command, `ID asignado: ${created.id}`),
    );
}

// ── Nueva dirección ───────────────────────────────────────────────────────────

async function executeNuevaDireccion(
    phoneNumberId: string,
    message: Message,
    command: Extract<AdminCommand, { kind: 'nueva_direccion' }>,
): Promise<void> {
    // Resolve the client
    const client = await findClient(prisma, command.clientName);
    if (!client) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            `⚠️ No se encontró el cliente "${command.clientName}". Verificá el nombre y volvé a intentar.`,
        );
        return;
    }

    const created = await createAddress(prisma, client.id, command.address, command.zone);

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        formatAdminSuccessMessage(command, `ID de dirección: ${created.id}`),
    );
}

// ── Baja cliente ──────────────────────────────────────────────────────────────

async function executeBajaCliente(
    phoneNumberId: string,
    message: Message,
    command: Extract<AdminCommand, { kind: 'baja_cliente' }>,
): Promise<void> {
    const client = await findClient(prisma, command.name);
    if (!client) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            `⚠️ No se encontró el cliente "${command.name}". Verificá el nombre y volvé a intentar.`,
        );
        return;
    }

    const result = await deleteClient(prisma, client.id);

    if (!result.deleted) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            `⚠️ *No se pudo eliminar el cliente*\n\n${result.reason}`,
        );
        return;
    }

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        formatAdminSuccessMessage(command),
    );
}

// ── Baja dirección ────────────────────────────────────────────────────────────

async function executeBajaDireccion(
    phoneNumberId: string,
    message: Message,
    command: Extract<AdminCommand, { kind: 'baja_direccion' }>,
): Promise<void> {
    const result = await deactivateAddress(prisma, command.addressId);

    if (!result.deactivated) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            `⚠️ *No se pudo desactivar la dirección*\n\n${result.reason}`,
        );
        return;
    }

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        formatAdminSuccessMessage(command, result.address),
    );
}