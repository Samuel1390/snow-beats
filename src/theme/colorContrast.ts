// Motor de contraste adaptativo WCAG 2.1 AAA para reproductor, letras y tarjetas compartibles

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.substring(0, 2), 16),
        parseInt(clean.substring(2, 4), 16),
        parseInt(clean.substring(4, 6), 16),
    ];
}

function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rn:
                h = (gn - bn) / d + (gn < bn ? 6 : 0);
                break;
            case gn:
                h = (bn - rn) / d + 2;
                break;
            case bn:
                h = (rn - gn) / d + 4;
                break;
        }
        h /= 6;
    }

    return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const hue2rgb = (p: number, q: number, t: number) => {
        let tn = t;
        if (tn < 0) tn += 1;
        if (tn > 1) tn -= 1;
        if (tn < 1 / 6) return p + (q - p) * 6 * tn;
        if (tn < 1 / 2) return q;
        if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
}

// Calcula la luminancia relativa WCAG 2.1 (0 = negro, 1 = blanco)
export function getRelativeLuminance(hex: string): number {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0.05;
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const toLinear = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Ratio de contraste WCAG entre dos colores hex (1..21)
export function getContrastRatio(hexA: string, hexB: string): number {
    const l1 = getRelativeLuminance(hexA);
    const l2 = getRelativeLuminance(hexB);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

// Oscurece preservando matiz y saturación controlada hasta cumplir luminancia máxima segura
function clampSurfaceLuminance(hex: string, maxLum: number, minSat = 0.22, maxSat = 0.68): string {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    // Conserva neutralidad en portadas monocromáticas (s < 0.08)
    const safeS = s < 0.08 ? s : Math.max(minSat, Math.min(maxSat, s));
    let targetL = Math.min(l, 0.34);

    // Búsqueda iterativa corta para garantizar luminancia relativa <= maxLum (ratio AAA >= 7.5:1 con blanco)
    for (let i = 0; i < 10; i++) {
        const [nr, ng, nb] = hslToRgb(h, safeS, targetL);
        const candidate = rgbToHex(nr, ng, nb);
        if (getRelativeLuminance(candidate) <= maxLum) {
            return candidate;
        }
        targetL *= 0.78;
    }

    const [fr, fg, fb] = hslToRgb(h, safeS, Math.max(0.08, targetL));
    return rgbToHex(fr, fg, fb);
}

export function getDynamicPlayerPalette(dominantHex?: string | null): {
    background: string;
    backgroundBottom: string;
    foreground: string;
    muted: string;
} {
    if (!dominantHex || !/^#[0-9A-Fa-f]{6}$/.test(dominantHex)) {
        return {
            background: '#18181B',
            backgroundBottom: '#0B0B0E',
            foreground: '#FFFFFF',
            muted: 'rgba(255, 255, 255, 0.72)',
        };
    }

    // Techo de luminancia 0.085 -> contraste >= 7.7:1 con texto blanco (WCAG AAA)
    const background = clampSurfaceLuminance(dominantHex, 0.085);
    const backgroundBottom = clampSurfaceLuminance(dominantHex, 0.032, 0.18, 0.55);

    return {
        background,
        backgroundBottom,
        foreground: '#FFFFFF',
        muted: 'rgba(255, 255, 255, 0.74)',
    };
}

// Paleta dedicada a la vista de letras en tiempo real (jerarquía visual de 3 niveles)
export function getLyricsSurfacePalette(dominantHex?: string | null): {
    topColor: string;
    bottomColor: string;
    tickerBg: string;
    activeText: string;
    upcomingText: string;
    pastText: string;
    accentPillBg: string;
} {
    const base = getDynamicPlayerPalette(dominantHex);
    return {
        topColor: base.background,
        bottomColor: base.backgroundBottom,
        tickerBg: 'rgba(0, 0, 0, 0.28)',
        activeText: '#FFFFFF',
        upcomingText: 'rgba(255, 255, 255, 0.54)',
        pastText: 'rgba(255, 255, 255, 0.34)',
        accentPillBg: 'rgba(255, 255, 255, 0.14)',
    };
}

// Decide automáticamente si una tarjeta compartible debe usar tinta blanca o negra según WCAG
export function getAdaptiveCardInk(cardBackgroundHex: string): {
    primaryText: string;
    secondaryText: string;
    isDarkSurface: boolean;
} {
    const whiteContrast = getContrastRatio(cardBackgroundHex, '#FFFFFF');
    const darkContrast = getContrastRatio(cardBackgroundHex, '#111114');
    const isDarkSurface = whiteContrast >= darkContrast;

    return isDarkSurface
        ? {
              primaryText: '#FFFFFF',
              secondaryText: 'rgba(255, 255, 255, 0.78)',
              isDarkSurface: true,
          }
        : {
              primaryText: '#111114',
              secondaryText: 'rgba(17, 17, 20, 0.72)',
              isDarkSurface: false,
          };
}

// Calcula el color de una porción del gráfico de dona usando el color dominante de la carátula
// (mismo matiz que SongCard/FullPlayerModal) sin desaturarlo a gris; solo canciones sin carátula quedan grises
export function getDonutSliceColor(
    dominantHex: string | null | undefined,
    hasArtwork: boolean,
    surfaceBgHex: string,
    isDarkSurface: boolean,
    grayColor: string
): string {
    if (!hasArtwork) {
        return grayColor;
    }
    if (!dominantHex || !/^#[0-9A-Fa-f]{6}$/.test(dominantHex)) {
        return grayColor;
    }

    const [r, g, b] = hexToRgb(dominantHex);
    const [h, s, l] = rgbToHsl(r, g, b);

    // Si la portada es realmente blanco y negro / monocromática (saturación casi nula), conservar neutralidad legible
    if (s < 0.04) {
        const neutralL = isDarkSurface ? Math.max(0.54, Math.min(0.76, l)) : Math.min(0.46, Math.max(0.28, l));
        const [nr, ng, nb] = hslToRgb(h, s, neutralL);
        return rgbToHex(nr, ng, nb);
    }

    // Preserva exactamente el matiz (hue) de la carátula y garantiza saturación viva (nunca lavado a gris)
    const vividS = Math.max(0.52, Math.min(0.86, s < 0.35 ? s * 1.65 + 0.2 : s * 1.15));
    let targetL = isDarkSurface
        ? Math.max(0.48, Math.min(0.68, l < 0.36 ? 0.56 : l))
        : Math.min(0.50, Math.max(0.32, l > 0.64 ? 0.42 : l));

    // Ajusta únicamente la luminosidad HSL hasta garantizar contraste nítido contra la tarjeta del tema
    for (let step = 0; step < 8; step++) {
        const [cr, cg, cb] = hslToRgb(h, vividS, targetL);
        const candidate = rgbToHex(cr, cg, cb);
        if (getContrastRatio(candidate, surfaceBgHex) >= 2.8) {
            return candidate;
        }
        targetL = isDarkSurface
            ? Math.min(0.78, targetL + 0.045)
            : Math.max(0.22, targetL - 0.045);
    }

    const [fr, fg, fb] = hslToRgb(h, vividS, targetL);
    return rgbToHex(fr, fg, fb);
}