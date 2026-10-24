import { AddressZone } from '../../admin/types';

// ─── Output types ─────────────────────────────────────────────────────────────

export interface TariffBracket {
    volumeMinM3: number;
    volumeMaxM3: number | null; // null → no upper bound (per-m3 row)
    perM3: boolean;
    prices: Record<AddressZone, number>;
}

export interface TariffUpload {
    label: string;
    validFrom: Date;
    brackets: TariffBracket[];
    hourlyRateCaba: number | null;
}

export interface ParsedTariffCsv {
    data: TariffUpload | null;
    errors: string[];
}

// ─── Volume-bracket definitions ───────────────────────────────────────────────
// These map the human-readable row labels to numeric min/max bounds.

interface BracketDef {
    minM3: number;
    maxM3: number | null;
    perM3: boolean;
    keywords: string[]; // lower-case, accent-stripped fragments to match the row
}

const BRACKET_DEFS: BracketDef[] = [
    { minM3: 0,    maxM3: 0.05, perM3: false, keywords: ['hasta', '0.05'] },
    { minM3: 0.05, maxM3: 0.1,  perM3: false, keywords: ['0.05', '0.1']  },
    { minM3: 0.1,  maxM3: 0.3,  perM3: false, keywords: ['0.1',  '0.3']  },
    { minM3: 0.3,  maxM3: 0.5,  perM3: false, keywords: ['0.3',  '0.5']  },
    { minM3: 0.5,  maxM3: 0.75, perM3: false, keywords: ['0.5',  '0.75'] },
    { minM3: 0.75, maxM3: 1,    perM3: false, keywords: ['0.75', '1 m']  },
    { minM3: 1,    maxM3: null,  perM3: true,  keywords: ['mas de', '1m', 'por m3'] },
];

const ZONES: AddressZone[] = ['CABA', 'AMBA_1', 'AMBA_2', 'AMBA_3'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalise(s: string): string {
    return stripAccents(s).toLowerCase().trim();
}

/**
 * Parses an Argentine-formatted number that may use dots or spaces as
 * thousands separators (e.g. "$ 6.307", "6 307", "6307").
 * Returns null if the string is empty or non-numeric.
 */
function parsePrice(raw: string): number | null {
    const cleaned = raw.replace(/\s/g, '').replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '.');
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

/**
 * Parses a date in DD/MM/YYYY or DD/MM/YY format.
 */
function parseDate(raw: string): Date | null {
    const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    const day   = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year  = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const d = new Date(year, month, day);
    return d.getDate() === day && d.getMonth() === month ? d : null;
}

/**
 * Splits a CSV line into cells, handling quoted fields.
 */
function splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current.trim());
    return cells;
}

function matchesBracket(cellNorm: string, def: BracketDef): boolean {
    return def.keywords.every(kw => cellNorm.includes(kw));
}

// ─── Public parser ────────────────────────────────────────────────────────────

