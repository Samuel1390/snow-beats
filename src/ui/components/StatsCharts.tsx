import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Image,
    LayoutChangeEvent,
    PanResponder,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import Svg, {
    Circle,
    Defs,
    Line,
    LinearGradient as SvgLinearGradient,
    Path,
    Stop,
    Text as SvgText,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Flame, Music } from 'lucide-react-native';
import { ListeningBucket } from '../../storage/database/db';
import { Track } from '../../types/music';
import { resolveIsLightText, useTheme } from '../../theme/ThemeContext';
import { getDonutSliceColor } from '../../theme/colorContrast';
import { useI18n } from '../../i18n/LanguageContext';

export interface StatsThemePalette {
    isDarkSurface: boolean;
    screenBg: string;
    cardBg: string;
    cardBgHex: string;
    cardBorder: string;
    subtleSurface: string;
    text: string;
    muted: string;
    accent: string;
    accentSoft: string;
    chartGrid: string;
    chartAxisText: string;
    otherSliceColor: string;
    noCoverSliceColor: string;
    pillBg: string;
    pillText: string;
    divider: string;
    segmentedBg: string;
}

export function useStatsPalette(): StatsThemePalette {
    const { theme } = useTheme();
    const systemScheme = useColorScheme();
    const isDarkSurface = resolveIsLightText(theme, systemScheme);

    return useMemo<StatsThemePalette>(() => {
        if (isDarkSurface) {
            return {
                isDarkSurface: true,
                screenBg: '#0C0E14',
                cardBg: '#151822',
                cardBgHex: '#151822',
                cardBorder: 'rgba(255,255,255,0.08)',
                subtleSurface: '#1B2030',
                text: '#FFFFFF',
                muted: '#A1A1AA',
                accent: '#38BDF8',
                accentSoft: 'rgba(56, 189, 248, 0.16)',
                chartGrid: 'rgba(255,255,255,0.09)',
                chartAxisText: '#94A3B8',
                otherSliceColor: '#71717A',
                noCoverSliceColor: '#52525B',
                pillBg: 'rgba(37, 99, 235, 0.22)',
                pillText: '#93C5FD',
                divider: 'rgba(255,255,255,0.07)',
                segmentedBg: '#171C28',
            };
        }
        return {
            isDarkSurface: false,
            screenBg: '#F4F4F5',
            cardBg: '#FFFFFF',
            cardBgHex: '#FFFFFF',
            cardBorder: 'rgba(15, 23, 42, 0.10)',
            subtleSurface: '#E4E4E7',
            text: '#09090B',
            muted: '#52525B',
            accent: '#1D4ED8',
            accentSoft: 'rgba(29, 78, 216, 0.12)',
            chartGrid: 'rgba(15, 23, 42, 0.10)',
            chartAxisText: '#475569',
            otherSliceColor: '#94A3B8',
            noCoverSliceColor: '#CBD5E1',
            pillBg: 'rgba(29, 78, 216, 0.12)',
            pillText: '#1E40AF',
            divider: 'rgba(15, 23, 42, 0.08)',
            segmentedBg: '#E4E4E7',
        };
    }, [isDarkSurface]);
}

// ============================================================================
// 1. GRÁFICA INTERACTIVA DE TIEMPO DE ESCUCHA (0-1h -> 0-4h -> 0-12h -> 0-24h -> días hasta 30d)
// ============================================================================

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const SAMPLE_POINTS = 36;

interface TimelineSample {
    xFrac: number; // 0..1 dentro del eje X visible
    ts: number;
    elapsedSinceInstallMs: number;
    playbackSeconds: number;
}

