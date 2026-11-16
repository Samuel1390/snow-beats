// Calcula la luminancia relativa WCAG de un color hexadecimal
function getRelativeLuminance(hex: string): number {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;

    const toLinear = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function darkenHex(hex: string, factor = 0.35): string {
    const clean = hex.replace('#', '');
    const r = Math.round(parseInt(clean.substring(0, 2), 16) * factor);
    const g = Math.round(parseInt(clean.substring(2, 4), 16) * factor);
    const b = Math.round(parseInt(clean.substring(4, 6), 16) * factor);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function getDynamicPlayerPalette(dominantHex?: string | null): {
    background: string;
    foreground: string;
    muted: string;
} {
    if (!dominantHex || !/^#[0-9A-Fa-f]{6}$/.test(dominantHex)) {
        return {
            background: '#18181B',
            foreground: '#FFFFFF',
            muted: 'rgba(255, 255, 255, 0.7)',
        };
    }

    const lum = getRelativeLuminance(dominantHex);
    // Si el color dominante es muy claro, lo oscurecemos conservando su matiz
    const background = lum > 0.2 ? darkenHex(dominantHex, 0.32) : darkenHex(dominantHex, 0.75);

    return {
        background,
        foreground: '#FFFFFF',
        muted: 'rgba(255, 255, 255, 0.75)',
    };
}