export function parseTariffCsv(csvBuffer: Buffer): ParsedTariffCsv {
    const text  = csvBuffer.toString('utf-8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    const errors: string[] = [];

    let label: string | null = null;
    let validFrom: Date | null = null;
    let zoneColumnIndices: number[] | null = null; // indices into the row cells for CABA, AMBA1-3
    const brackets: TariffBracket[] = [];
    let hourlyRateCaba: number | null = null;

    for (const line of lines) {
        const cells = splitCsvLine(line);
        if (cells.length === 0) continue;

        const firstNorm = normalise(cells[0]);

        // ── Meta header rows ──────────────────────────────────────────────────

        if (firstNorm === 'label' || firstNorm === 'periodo' || firstNorm === 'period') {
            label = cells[1]?.trim() || null;
            if (!label) errors.push('La fila "Label" no tiene un valor.');
            continue;
        }

        if (firstNorm === 'desde' || firstNorm === 'validfrom' || firstNorm === 'fecha') {
            const raw = cells[1]?.trim();
            if (!raw) { errors.push('La fila "Desde" no tiene una fecha.'); continue; }
            validFrom = parseDate(raw);
            if (!validFrom) errors.push(`No se pudo interpretar la fecha "${raw}". Usá DD/MM/YYYY.`);
            continue;
        }

        // ── Column header row ("Volumen,CABA,AMBA 1,...") ─────────────────────

        if (firstNorm === 'volumen' || firstNorm === 'volume') {
            // Build zone→column-index map
            zoneColumnIndices = [];
            const expectedLabels = ['caba', 'amba 1', 'amba1', 'amba 2', 'amba2', 'amba 3', 'amba3'];
            const zoneOrder: AddressZone[] = ['CABA', 'AMBA_1', 'AMBA_1', 'AMBA_2', 'AMBA_2', 'AMBA_3', 'AMBA_3'];
            const foundZones: AddressZone[] = [];
            const foundIndices: number[] = [];
            for (let i = 1; i < cells.length; i++) {
                const cn = normalise(cells[i]);
                const idx = expectedLabels.indexOf(cn);
                if (idx !== -1) {
                    const zone = zoneOrder[idx];
                    if (!foundZones.includes(zone)) {
                        foundZones.push(zone);
                        foundIndices.push(i);
                    }
                }
            }
            if (foundZones.length !== 4) {
                errors.push(
                    `No se encontraron las cuatro zonas en el encabezado. ` +
                    `Se esperaba: CABA, AMBA 1, AMBA 2, AMBA 3. ` +
                    `Se encontró: ${foundZones.join(', ') || 'ninguna'}.`,
                );
            }
            // Store in canonical order
            zoneColumnIndices = ZONES.map(z => {
                const i = foundZones.indexOf(z);
                return i !== -1 ? foundIndices[i] : -1;
            });
            continue;
        }

        // ── Hourly rate row ───────────────────────────────────────────────────

        if (firstNorm.startsWith('hora')) {
            const raw = cells[1]?.trim(); // CABA column only
            if (raw) {
                hourlyRateCaba = parsePrice(raw);
                if (hourlyRateCaba === null) {
                    errors.push(`No se pudo interpretar el precio de la tarifa horaria: "${raw}".`);
                }
            }
            continue;
        }

        // ── Volume bracket rows ───────────────────────────────────────────────

        if (!zoneColumnIndices) continue; // column header not seen yet — skip

        const def = BRACKET_DEFS.find(d => matchesBracket(firstNorm, d));
        if (!def) continue; // unrecognised row — silently skip

        const prices: Partial<Record<AddressZone, number>> = {};
        let missingZones = false;

        for (let zi = 0; zi < ZONES.length; zi++) {
            const colIdx = zoneColumnIndices[zi];
            if (colIdx === -1 || colIdx >= cells.length) { missingZones = true; continue; }
            const price = parsePrice(cells[colIdx]);
            if (price === null) {
                errors.push(
                    `Precio no válido en columna ${ZONES[zi]} para fila "${cells[0]}": "${cells[colIdx]}".`,
                );
                missingZones = true;
            } else {
                prices[ZONES[zi]] = price;
            }
        }

        if (!missingZones) {
            brackets.push({
                volumeMinM3: def.minM3,
                volumeMaxM3: def.maxM3,
                perM3:       def.perM3,
                prices:      prices as Record<AddressZone, number>,
            });
        }
    }

    // ── Validation ────────────────────────────────────────────────────────────

    if (!label)      errors.push('Falta la fila "Label" con el nombre del período (e.g. "Mayo 2026").');
    if (!validFrom)  errors.push('Falta la fila "Desde" con la fecha de inicio (DD/MM/YYYY).');
    if (brackets.length === 0) errors.push('No se encontraron filas de tarifas por volumen.');
    if (brackets.length > 0 && brackets.length < BRACKET_DEFS.length) {
        errors.push(
            `Solo se encontraron ${brackets.length} de ${BRACKET_DEFS.length} tramos esperados.`,
        );
    }

    if (errors.length > 0 || !label || !validFrom) {
        return { data: null, errors };
    }

    return {
        data: { label, validFrom, brackets, hourlyRateCaba },
        errors,
    };
}