import { MatchRunResult, MatchOutcome } from '../types';

// ─── CSV column definitions ───────────────────────────────────────────────────

const HEADERS = [
    'Cliente',
    'Dirección',
    'Zona',
    'Bultos',
    'Vol (m3)',
    'Tarifa',
    'Observaciones',
] as const;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a MatchRunResult into a UTF-8 CSV string suitable for sending as a
 * WhatsApp document attachment.
 *
 * One row per outcome (success or error). Skipped candidates (only one side
 * present) are not included — they simply have no match yet.
 */
export function formatMatchRunCsv(
    result: MatchRunResult,
    options: { includeHeader?: boolean } = {},
): string {
    const rows: string[][] = [];

    if (options.includeHeader !== false) {
        rows.push(Array.from(HEADERS));
    }

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

    const client =
        remito?.clientName ??
        remitoError?.clientName ??
        measurementError?.clientName ??
        String(candidate.clientId);

    const address =
        remito?.address ??
        remitoError?.address ??
        '';

    const zone = remito?.zone ?? '';

    const bultos =
        measurement?.totalPackages ??
        remito?.packages ??
        remitoError?.packages ??
        (measurementError?.packages
            ? measurementError.packages.reduce((sum, pkg) => sum + pkg.quantity, 0)
            : '');

    const volumeM3 = measurement?.volumeM3 ?? '';

    const tarifa = candidate.tariff ?? '';

    const observations =
        outcome.kind === 'error'
            ? outcome.errors.join(' | ')
            : '';

    return [
        client,
        address,
        zone,
        String(bultos),
        formatDecimal(volumeM3),
        formatDecimal(tarifa),
        observations,
    ];
}

function formatDecimal(value: number | string): string {
    if (typeof value === 'string') {
        return value;
    }

    if (!Number.isFinite(value)) {
        return '';
    }

    return value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
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