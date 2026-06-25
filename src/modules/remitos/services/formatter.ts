import { ParsedRemito } from '../types';

/**
 * Formats a WhatsApp reply for a processed remito image.
 *
 * Success example:
 *   ✅ *Remito guardado*
 *
 *   *Cliente:* ACME S.A.
 *   *Dir:* Av. Corrientes 1234
 *   *Bultos:* 3
 *
 * Partial-error example (some fields extracted, others missing):
 *   ⚠️ *Remito guardado con advertencias*
 *
 *   *Cliente:* ACME S.A.
 *   *Dir:* —
 *   *Bultos:* —
 *   - No se pudo identificar la dirección en el remito
 *   - No se pudo identificar la cantidad de bultos en el remito
 *
 * Full-failure example (nothing extracted):
 *   ❌ *No se pudo procesar el remito*
 *
 *   - No se pudo identificar el cliente en el remito
 *   - No se pudo identificar la dirección en el remito
 *   - No se pudo identificar la cantidad de bultos en el remito
 */
export function formatRemitoReply(remito: ParsedRemito): string {
    const { data, errors } = remito;
    const hasAnyData = data.clientName !== undefined || data.address !== undefined || data.packages !== undefined;

    // Decide header
    let header: string;
    if (errors.length === 0) {
        header = '✅ *Remito guardado*';
    } else if (hasAnyData) {
        header = '⚠️ *Remito guardado con advertencias*';
    } else {
        header = '❌ *No se pudo procesar el remito*';
    }

    const lines: string[] = [header];

    // Data block — only shown when at least one field was extracted
    if (hasAnyData) {
        lines.push('');
        lines.push(`*Cliente:* ${data.clientName ?? '—'}`);
        lines.push(`*Dir:* ${data.address ?? '—'}`);
        lines.push(`*Bultos:* ${data.packages !== undefined ? String(data.packages) : '—'}`);
    }

    // Error list
    if (errors.length > 0) {
        lines.push('');
        for (const error of errors) {
            lines.push(`   - ${error}`);
        }
    }

    return lines.join('\n');
}