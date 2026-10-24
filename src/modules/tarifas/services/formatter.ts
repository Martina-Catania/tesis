import { TariffUpload } from './parser';
import { SaveTariffResult } from './storage';
import { AddressZone } from '../../admin/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZONE_LABEL: Record<AddressZone, string> = {
    CABA:   'CABA',
    AMBA_1: 'AMBA 1',
    AMBA_2: 'AMBA 2',
    AMBA_3: 'AMBA 3',
};

function fmtPrice(n: number): string {
    // Format as Argentine peso without decimals, with dot thousands separator
    return '$ ' + Math.round(n).toLocaleString('es-AR');
}

function fmtVolume(minM3: number, maxM3: number | null, perM3: boolean): string {
    if (perM3 || maxM3 === null) return `Más de ${minM3} m³ (por m³)`;
    if (minM3 === 0)             return `Hasta ${maxM3} m³`;
    return `${minM3} – ${maxM3} m³`;
}

// ─── Review message ───────────────────────────────────────────────────────────

/**
 * Builds the confirmation message shown to the admin before the tariff is saved.
 * Keeps it compact — WhatsApp has limited width.
 */
export function formatTariffReviewMessage(upload: TariffUpload): string {
    const dateStr = upload.validFrom.toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const lines: string[] = [
        `📋 *Revisá las nuevas tarifas*`,
        '',
        `*Período:* ${upload.label}`,
        `*Vigente desde:* ${dateStr}`,
        '',
        `*Tramos (CABA / AMBA 1 / AMBA 2 / AMBA 3):*`,
    ];

    for (const b of upload.brackets) {
        const vol = fmtVolume(b.volumeMinM3, b.volumeMaxM3, b.perM3);
        const prices = (['CABA', 'AMBA_1', 'AMBA_2', 'AMBA_3'] as AddressZone[])
            .map(z => fmtPrice(b.prices[z]))
            .join(' / ');
        lines.push(`   _${vol}_`);
        lines.push(`   ${prices}`);
    }

    if (upload.hourlyRateCaba !== null) {
        lines.push('');
        lines.push(`*Hora (CABA):* ${fmtPrice(upload.hourlyRateCaba)}`);
    }

    lines.push('');
    lines.push('¿Guardás estas tarifas?');

    return lines.join('\n');
}

// ─── Success message ──────────────────────────────────────────────────────────

export function formatTariffSuccessMessage(result: SaveTariffResult): string {
    const action = result.wasUpdate ? 'actualizadas' : 'guardadas';
    return (
        `✅ *Tarifas ${action}*\n\n` +
        `*Período:* ${result.label}\n` +
        `*Tramos guardados:* ${result.ratesCreated}\n` +
        (result.wasUpdate
            ? '_Las tarifas anteriores de este período fueron reemplazadas._'
            : '_Nuevo período creado._')
    );
}

// ─── Parse-error message ──────────────────────────────────────────────────────

export function formatTariffParseErrorMessage(errors: string[]): string {
    const errorList = errors.map(e => `   - ${e}`).join('\n');
    return (
        `⚠️ *No se pudo procesar el archivo de tarifas*\n\n` +
        `Corregí los siguientes problemas y volvé a enviarlo:\n\n` +
        errorList
    );
}