import { Delivery, Package } from '../types';

function formatPackage(pkg: Package): string {
    const dims = `${pkg.length}x${pkg.width}x${pkg.height}`;
    return pkg.quantity > 1 ? `${pkg.quantity}x ${dims}` : dims;
}

function formatDelivery(delivery: Delivery): string {
    const lines: string[] = [`*${delivery.client}*`];
    // List packages
    for (const pkg of delivery.packages) {
        lines.push(`   - ${formatPackage(pkg)}`);
    }
    // List errors
    for (const error of delivery.errors) {
        lines.push(`   - ${error}`);
    }
    return lines.join('\n');
}

export function formatDeliveryReply(deliveries: Delivery[]): string {
    if (deliveries.length === 0) {
        return '⚠️ No se encontraron entregas en el mensaje.';
    }
    const successful = deliveries.filter((d) => d.errors.length === 0);
    const failed = deliveries.filter((d) => d.errors.length > 0);
    const sections: string[] = [];

    if (successful.length > 0) {
        sections.push(`✅ *Guardado correctamente (${successful.length})*`);
        sections.push(...successful.map(formatDelivery));
    }

    if (failed.length > 0) {
        sections.push(`❌ *Con errores (${failed.length})*`);
        sections.push(...failed.map(formatDelivery));
    }

    return sections.join('\n\n');
}