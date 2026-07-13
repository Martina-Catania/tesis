import { prisma } from '../../shared/db/prisma';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { runMatchJob } from './services/job';
import { formatMatchRunCsv, formatMatchRunSummary } from './services/formatter';
import { access, appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ─── Config ───────────────────────────────────────────────────────────────────

/** The exact text message that triggers a manual match run. */
const MATCH_TRIGGER = 'match';

// ─── WhatsApp text trigger ────────────────────────────────────────────────────

/**
 * Called from client.ts when a text message is received.
 * Returns true if the message was the "Match" trigger and was handled,
 * false if it should be passed on to other handlers.
 */
export async function handleMatchTrigger(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    if (message.text?.toLowerCase().trim() !== MATCH_TRIGGER) {
        return false;
    }

    console.log(
        `[Matching Controller] "Match" trigger received from ${message.senderPhoneNumber}`,
    );

    // Acknowledge immediately so the driver isn't left waiting
    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        '🔄 Iniciando proceso de match... Los resultados se enviarán al administrador.',
    );

    // Run the job and save results locally (fire-and-forget style so WhatsApp doesn't time out)
    runAndReport({
        phoneNumberId,
        recipientPhoneNumber: message.senderPhoneNumber,
        replyToMessageId: message.id,
    }).catch(err => {
        console.error('[Matching Controller] Match job failed unexpectedly:', err);
    });

    return true;
}

// ─── Scheduled daily run ──────────────────────────────────────────────────────

/**
 * Entry point for the daily scheduled run (cron / task scheduler).
 * Call this from your scheduler — e.g. with node-cron:
 *
 *   cron.schedule('0 6 * * *', () => runDailyMatch());
 *
 * Results are sent to the configured admin WhatsApp number.
 */
export async function runDailyMatch(): Promise<void> {
    console.log('[Matching Controller] Daily match job starting');
    await runAndReport();
}

// ─── Shared run + report logic ────────────────────────────────────────────────

async function runAndReport(notification?: {
    phoneNumberId: string;
    recipientPhoneNumber: string;
    replyToMessageId?: string;
}): Promise<void> {
    try {
        const result = await runMatchJob(prisma);
        const summary = formatMatchRunSummary(result);

        if (result.outcomes.length === 0) {
            const noMatchesMessage = [
                summary,
                '',
                'ℹ️ No hubo registros para matchear en esta corrida. No se generó archivo CSV.',
            ].join('\n');

            if (notification) {
                await GraphApi.sendTextMessage(
                    notification.replyToMessageId,
                    notification.phoneNumberId,
                    notification.recipientPhoneNumber,
                    noMatchesMessage,
                );
            }

            console.log('[Matching Controller] No match outcomes found — CSV generation skipped');
            return;
        }

        // Build the CSV in memory
        const csvContent = formatMatchRunCsv(result);
        const csvRowsOnly = formatMatchRunCsv(result, { includeHeader: false });
        const csvFilePath = await saveCsvToTempFolder(csvContent, csvRowsOnly, result.ranAt);

        console.log('[Matching Controller] Match results saved locally');
        console.log(`[Matching Controller] CSV saved to ${csvFilePath}`);

        if (notification) {
            await GraphApi.sendTextMessage(
                notification.replyToMessageId,
                notification.phoneNumberId,
                notification.recipientPhoneNumber,
                summary,
            );
        }
    } catch (err) {
        console.error('[Matching Controller] Error running match job:', err);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveCsvToTempFolder(csvContent: string, csvRowsOnly: string, ranAt: Date): Promise<string> {
    const tempFolder = resolve(process.cwd(), 'src', 'temp');
    await mkdir(tempFolder, { recursive: true });

    const filename = `match_${toDateFilename(ranAt)}.csv`;
    const filePath = resolve(tempFolder, filename);

    const hasContent = await stat(filePath)
        .then(info => info.size > 0)
        .catch(() => false);

    if (!hasContent) {
        await writeFile(filePath, csvContent, 'utf-8');
        return filePath;
    }

    if (csvRowsOnly.length > 0) {
        await appendFile(filePath, `\n${csvRowsOnly}`, 'utf-8');
    }

    return filePath;
}

function toDateFilename(d: Date): string {
    return d.toISOString().slice(0, 10);
}