function formatPlaybackClock(totalSec: number, isDaily: boolean): string {
    const safe = Math.max(0, Math.floor(totalSec));
    const sec = safe % 60;
    if (isDaily) {
        const hrs = Math.floor(safe / 3600);
        const mins = Math.floor((safe % 3600) / 60);
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    const totalMins = Math.floor(safe / 60);
    return `${String(totalMins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatElapsedExact(elapsedMs: number, isDaily: boolean): string {
    const safeMs = Math.max(0, elapsedMs);
    if (isDaily) {
        const totalHours = Math.floor(safeMs / HOUR_MS);
        const days = Math.floor(totalHours / 24);
        const remHours = totalHours % 24;
        if (days === 0) return `${remHours}h`;
        return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    }
    const totalMins = Math.floor(safeMs / 60_000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs === 0) return `${mins}m`;
    return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function buildSmoothLinePath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const midX = (prev.x + curr.x) / 2;
        d += ` C ${midX.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
}

interface ListeningTimelineChartProps {
    installedAt: number;
    buckets: ListeningBucket[];
    totalSeconds: number;
    todaySeconds: number;
    palette: StatsThemePalette;
    onScrubStateChange?: (scrubbing: boolean) => void;
}

export const ListeningTimelineChart: React.FC<ListeningTimelineChartProps> = React.memo(
    ({ installedAt, buckets, totalSeconds, todaySeconds, palette, onScrubStateChange }) => {
        const { t } = useI18n();
        const [containerWidth, setContainerWidth] = useState(310);
        const [selectedPoint, setSelectedPoint] = useState<TimelineSample | null>(null);
        const [isDragging, setIsDragging] = useState(false);

        const chartHeight = 166;
        const padLeft = 56;
        const padRight = 14;
        const padTop = 14;
        const padBottom = 26;
        const plotWidth = Math.max(120, containerWidth - padLeft - padRight);
        const plotHeight = chartHeight - padTop - padBottom;

        const timelineModel = useMemo(() => {
            const now = Date.now();
            const safeInstalled = Math.min(installedAt, now);
            const elapsedMs = Math.max(0, now - safeInstalled);
            const elapsedHours = elapsedMs / HOUR_MS;
            const elapsedDays = elapsedMs / DAY_MS;

            let isDaily = false;
            let spanMs = HOUR_MS;
            let windowStart = safeInstalled;
            let rangeBadge = '0–1h';
            let xTicks: string[] = ['0', '15m', '30m', '45m', '1h'];

            if (elapsedHours <= 1) {
                isDaily = false;
                spanMs = HOUR_MS;
                windowStart = safeInstalled;
                rangeBadge = '0–1h';
                xTicks = ['0', '15m', '30m', '45m', '1h'];
            } else if (elapsedHours <= 4) {
                isDaily = false;
                spanMs = 4 * HOUR_MS;
                windowStart = safeInstalled;
                rangeBadge = '0–4h';
                xTicks = ['0', '1h', '2h', '3h', '4h'];
            } else if (elapsedHours <= 12) {
                isDaily = false;
                spanMs = 12 * HOUR_MS;
                windowStart = safeInstalled;
                rangeBadge = '0–12h';
                xTicks = ['0', '3h', '6h', '9h', '12h'];
            } else if (elapsedHours <= 24) {
                isDaily = false;
                spanMs = 24 * HOUR_MS;
                windowStart = safeInstalled;
                rangeBadge = '0–24h';
                xTicks = ['0', '6h', '12h', '18h', '24h'];
            } else if (elapsedDays <= 30) {
                isDaily = true;
                const spanDays = Math.min(30, Math.max(2, Math.ceil(elapsedDays)));
                spanMs = spanDays * DAY_MS;
                windowStart = safeInstalled;
                rangeBadge = `0–${spanDays}d`;
                xTicks = [
                    '0d',
                    `${Math.round(spanDays * 0.25)}d`,
                    `${Math.round(spanDays * 0.5)}d`,
                    `${Math.round(spanDays * 0.75)}d`,
                    `${spanDays}d`,
                ];
            } else {
                // Solo los últimos 30 días
                isDaily = true;
                spanMs = THIRTY_DAYS_MS;
                windowStart = now - THIRTY_DAYS_MS;
                rangeBadge = t('stats.chartRangeLast30');
                xTicks = ['-30d', '-22d', '-15d', '-7d', t('stats.chartNow')];
            }

            const validBuckets = buckets
                .filter((b) => b.ts >= windowStart - 60_000 && b.ts <= now + 60_000)
                .sort((a, b) => a.ts - b.ts);

            const activeElapsedInWindow = Math.max(60_000, now - windowStart);
            const nowFrac = Math.max(0.03, Math.min(1, activeElapsedInWindow / spanMs));

            // Construye la curva acumulada de reproducción dentro de la ventana visible hasta 'now'
            const samples: TimelineSample[] = [];
            let bucketIdx = 0;
            let cumulativeSec = 0;

            for (let i = 0; i < SAMPLE_POINTS; i++) {
                const ratio = i / (SAMPLE_POINTS - 1);
                const sampleTs = windowStart + ratio * (now - windowStart);
                if (i === 0 && windowStart === safeInstalled && validBuckets.length > 0 && validBuckets[0].ts > windowStart) {
                    cumulativeSec = 0;
                } else {
                    while (bucketIdx < validBuckets.length && validBuckets[bucketIdx].ts <= sampleTs + 30_000) {
                        cumulativeSec += validBuckets[bucketIdx].seconds;
                        bucketIdx++;
                    }
                }
                samples.push({
                    xFrac: Math.min(1, ratio * nowFrac),
                    ts: sampleTs,
                    elapsedSinceInstallMs: Math.max(0, sampleTs - safeInstalled),
                    playbackSeconds: cumulativeSec,
                });
            }

            // Asegura incluir cualquier resto de buckets recientes en el último punto
            while (bucketIdx < validBuckets.length) {
                cumulativeSec += validBuckets[bucketIdx].seconds;
                bucketIdx++;
            }
            if (samples.length > 0) {
                samples[samples.length - 1] = {
                    ...samples[samples.length - 1],
                    playbackSeconds: Math.max(
                        cumulativeSec,
                        windowStart === safeInstalled ? totalSeconds : cumulativeSec
                    ),
                };
            }

            const maxVal = samples.reduce((m, s) => Math.max(m, s.playbackSeconds), 0);
            // Techo limpio para el eje Y
            const yMax = maxVal <= 0 ? (isDaily ? 3600 : 300) : Math.ceil(maxVal * 1.18);

            return {
                isDaily,
                rangeBadge,
                xTicks,
                samples,
                nowFrac,
                yMax,
                latestSample: samples[samples.length - 1] ?? {
                    xFrac: nowFrac,
                    ts: now,
                    elapsedSinceInstallMs: elapsedMs,
                    playbackSeconds: totalSeconds,
                },
            };
        }, [installedAt, buckets, totalSeconds, t]);

        // Calcula el punto interpolado exacto bajo el dedo
        const resolveSampleAtLocationX = useCallback(
            (locX: number): TimelineSample => {
                const clampedX = Math.max(padLeft, Math.min(padLeft + plotWidth, locX));
                const xFrac = (clampedX - padLeft) / plotWidth;
                const samples = timelineModel.samples;
                if (samples.length === 0) return timelineModel.latestSample;

                const last = samples[samples.length - 1];
                if (xFrac >= last.xFrac) return last;
                if (xFrac <= samples[0].xFrac) return samples[0];

                for (let i = 1; i < samples.length; i++) {
                    const prev = samples[i - 1];
                    const curr = samples[i];
                    if (xFrac <= curr.xFrac) {
                        const segSpan = Math.max(0.0001, curr.xFrac - prev.xFrac);
                        const localT = Math.max(0, Math.min(1, (xFrac - prev.xFrac) / segSpan));
                        return {
                            xFrac,
                            ts: prev.ts + (curr.ts - prev.ts) * localT,
                            elapsedSinceInstallMs:
                                prev.elapsedSinceInstallMs +
                                (curr.elapsedSinceInstallMs - prev.elapsedSinceInstallMs) * localT,
                            playbackSeconds: Math.round(
                                prev.playbackSeconds +
                                    (curr.playbackSeconds - prev.playbackSeconds) * localT
                            ),
                        };
                    }
                }
                return last;
            },
            [padLeft, plotWidth, timelineModel]
        );

        const resolveRef = useRef(resolveSampleAtLocationX);
        resolveRef.current = resolveSampleAtLocationX;
        const scrubCallbackRef = useRef(onScrubStateChange);
        scrubCallbackRef.current = onScrubStateChange;

        const panResponder = useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderTerminationRequest: () => false,
                    onPanResponderGrant: (evt) => {
                        setIsDragging(true);
                        scrubCallbackRef.current?.(true);
                        setSelectedPoint(resolveRef.current(evt.nativeEvent.locationX));
                    },
                    onPanResponderMove: (evt) => {
                        setSelectedPoint(resolveRef.current(evt.nativeEvent.locationX));
                    },
                    onPanResponderRelease: () => {
                        setIsDragging(false);
                        scrubCallbackRef.current?.(false);
                    },
                    onPanResponderTerminate: () => {
                        setIsDragging(false);
                        scrubCallbackRef.current?.(false);
                    },
                }),
            []
        );

        const handleLayout = useCallback((e: LayoutChangeEvent) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            if (w > 120) setContainerWidth(w);
        }, []);

        const svgPoints = useMemo(() => {
            return timelineModel.samples.map((s) => ({
                x: padLeft + s.xFrac * plotWidth,
                y: padTop + plotHeight - (s.playbackSeconds / timelineModel.yMax) * plotHeight,
            }));
        }, [timelineModel, padLeft, padTop, plotWidth, plotHeight]);

        const linePath = useMemo(() => buildSmoothLinePath(svgPoints), [svgPoints]);
        const areaPath = useMemo(() => {
            if (svgPoints.length < 2) return '';
            const first = svgPoints[0];
            const last = svgPoints[svgPoints.length - 1];
            const baseY = padTop + plotHeight;
            return `${linePath} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${first.x.toFixed(1)} ${baseY.toFixed(1)} Z`;
        }, [svgPoints, linePath, padTop, plotHeight]);

        const activeDisplay = selectedPoint ?? timelineModel.latestSample;
        const markerX = padLeft + activeDisplay.xFrac * plotWidth;
        const markerY =
            padTop + plotHeight - (activeDisplay.playbackSeconds / timelineModel.yMax) * plotHeight;
        const yTicks = [0, 0.5, 1];

        return (
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.cardBg,
                        borderColor: palette.cardBorder,
                    },
                ]}
            >
                {/* Cabecera compacta con escala activa y lectura hoy */}
                <View style={styles.chartHeaderRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.chartTitle, { color: palette.text }]}>
                            {t('stats.totalListeningTitle')}
                        </Text>
                        <Text style={[styles.chartSubtitle, { color: palette.muted }]}>
                            {t('stats.todayBadge', {
                                time: formatPlaybackClock(todaySeconds, todaySeconds >= 3600),
                            })}
                        </Text>
                    </View>
                    <View
                        style={[
                            styles.rangeChip,
                            {
                                backgroundColor: palette.accentSoft,
                                borderColor: palette.accent,
                            },
                        ]}
                    >
                        <Text style={[styles.rangeChipText, { color: palette.accent }]}>
                            {timelineModel.rangeBadge}
                        </Text>
                    </View>
                </View>

                {/* Readout interactivo del punto marcado (tiempo desde instalación + reproducción) */}
                <View
                    style={[
                        styles.readoutStrip,
                        {
                            backgroundColor: palette.subtleSurface,
                            borderColor: isDragging || selectedPoint ? palette.accent : palette.cardBorder,
                        },
                    ]}
                >
                    <View style={styles.readoutCol}>
                        <Text style={[styles.readoutLabel, { color: palette.muted }]}>
                            {t('stats.chartElapsedLabel')}
                        </Text>
                        <Text style={[styles.readoutValue, { color: palette.text }]}>
                            {formatElapsedExact(
                                activeDisplay.elapsedSinceInstallMs,
                                timelineModel.isDaily
                            )}
                        </Text>
                    </View>
                    <View style={[styles.readoutDivider, { backgroundColor: palette.divider }]} />
                    <View style={styles.readoutCol}>
                        <Text style={[styles.readoutLabel, { color: palette.muted }]}>
                            {t('stats.chartPlaybackLabel')}
                        </Text>
                        <Text style={[styles.readoutValue, { color: palette.accent }]}>
                            {formatPlaybackClock(
                                activeDisplay.playbackSeconds,
                                timelineModel.isDaily
                            )}
                        </Text>
                    </View>
                </View>

                {/* Lienzo SVG interactivo al tocar o arrastrar */}
                <View
                    style={styles.chartCanvasWrap}
                    onLayout={handleLayout}
                    {...panResponder.panHandlers}
                >
                    <Svg width={containerWidth} height={chartHeight}>
                        <Defs>
                            <SvgLinearGradient id="snowBeatsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0%" stopColor={palette.accent} stopOpacity="0.34" />
                                <Stop offset="100%" stopColor={palette.accent} stopOpacity="0.02" />
                            </SvgLinearGradient>
                        </Defs>

                        {/* Rejilla horizontal + etiquetas eje Y */}
                        {yTicks.map((ratio) => {
                            const y = padTop + plotHeight - ratio * plotHeight;
                            const valSec = Math.round(ratio * timelineModel.yMax);
                            return (
                                <React.Fragment key={`y-${ratio}`}>
                                    <Line
                                        x1={padLeft}
                                        y1={y}
                                        x2={padLeft + plotWidth}
                                        y2={y}
                                        stroke={palette.chartGrid}
                                        strokeWidth={1}
                                        strokeDasharray={ratio === 0 ? undefined : '3,4'}
                                    />
                                    <SvgText
                                        x={padLeft - 7}
                                        y={y + 4}
                                        fontSize={10}
                                        fontWeight="600"
                                        fill={palette.chartAxisText}
                                        textAnchor="end"
                                    >
                                        {formatPlaybackClock(valSec, timelineModel.isDaily)}
                                    </SvgText>
                                </React.Fragment>
                            );
                        })}

                        {/* Etiquetas eje X */}
                        {timelineModel.xTicks.map((label, idx) => {
                            const frac = idx / Math.max(1, timelineModel.xTicks.length - 1);
                            const x = padLeft + frac * plotWidth;
                            const anchor =
                                idx === 0
                                    ? 'start'
                                    : idx === timelineModel.xTicks.length - 1
                                    ? 'end'
                                    : 'middle';
                            return (
                                <SvgText
                                    key={`x-${idx}-${label}`}
                                    x={x}
                                    y={chartHeight - 6}
                                    fontSize={10}
                                    fontWeight="600"
                                    fill={palette.chartAxisText}
                                    textAnchor={anchor}
                                >
                                    {label}
                                </SvgText>
                            );
                        })}

                        {/* Área sombreada y curva suave de reproducción */}
                        {areaPath ? <Path d={areaPath} fill="url(#snowBeatsAreaGrad)" /> : null}
                        {linePath ? (
                            <Path
                                d={linePath}
                                fill="none"
                                stroke={palette.accent}
                                strokeWidth={2.6}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}

                        {/* Guía vertical + punto marcado */}
                        <Line
                            x1={markerX}
                            y1={padTop}
                            x2={markerX}
                            y2={padTop + plotHeight}
                            stroke={palette.accent}
                            strokeOpacity={selectedPoint ? 0.65 : 0.35}
                            strokeWidth={1.2}
                            strokeDasharray="3,3"
                        />
                        <Circle
                            cx={markerX}
                            cy={markerY}
                            r={selectedPoint ? 9 : 6.5}
                            fill={palette.accent}
                            fillOpacity={0.22}
                        />
                        <Circle
                            cx={markerX}
                            cy={markerY}
                            r={selectedPoint ? 4.8 : 4}
                            fill={palette.accent}
                            stroke={palette.cardBgHex}
                            strokeWidth={2}
                        />
                    </Svg>
                </View>

                <Text style={[styles.chartHintText, { color: palette.muted }]}>
                    {t('stats.chartTouchHint')}
                </Text>
            </View>
        );
    }
);

