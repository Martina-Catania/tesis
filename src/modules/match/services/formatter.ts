import { MatchRunResult, MatchOutcome } from '../types';

// ─── CSV column definitions ───────────────────────────────────────────────────

const HEADERS = [
    'Fecha entrega',
    'Cliente ID',
    'Resultado',
    'Bultos medidos',
    'Bultos remito',
    'ID MeasurementData',
    'ID MeasurementDataError',
    'ID Remito',
    'ID RemitoError',
    'Errores',
] as const;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a MatchRunResult into a UTF-8 CSV string suitable for sending as a
 * WhatsApp document attachment.
 *
 * One row per outcome (success or error). Skipped candidates (only one side
 * present) are not included — they simply have no match yet.
 */
export function formatMatchRunCsv(result: MatchRunResult): string {
    const rows: string[][] = [Array.from(HEADERS)];

    for (const outcome of result.outcomes) {
        rows.push(outcomeToRow(outcome));
    }

    return rows.map(row => row.map(escapeCell).join(',')).join('\n');
}

/**
 * Formats a short WhatsApp text summary to accompany the CSV.
 */
export function formatMatchRunSummary(result: MatchRunResult): string {
    const dateStr = result.ranAt.toLocaleDateString('es-AR', {
        day:   '2-digit',
        month: '2-digit',
        year:  'numeric',
        hour:  '2-digit',
        minute: '2-digit',
    });

    const lines = [
        `📊 *Resultado del match — ${dateStr}*`,
        '',
        `✅ Coincidencias exitosas: ${result.successCount}`,
        `❌ Errores / discrepancias: ${result.errorCount}`,
        `⏳ Sin par todavía: ${result.skippedCount}`,
    ];

    if (result.outcomes.length > 0) {
        lines.push('', '_Se adjunta el detalle en CSV._');
    }

    return lines.join('\n');
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function outcomeToRow(outcome: MatchOutcome): string[] {
    const { candidate } = outcome;
    const { measurement, measurementError, remito, remitoError } = candidate;

    const dateStr = candidate.deliveryDate.toLocaleDateString('es-AR', {
        day:   '2-digit',
        month: '2-digit',
        year:  'numeric',
    });

    const result = outcome.kind === 'success' ? 'OK' : 'ERROR';

    const measuredPackages =
        measurement?.totalPackages ??
        (measurementError?.packages
            ? measurementError.packages.reduce((s, p) => s + p.quantity, 0)
            : '');

    const remitoPackages =
        remito?.packages ?? remitoError?.packages ?? '';

    const errors =
        outcome.kind === 'error'
            ? outcome.errors.join(' | ')
            : '';

    return [
        dateStr,
        String(candidate.clientId),
        result,
        String(measuredPackages),
        String(remitoPackages),
        String(measurement?.id      ?? ''),
        String(measurementError?.id ?? ''),
        String(remito?.id           ?? ''),
        String(remitoError?.id      ?? ''),
        errors,
    ];
}

/** Wraps a cell value in quotes and escapes any internal quotes. */
function escapeCell(value: string): string {
    const escaped = value.replace(/"/g, '""');
    // Quote if the value contains commas, quotes, or newlines
    if (/[,"\n]/.test(escaped)) {
        return `"${escaped}"`;
    }
    return escaped;
}