// ============================================================================
// 2. GRÁFICO DE DONA: TOP 5 CON COLOR DOMINANTE DE CARÁTULA + 6ª PORCIÓN "OTRAS" EN GRIS
// ============================================================================

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
        x: cx + radius * Math.cos(rad),
        y: cy + radius * Math.sin(rad),
    };
}

function describeDonutArc(
    cx: number,
    cy: number,
    outerR: number,
    innerR: number,
    startAngle: number,
    endAngle: number
): string {
    const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
    const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
    const startInner = polarToCartesian(cx, cy, innerR, startAngle);
    const endInner = polarToCartesian(cx, cy, innerR, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
        `M ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
        `A ${outerR} ${outerR} 0 ${largeArcFlag} 0 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
        `L ${startInner.x.toFixed(2)} ${startInner.y.toFixed(2)}`,
        `A ${innerR} ${innerR} 0 ${largeArcFlag} 1 ${endInner.x.toFixed(2)} ${endInner.y.toFixed(2)}`,
        'Z',
    ].join(' ');
}

interface DonutSliceItem {
    id: string;
    label: string;
    plays: number;
    percent: number;
    color: string;
    isOther?: boolean;
}

interface TopSongsDonutChartProps {
    topTracks: Track[];
    otherPlays: number;
    totalPlays: number;
    palette: StatsThemePalette;
}

export const TopSongsDonutChart: React.FC<TopSongsDonutChartProps> = React.memo(
    ({ topTracks, otherPlays, totalPlays, palette }) => {
        const { t } = useI18n();
        const [selectedSliceId, setSelectedSliceId] = useState<string | null>(null);

        const slices = useMemo<DonutSliceItem[]>(() => {
            const top5 = topTracks.slice(0, 5);
            const sumPlays = Math.max(
                1,
                totalPlays > 0
                    ? totalPlays
                    : top5.reduce((acc, tr) => acc + (tr.playCount || 0), 0) + otherPlays
            );

            const items: DonutSliceItem[] = top5.map((track) => ({
                id: track.id,
                label: track.title,
                plays: track.playCount || 0,
                percent: Math.round(((track.playCount || 0) / sumPlays) * 100),
                color: getDonutSliceColor(
                    track.dominantColor,
                    Boolean(track.artworkUri),
                    palette.cardBgHex,
                    palette.isDarkSurface,
                    palette.noCoverSliceColor
                ),
            }));

            // 6ta porción fija en gris para "Otras"
            items.push({
                id: '__others__',
                label: t('stats.donutOthers'),
                plays: Math.max(0, otherPlays),
                percent: Math.round((Math.max(0, otherPlays) / sumPlays) * 100),
                color: palette.otherSliceColor,
                isOther: true,
            });

            return items;
        }, [topTracks, otherPlays, totalPlays, palette, t]);

        const drawableSlices = useMemo(() => slices.filter((s) => s.plays > 0), [slices]);
        const sumDrawable = useMemo(
            () => Math.max(1, drawableSlices.reduce((acc, s) => acc + s.plays, 0)),
            [drawableSlices]
        );

        const size = 148;
        const cx = size / 2;
        const cy = size / 2;
        const outerR = 64;
        const innerR = 40;

        const arcPaths = useMemo(() => {
            let cursorDeg = 0;
            return drawableSlices.map((slice) => {
                const sweep = (slice.plays / sumDrawable) * 360;
                const start = cursorDeg;
                const end = cursorDeg + sweep;
                cursorDeg = end;
                const isSelected = selectedSliceId === slice.id;
                const rOut = isSelected ? outerR + 4 : outerR;
                return {
                    ...slice,
                    isFullCircle: sweep >= 359.5,
                    path:
                        sweep >= 359.5
                            ? ''
                            : describeDonutArc(cx, cy, rOut, innerR, start, end),
                    rOut,
                };
            });
        }, [drawableSlices, sumDrawable, selectedSliceId, cx, cy, outerR, innerR]);

        const activeSlice = useMemo(
            () => slices.find((s) => s.id === selectedSliceId) ?? null,
            [slices, selectedSliceId]
        );

        return (
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.cardBg,
                        borderColor: palette.cardBorder,
                    },
                ]}
            >
                <View style={styles.donutContainerRow}>
                    {/* Dona SVG */}
                    <View style={styles.donutSvgWrap}>
                        <Svg width={size} height={size}>
                            {arcPaths.map((arc) =>
                                arc.isFullCircle ? (
                                    <Circle
                                        key={arc.id}
                                        cx={cx}
                                        cy={cy}
                                        r={(arc.rOut + innerR) / 2}
                                        fill="none"
                                        stroke={arc.color}
                                        strokeWidth={arc.rOut - innerR}
                                        onPress={() =>
                                            setSelectedSliceId((prev) =>
                                                prev === arc.id ? null : arc.id
                                            )
                                        }
                                    />
                                ) : (
                                    <Path
                                        key={arc.id}
                                        d={arc.path}
                                        fill={arc.color}
                                        stroke={palette.cardBgHex}
                                        strokeWidth={2.2}
                                        opacity={
                                            selectedSliceId && selectedSliceId !== arc.id
                                                ? 0.48
                                                : 1
                                        }
                                        onPress={() =>
                                            setSelectedSliceId((prev) =>
                                                prev === arc.id ? null : arc.id
                                            )
                                        }
                                    />
                                )
                            )}
                        </Svg>

                        {/* Centro de la dona con alto contraste */}
                        <View pointerEvents="none" style={styles.donutCenterOverlay}>
                            <Text
                                style={[
                                    styles.donutCenterNumber,
                                    { color: activeSlice ? activeSlice.color : palette.text },
                                ]}
                                numberOfLines={1}
                            >
                                {activeSlice ? `${activeSlice.percent}%` : totalPlays}
                            </Text>
                            <Text
                                style={[styles.donutCenterLabel, { color: palette.muted }]}
                                numberOfLines={1}
                            >
                                {activeSlice ? activeSlice.label : t('stats.totalPlays')}
                            </Text>
                        </View>
                    </View>

                    {/* Leyenda de las 5 canciones + 6ª porción Otras */}
                    <View style={styles.donutLegendCol}>
                        {slices.map((slice) => {
                            const isSelected = selectedSliceId === slice.id;
                            return (
                                <TouchableOpacity
                                    key={slice.id}
                                    activeOpacity={0.75}
                                    onPress={() =>
                                        setSelectedSliceId((prev) =>
                                            prev === slice.id ? null : slice.id
                                        )
                                    }
                                    style={[
                                        styles.legendRow,
                                        isSelected && {
                                            backgroundColor: palette.subtleSurface,
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.legendDot,
                                            {
                                                backgroundColor: slice.color,
                                                borderColor: palette.cardBorder,
                                            },
                                        ]}
                                    />
                                    <Text
                                        style={[
                                            styles.legendTitle,
                                            {
                                                color: slice.isOther ? palette.muted : palette.text,
                                                fontWeight: isSelected ? '800' : '600',
                                            },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {slice.label}
                                    </Text>
                                    <Text style={[styles.legendPct, { color: palette.muted }]}>
                                        {slice.percent}%
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </View>
        );
    }
);

// ============================================================================
// 3. FILA #1 "EN LLAMAS" CON FUEGO ANIMADO + NÚMERO 1 AMARILLO EN NEGRITA Y MÁS GRANDE
// ============================================================================

interface TopFirstFireRowProps {
    track: Track;
    playsLabel: string;
    onPress: () => void;
}

const SPARK_SEEDS = [
    { left: '14%', size: 4.5, duration: 1550, delay: 0 },
    { left: '33%', size: 3.5, duration: 1850, delay: 340 },
    { left: '54%', size: 5, duration: 1450, delay: 680 },
    { left: '72%', size: 4, duration: 1700, delay: 220 },
    { left: '87%', size: 3.5, duration: 1600, delay: 900 },
] as const;

export const TopFirstFireRow: React.FC<TopFirstFireRowProps> = React.memo(
    ({ track, playsLabel, onPress }) => {
        const glowAnim = useRef(new Animated.Value(0)).current;
        const flameWaveA = useRef(new Animated.Value(0)).current;
        const flameWaveB = useRef(new Animated.Value(0)).current;
        const sparkAnims = useRef(SPARK_SEEDS.map(() => new Animated.Value(0))).current;

        useEffect(() => {
            const glowLoop = Animated.loop(
                Animated.sequence([
                    Animated.timing(glowAnim, {
                        toValue: 1,
                        duration: 900,
                        easing: Easing.inOut(Easing.sin),
                        useNativeDriver: true,
                    }),
                    Animated.timing(glowAnim, {
                        toValue: 0,
                        duration: 850,
                        easing: Easing.inOut(Easing.sin),
                        useNativeDriver: true,
                    }),
                ])
            );

            const waveALoop = Animated.loop(
                Animated.sequence([
                    Animated.timing(flameWaveA, {
                        toValue: 1,
                        duration: 620,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                    Animated.timing(flameWaveA, {
                        toValue: 0,
                        duration: 580,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                ])
            );

            const waveBLoop = Animated.loop(
                Animated.sequence([
                    Animated.timing(flameWaveB, {
                        toValue: 1,
                        duration: 740,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                    Animated.timing(flameWaveB, {
                        toValue: 0,
                        duration: 690,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                ])
            );

            const sparkLoops = sparkAnims.map((anim, idx) => {
                const seed = SPARK_SEEDS[idx];
                return Animated.loop(
                    Animated.sequence([
                        Animated.delay(seed.delay),
                        Animated.timing(anim, {
                            toValue: 1,
                            duration: seed.duration,
                            easing: Easing.out(Easing.quad),
                            useNativeDriver: true,
                        }),
                        Animated.timing(anim, {
                            toValue: 0,
                            duration: 0,
                            useNativeDriver: true,
                        }),
                    ])
                );
            });

            glowLoop.start();
            waveALoop.start();
            waveBLoop.start();
            sparkLoops.forEach((loop) => loop.start());

            return () => {
                glowLoop.stop();
                waveALoop.stop();
                waveBLoop.stop();
                sparkLoops.forEach((loop) => loop.stop());
            };
        }, [glowAnim, flameWaveA, flameWaveB, sparkAnims]);

        const glowOpacity = glowAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.58, 0.96],
        });
        const waveAScaleY = flameWaveA.interpolate({
            inputRange: [0, 1],
            outputRange: [0.82, 1.18],
        });
        const waveATranslateX = flameWaveA.interpolate({
            inputRange: [0, 1],
            outputRange: [-5, 5],
        });
        const waveBScaleY = flameWaveB.interpolate({
            inputRange: [0, 1],
            outputRange: [1.14, 0.84],
        });
        const waveBTranslateX = flameWaveB.interpolate({
            inputRange: [0, 1],
            outputRange: [6, -6],
        });

        return (
            <TouchableOpacity
                style={styles.fireRowWrap}
                activeOpacity={0.82}
                onPress={onPress}
            >
                {/* Capa base cálida de brasas */}
                <LinearGradient
                    colors={['#2B0707', '#7F1D1D', '#C2410C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />

                {/* Resplandor pulsante del fuego */}
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { opacity: glowOpacity }]}
                >
                    <LinearGradient
                        colors={['rgba(249, 115, 22, 0.14)', 'rgba(234, 88, 12, 0.45)', 'rgba(250, 204, 21, 0.34)']}
                        start={{ x: 0.2, y: 0 }}
                        end={{ x: 0.5, y: 1 }}
                        style={StyleSheet.absoluteFill}
                    />
                </Animated.View>

                {/* Lenguas de fuego SVG animadas en la base */}
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.flameLayer,
                        {
                            transform: [
                                { translateX: waveATranslateX },
                                { scaleY: waveAScaleY },
                            ],
                        },
                    ]}
                >
                    <Svg width="100%" height="100%" viewBox="0 0 360 66" preserveAspectRatio="none">
                        <Defs>
                            <SvgLinearGradient id="fireGradA" x1="0" y1="1" x2="0" y2="0">
                                <Stop offset="0%" stopColor="#FACC15" stopOpacity="0.65" />
                                <Stop offset="50%" stopColor="#F97316" stopOpacity="0.48" />
                                <Stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
                            </SvgLinearGradient>
                        </Defs>
                        <Path
                            d="M 0 66 L 0 38 Q 28 8 56 36 Q 82 6 114 34 Q 146 12 178 36 Q 214 4 248 34 Q 282 10 314 36 Q 340 16 360 34 L 360 66 Z"
                            fill="url(#fireGradA)"
                        />
                    </Svg>
                </Animated.View>

                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.flameLayer,
                        {
                            transform: [
                                { translateX: waveBTranslateX },
                                { scaleY: waveBScaleY },
                            ],
                        },
                    ]}
                >
                    <Svg width="100%" height="100%" viewBox="0 0 360 66" preserveAspectRatio="none">
                        <Defs>
                            <SvgLinearGradient id="fireGradB" x1="0" y1="1" x2="0" y2="0">
                                <Stop offset="0%" stopColor="#FDE047" stopOpacity="0.52" />
                                <Stop offset="55%" stopColor="#EA580C" stopOpacity="0.34" />
                                <Stop offset="100%" stopColor="#DC2626" stopOpacity="0" />
                            </SvgLinearGradient>
                        </Defs>
                        <Path
                            d="M 0 66 L 0 42 Q 38 14 76 40 Q 116 10 156 42 Q 196 14 236 40 Q 278 6 320 40 Q 344 20 360 38 L 360 66 Z"
                            fill="url(#fireGradB)"
                        />
                    </Svg>
                </Animated.View>

                {/* Chispas ascendentes de fuego */}
                {SPARK_SEEDS.map((seed, idx) => {
                    const anim = sparkAnims[idx];
                    const translateY = anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [26, -28],
                    });
                    const opacity = anim.interpolate({
                        inputRange: [0, 0.25, 0.75, 1],
                        outputRange: [0, 0.95, 0.6, 0],
                    });
                    const scale = anim.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0.6, 1.15, 0.35],
                    });
                    return (
                        <Animated.View
                            key={seed.left}
                            pointerEvents="none"
                            style={[
                                styles.sparkDot,
                                {
                                    left: seed.left,
                                    width: seed.size,
                                    height: seed.size,
                                    borderRadius: seed.size / 2,
                                    opacity,
                                    transform: [{ translateY }, { scale }],
                                },
                            ]}
                        />
                    );
                })}

                {/* Contenido principal de la canción #1 */}
                <View style={styles.fireRowContent}>
                    <View style={styles.rankFirstCol}>
                        <Text style={styles.rankFirstNumber}>1</Text>
                    </View>

                    {track.artworkUri ? (
                        <Image
                            source={{ uri: track.artworkUri }}
                            style={styles.fireThumb}
                        />
                    ) : (
                        <View style={styles.fireThumbFallback}>
                            <Music size={18} color="#FDE047" />
                        </View>
                    )}

                    <View style={styles.fireInfoCol}>
                        <View style={styles.fireTitleRow}>
                            <Flame size={14} color="#FACC15" fill="#F97316" />
                            <Text style={styles.fireTrackTitle} numberOfLines={1}>
                                {track.title}
                            </Text>
                        </View>
                        <Text style={styles.fireTrackArtist} numberOfLines={1}>
                            {track.artist}
                        </Text>
                    </View>

                    <View style={styles.firePlayPill}>
                        <Text style={styles.firePlayPillText}>{playsLabel}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    }
);

const styles = StyleSheet.create({
    card: {
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
    },
    chartHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 12,
    },
    chartTitle: {
        fontSize: 15,
        fontWeight: '800',
    },
    chartSubtitle: {
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
    rangeChip: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
    },
    rangeChipText: {
        fontSize: 11.5,
        fontWeight: '800',
    },
    readoutStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginBottom: 10,
    },
    readoutCol: {
        flex: 1,
    },
    readoutDivider: {
        width: 1,
        height: 26,
        marginHorizontal: 10,
    },
    readoutLabel: {
        fontSize: 10.5,
        fontWeight: '600',
    },
    readoutValue: {
        fontSize: 16,
        fontWeight: '800',
        marginTop: 1,
        fontVariant: ['tabular-nums'],
    },
    chartCanvasWrap: {
        width: '100%',
        height: 166,
    },
    chartHintText: {
        fontSize: 11,
        textAlign: 'center',
        marginTop: 4,
        fontWeight: '500',
    },
    donutContainerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    donutSvgWrap: {
        width: 148,
        height: 148,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    donutCenterOverlay: {
        position: 'absolute',
        width: 72,
        alignItems: 'center',
        justifyContent: 'center',
    },
    donutCenterNumber: {
        fontSize: 18,
        fontWeight: '900',
        fontVariant: ['tabular-nums'],
    },
    donutCenterLabel: {
        fontSize: 10,
        fontWeight: '600',
        marginTop: 1,
        textAlign: 'center',
    },
    donutLegendCol: {
        flex: 1,
        gap: 4,
    },
    legendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 8,
    },
    legendDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1,
    },
    legendTitle: {
        flex: 1,
        fontSize: 12,
    },
    legendPct: {
        fontSize: 11.5,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    fireRowWrap: {
        position: 'relative',
        overflow: 'hidden',
        minHeight: 68,
        justifyContent: 'center',
    },
    flameLayer: {
        position: 'absolute',
        left: -10,
        right: -10,
        bottom: -4,
        height: 62,
    },
    sparkDot: {
        position: 'absolute',
        bottom: 8,
        backgroundColor: '#FDE047',
    },
    fireRowContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    rankFirstCol: {
        width: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rankFirstNumber: {
        color: '#FACC15',
        fontSize: 21,
        fontWeight: '900',
        textAlign: 'center',
        textShadowColor: 'rgba(0, 0, 0, 0.72)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 5,
    },
    fireThumb: {
        width: 44,
        height: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: 'rgba(250, 204, 21, 0.78)',
    },
    fireThumbFallback: {
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        borderWidth: 1.5,
        borderColor: 'rgba(250, 204, 21, 0.65)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fireInfoCol: {
        flex: 1,
    },
    fireTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    fireTrackTitle: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: '800',
        textShadowColor: 'rgba(0, 0, 0, 0.55)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    fireTrackArtist: {
        color: 'rgba(255, 237, 213, 0.90)',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
    firePlayPill: {
        backgroundColor: 'rgba(0, 0, 0, 0.42)',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.55)',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    firePlayPillText: {
        color: '#FEF08A',
        fontSize: 11.5,
        fontWeight: '800',
    },
});
