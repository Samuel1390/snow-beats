import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    PanResponder,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ColorFormat = 'RGB' | 'HEX' | 'HSL';

interface ColorPickerModalProps {
    visible: boolean;
    mode: 'solid' | 'gradient';
    initialColor?: string;
    initialGradient?: [string, string];
    onCancel: () => void;
    onConfirmSolid?: (hex: string) => void;
    onConfirmGradient?: (colors: [string, string]) => void;
}

// ==================== CONVERSIONES DE COLOR (HSV / RGB / HEX / HSL) ====================

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return [30, 58, 138];
    return [
        parseInt(clean.substring(0, 2), 16),
        parseInt(clean.substring(2, 4), 16),
        parseInt(clean.substring(4, 6), 16),
    ];
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b]
        .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === rn) h = ((gn - bn) / d) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const hn = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hn < 60) [r, g, b] = [c, x, 0];
    else if (hn < 120) [r, g, b] = [x, c, 0];
    else if (hn < 180) [r, g, b] = [0, c, x];
    else if (hn < 240) [r, g, b] = [0, x, c];
    else if (hn < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
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
        if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, sPct: number, lPct: number): [number, number, number] {
    const hn = (((h % 360) + 360) % 360) / 360;
    const s = clamp(sPct, 0, 100) / 100;
    const l = clamp(lPct, 0, 100) / 100;
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
        Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, hn) * 255),
        Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
    ];
}

export const ColorPickerModal: React.FC<ColorPickerModalProps> = React.memo(
    ({
        visible,
        mode,
        initialColor = '#1E3A8A',
        initialGradient = ['#1E3A8A', '#020617'],
        onCancel,
        onConfirmSolid,
        onConfirmGradient,
    }) => {
        const insets = useSafeAreaInsets();
        const [activeStop, setActiveStop] = useState<0 | 1>(0);
        const [colors, setColors] = useState<[string, string]>([
            initialColor,
            initialGradient[1],
        ]);
        const [hsv, setHsv] = useState<[number, number, number]>([220, 0.78, 0.54]);
        const [format, setFormat] = useState<ColorFormat>('RGB');
        const [isDragging, setIsDragging] = useState(false);

        // Campos editables con validación de formato (RGB por defecto, HEX y HSL)
        const [rgbInputs, setRgbInputs] = useState<[string, string, string]>(['30', '58', '138']);
        const [hexInput, setHexInput] = useState('#1E3A8A');
        const [hslInputs, setHslInputs] = useState<[string, string, string]>(['224', '64', '33']);
        const [validationError, setValidationError] = useState<string | null>(null);

        const svViewRef = useRef<React.ComponentRef<typeof View>>(null);
        const hueViewRef = useRef<React.ComponentRef<typeof View>>(null);
        const svBoundsRef = useRef({ x: 0, y: 0, width: 300, height: 196 });
        const hueBoundsRef = useRef({ x: 0, y: 0, width: 300, height: 34 });
        const hsvRef = useRef(hsv);
        hsvRef.current = hsv;
        const activeStopRef = useRef(activeStop);
        activeStopRef.current = activeStop;

        const syncInputsFromRgb = useCallback((r: number, g: number, b: number) => {
            const hex = rgbToHex(r, g, b);
            const [hh, hs, hl] = rgbToHsl(r, g, b);
            setRgbInputs([String(r), String(g), String(b)]);
            setHexInput(hex);
            setHslInputs([String(hh), String(hs), String(hl)]);
            setValidationError(null);
            return hex;
        }, []);

        const loadHexIntoControls = useCallback(
            (hex: string) => {
                const [r, g, b] = hexToRgb(hex);
                const nextHsv = rgbToHsv(r, g, b);
                setHsv(nextHsv);
                syncInputsFromRgb(r, g, b);
            },
            [syncInputsFromRgb]
        );

        const measurePickers = useCallback(() => {
            svViewRef.current?.measureInWindow((x, y, width, height) => {
                if (width > 0 && height > 0) {
                    svBoundsRef.current = { x, y, width, height };
                }
            });
            hueViewRef.current?.measureInWindow((x, y, width, height) => {
                if (width > 0 && height > 0) {
                    hueBoundsRef.current = { x, y, width, height };
                }
            });
        }, []);

        useEffect(() => {
            if (!visible) return;
            const c0 = mode === 'gradient' ? initialGradient[0] : initialColor;
            const c1 = mode === 'gradient' ? initialGradient[1] : initialColor;
            setColors([c0, c1]);
            setActiveStop(0);
            setFormat('RGB');
            loadHexIntoControls(c0);
            const timer = setTimeout(measurePickers, 120);
            return () => clearTimeout(timer);
        }, [visible, mode, initialColor, initialGradient, loadHexIntoControls, measurePickers]);

        const applyHsvChange = useCallback(
            (nextH: number, nextS: number, nextV: number) => {
                const clampedH = clamp(nextH, 0, 359.9);
                const clampedS = clamp(nextS, 0, 1);
                const clampedV = clamp(nextV, 0, 1);
                setHsv([clampedH, clampedS, clampedV]);
                const [r, g, b] = hsvToRgb(clampedH, clampedS, clampedV);
                const hex = syncInputsFromRgb(r, g, b);
                setColors((prev) =>
                    activeStopRef.current === 0 ? [hex, prev[1]] : [prev[0], hex]
                );
            },
            [syncInputsFromRgb]
        );

        const updateSvFromPage = useCallback(
            (pageX: number, pageY: number) => {
                const b = svBoundsRef.current;
                const s = clamp((pageX - b.x) / Math.max(1, b.width), 0, 1);
                const v = clamp(1 - (pageY - b.y) / Math.max(1, b.height), 0, 1);
                applyHsvChange(hsvRef.current[0], s, v);
            },
            [applyHsvChange]
        );

        const updateHueFromPage = useCallback(
            (pageX: number) => {
                const b = hueBoundsRef.current;
                const ratio = clamp((pageX - b.x) / Math.max(1, b.width), 0, 1);
                applyHsvChange(ratio * 359.9, hsvRef.current[1], hsvRef.current[2]);
            },
            [applyHsvChange]
        );

        // Panel táctil 2D de tonalidad (Claro-Oscuro y Saturación) sin conflicto con ScrollView
        const svPanResponder = useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderTerminationRequest: () => false,
                    onPanResponderGrant: (evt) => {
                        setIsDragging(true);
                        const { pageX, pageY } = evt.nativeEvent;
                        svViewRef.current?.measureInWindow((x, y, width, height) => {
                            if (width > 0 && height > 0) {
                                svBoundsRef.current = { x, y, width, height };
                            }
                            updateSvFromPage(pageX, pageY);
                        });
                    },
                    onPanResponderMove: (evt) => {
                        updateSvFromPage(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
                    },
                    onPanResponderRelease: () => setIsDragging(false),
                    onPanResponderTerminate: () => setIsDragging(false),
                }),
            [updateSvFromPage]
        );

        // Clásica barra cromática arcoíris (Hue 0°..360°) con arrastre continuo en Android
        const huePanResponder = useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderTerminationRequest: () => false,
                    onPanResponderGrant: (evt) => {
                        setIsDragging(true);
                        const { pageX } = evt.nativeEvent;
                        hueViewRef.current?.measureInWindow((x, y, width, height) => {
                            if (width > 0 && height > 0) {
                                hueBoundsRef.current = { x, y, width, height };
                            }
                            updateHueFromPage(pageX);
                        });
                    },
                    onPanResponderMove: (evt) => {
                        updateHueFromPage(evt.nativeEvent.pageX);
                    },
                    onPanResponderRelease: () => setIsDragging(false),
                    onPanResponderTerminate: () => setIsDragging(false),
                }),
            [updateHueFromPage]
        );

        const handleSwitchStop = (stop: 0 | 1) => {
            setActiveStop(stop);
            loadHexIntoControls(colors[stop]);
        };

        // Validación y actualización en vivo para RGB (0..255)
        const handleRgbInput = (channel: 0 | 1 | 2, raw: string) => {
            const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 3);
            const next: [string, string, string] = [...rgbInputs] as [string, string, string];
            next[channel] = cleaned;
            setRgbInputs(next);

            const nums = next.map((v) => (v === '' ? NaN : parseInt(v, 10)));
            if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
                setValidationError('RGB requiere valores enteros entre 0 y 255.');
                return;
            }
            const [r, g, b] = nums;
            const hex = rgbToHex(r, g, b);
            const [hh, hs, hl] = rgbToHsl(r, g, b);
            setHsv(rgbToHsv(r, g, b));
            setHexInput(hex);
            setHslInputs([String(hh), String(hs), String(hl)]);
            setValidationError(null);
            setColors((prev) => (activeStop === 0 ? [hex, prev[1]] : [prev[0], hex]));
        };

        // Validación y actualización en vivo para HEX (#RRGGBB)
        const handleHexInput = (raw: string) => {
            const normalized = (raw.startsWith('#') ? raw : `#${raw}`).toUpperCase().slice(0, 7);
            setHexInput(normalized);
            if (!/^#[0-9A-F]{6}$/.test(normalized)) {
                setValidationError('Formato HEX válido: #RRGGBB (6 dígitos hexadecimales).');
                return;
            }
            const [r, g, b] = hexToRgb(normalized);
            const [hh, hs, hl] = rgbToHsl(r, g, b);
            setHsv(rgbToHsv(r, g, b));
            setRgbInputs([String(r), String(g), String(b)]);
            setHslInputs([String(hh), String(hs), String(hl)]);
            setValidationError(null);
            setColors((prev) => (activeStop === 0 ? [normalized, prev[1]] : [prev[0], normalized]));
        };

        // Validación y actualización en vivo para HSL (H: 0..360, S: 0..100, L: 0..100)
        const handleHslInput = (channel: 0 | 1 | 2, raw: string) => {
            const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 3);
            const next: [string, string, string] = [...hslInputs] as [string, string, string];
            next[channel] = cleaned;
            setHslInputs(next);

            const [hVal, sVal, lVal] = next.map((v) => (v === '' ? NaN : parseInt(v, 10)));
            if (
                Number.isNaN(hVal) ||
                Number.isNaN(sVal) ||
                Number.isNaN(lVal) ||
                hVal < 0 ||
                hVal > 360 ||
                sVal < 0 ||
                sVal > 100 ||
                lVal < 0 ||
                lVal > 100
            ) {
                setValidationError('HSL requiere H (0-360), S (0-100%) y L (0-100%).');
                return;
            }
            const [r, g, b] = hslToRgb(hVal, sVal, lVal);
            const hex = rgbToHex(r, g, b);
            setHsv(rgbToHsv(r, g, b));
            setRgbInputs([String(r), String(g), String(b)]);
            setHexInput(hex);
            setValidationError(null);
            setColors((prev) => (activeStop === 0 ? [hex, prev[1]] : [prev[0], hex]));
        };

        const handleConfirm = () => {
            if (validationError) return;
            if (mode === 'gradient') {
                onConfirmGradient?.([colors[0], colors[1]]);
            } else {
                onConfirmSolid?.(colors[0]);
            }
        };

        if (!visible) return null;

        const pureHueRgb = hsvToRgb(hsv[0], 1, 1);
        const pureHueHex = rgbToHex(pureHueRgb[0], pureHueRgb[1], pureHueRgb[2]);
        const activeHex = colors[activeStop];

        return (
            <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
                <KeyboardAvoidingView
                    style={[
                        styles.screen,
                        {
                            paddingTop: Math.max(insets.top, 26) + 6,
                            paddingBottom: Math.max(insets.bottom, 14) + 8,
                        },
                    ]}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.headerBtn} onPress={onCancel}>
                            <ArrowLeft size={23} color="#FFFFFF" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>
                            {mode === 'gradient' ? 'Gradiente personalizado' : 'Color personalizado'}
                        </Text>
                        <TouchableOpacity
                            style={[styles.checkBtn, Boolean(validationError) && { opacity: 0.4 }]}
                            disabled={Boolean(validationError)}
                            onPress={handleConfirm}
                        >
                            <Check size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        scrollEnabled={!isDragging}
                        contentContainerStyle={styles.body}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        onScrollEndDrag={measurePickers}
                        onMomentumScrollEnd={measurePickers}
                    >
                        {/* 1. Vista previa superior del color o gradiente */}
                        {mode === 'gradient' ? (
                            <View style={styles.previewCard}>
                                <LinearGradient colors={[colors[0], colors[1]]} style={styles.previewSwatch} />
                                <View style={styles.stopTabsRow}>
                                    <TouchableOpacity
                                        style={[styles.stopTab, activeStop === 0 && styles.stopTabActive]}
                                        onPress={() => handleSwitchStop(0)}
                                    >
                                        <View style={[styles.stopDot, { backgroundColor: colors[0] }]} />
                                        <Text style={styles.stopTabText}>Color 1 (Arriba)</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.stopTab, activeStop === 1 && styles.stopTabActive]}
                                        onPress={() => handleSwitchStop(1)}
                                    >
                                        <View style={[styles.stopDot, { backgroundColor: colors[1] }]} />
                                        <Text style={styles.stopTabText}>Color 2 (Abajo)</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.previewCard}>
                                <View style={[styles.previewSwatch, { backgroundColor: activeHex }]} />
                            </View>
                        )}

                        {/* 2. Panel 2D de Tonalidad (Claro-Oscuro y Saturación) visible arriba de inmediato */}
                        <View
                            ref={svViewRef}
                            collapsable={false}
                            style={[styles.svPad, { backgroundColor: pureHueHex }]}
                            onLayout={measurePickers}
                            {...svPanResponder.panHandlers}
                        >
                            <LinearGradient
                                pointerEvents="none"
                                colors={['#FFFFFF', 'rgba(255,255,255,0)']}
                                start={{ x: 0, y: 0.5 }}
                                end={{ x: 1, y: 0.5 }}
                                style={StyleSheet.absoluteFill}
                            />
                            <LinearGradient
                                pointerEvents="none"
                                colors={['rgba(0,0,0,0)', '#000000']}
                                start={{ x: 0.5, y: 0 }}
                                end={{ x: 0.5, y: 1 }}
                                style={StyleSheet.absoluteFill}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.svThumb,
                                    {
                                        left: `${hsv[1] * 100}%`,
                                        top: `${(1 - hsv[2]) * 100}%`,
                                        backgroundColor: activeHex,
                                    },
                                ]}
                            />
                        </View>

                        {/* 3. Clásica Barra Cromática Arcoíris (Hue 0° - 360°) */}
                        <View style={styles.hueSection}>
                            <View style={styles.hueHeaderRow}>
                                <Text style={styles.sliderHint}>Barra cromática</Text>
                                <Text style={styles.hueDegreeText}>{Math.round(hsv[0])}°</Text>
                            </View>
                            <View
                                ref={hueViewRef}
                                collapsable={false}
                                style={styles.hueHitArea}
                                onLayout={measurePickers}
                                {...huePanResponder.panHandlers}
                            >
                                <View pointerEvents="none" style={styles.hueGradientBar}>
                                    <LinearGradient
                                        colors={[
                                            '#FF0000',
                                            '#FFFF00',
                                            '#00FF00',
                                            '#00FFFF',
                                            '#0000FF',
                                            '#FF00FF',
                                            '#FF0000',
                                        ]}
                                        start={{ x: 0, y: 0.5 }}
                                        end={{ x: 1, y: 0.5 }}
                                        style={StyleSheet.absoluteFill}
                                    />
                                </View>
                                <View
                                    pointerEvents="none"
                                    style={[
                                        styles.hueThumb,
                                        {
                                            left: `${(hsv[0] / 360) * 100}%`,
                                            backgroundColor: pureHueHex,
                                        },
                                    ]}
                                />
                            </View>
                        </View>

                        {/* 4. Selector de formato (RGB por defecto, HEX, HSL) + campos editables validados */}
                        <View style={styles.formatCard}>
                            <View style={styles.formatHeaderRow}>
                                <View style={styles.activeColorSummary}>
                                    <View style={[styles.liveDot, { backgroundColor: activeHex }]} />
                                    <Text style={styles.activeHexReadout}>{activeHex}</Text>
                                </View>
                                <View style={styles.formatPills}>
                                    {(['RGB', 'HEX', 'HSL'] as ColorFormat[]).map((fmt) => (
                                        <TouchableOpacity
                                            key={fmt}
                                            style={[
                                                styles.formatPill,
                                                format === fmt && styles.formatPillActive,
                                            ]}
                                            onPress={() => {
                                                setFormat(fmt);
                                                setValidationError(null);
                                            }}
                                        >
                                            <Text
                                                style={[
                                                    styles.formatPillText,
                                                    format === fmt && styles.formatPillTextActive,
                                                ]}
                                            >
                                                {fmt}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>

                            {format === 'RGB' && (
                                <View style={styles.tripleInputsRow}>
                                    {(['R', 'G', 'B'] as const).map((label, idx) => (
                                        <View key={label} style={styles.channelBox}>
                                            <Text style={styles.channelLabel}>{label}</Text>
                                            <TextInput
                                                style={[
                                                    styles.channelInput,
                                                    Boolean(validationError) && styles.inputError,
                                                ]}
                                                keyboardType="number-pad"
                                                value={rgbInputs[idx]}
                                                onChangeText={(txt) => handleRgbInput(idx as 0 | 1 | 2, txt)}
                                                maxLength={3}
                                            />
                                        </View>
                                    ))}
                                </View>
                            )}

                            {format === 'HEX' && (
                                <View style={styles.hexBox}>
                                    <Text style={styles.channelLabel}>HEX</Text>
                                    <TextInput
                                        style={[
                                            styles.channelInput,
                                            Boolean(validationError) && styles.inputError,
                                        ]}
                                        autoCapitalize="characters"
                                        autoCorrect={false}
                                        value={hexInput}
                                        onChangeText={handleHexInput}
                                        maxLength={7}
                                        placeholder="#1E3A8A"
                                        placeholderTextColor="#71717A"
                                    />
                                </View>
                            )}

                            {format === 'HSL' && (
                                <View style={styles.tripleInputsRow}>
                                    {(['H°', 'S%', 'L%'] as const).map((label, idx) => (
                                        <View key={label} style={styles.channelBox}>
                                            <Text style={styles.channelLabel}>{label}</Text>
                                            <TextInput
                                                style={[
                                                    styles.channelInput,
                                                    Boolean(validationError) && styles.inputError,
                                                ]}
                                                keyboardType="number-pad"
                                                value={hslInputs[idx]}
                                                onChangeText={(txt) => handleHslInput(idx as 0 | 1 | 2, txt)}
                                                maxLength={3}
                                            />
                                        </View>
                                    ))}
                                </View>
                            )}

                            {validationError ? (
                                <Text style={styles.errorText}>{validationError}</Text>
                            ) : null}
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#0E0E12',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '700',
        marginLeft: 6,
    },
    checkBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    body: {
        padding: 16,
        paddingBottom: 32,
        gap: 14,
    },
    previewCard: {
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#18181D',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    previewSwatch: {
        height: 62,
        width: '100%',
    },
    stopTabsRow: {
        flexDirection: 'row',
        padding: 8,
        gap: 8,
    },
    stopTab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#23232A',
    },
    stopTabActive: {
        backgroundColor: '#31313D',
        borderWidth: 1,
        borderColor: '#FFFFFF',
    },
    stopDot: {
        width: 15,
        height: 15,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
    },
    stopTabText: {
        color: '#FFFFFF',
        fontSize: 12.5,
        fontWeight: '700',
    },
    svPad: {
        width: '100%',
        height: 196,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.16)',
        position: 'relative',
    },
    svThumb: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 12,
        marginLeft: -12,
        marginTop: -12,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    hueSection: {
        gap: 6,
    },
    hueHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sliderHint: {
        color: '#D4D4D8',
        fontSize: 13,
        fontWeight: '700',
    },
    hueDegreeText: {
        color: '#93C5FD',
        fontSize: 12.5,
        fontWeight: '700',
    },
    hueHitArea: {
        width: '100%',
        height: 36,
        justifyContent: 'center',
        position: 'relative',
    },
    hueGradientBar: {
        width: '100%',
        height: 24,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    hueThumb: {
        position: 'absolute',
        width: 30,
        height: 30,
        borderRadius: 15,
        marginLeft: -15,
        borderWidth: 3.5,
        borderColor: '#FFFFFF',
    },
    formatCard: {
        backgroundColor: '#18181D',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    formatHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    activeColorSummary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    liveDot: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.45)',
    },
    activeHexReadout: {
        color: '#E4E4E7',
        fontSize: 13,
        fontWeight: '700',
    },
    formatPills: {
        flexDirection: 'row',
        backgroundColor: '#25252D',
        borderRadius: 999,
        padding: 3,
    },
    formatPill: {
        paddingHorizontal: 13,
        paddingVertical: 6,
        borderRadius: 999,
    },
    formatPillActive: {
        backgroundColor: '#FFFFFF',
    },
    formatPillText: {
        color: '#A1A1AA',
        fontSize: 12,
        fontWeight: '700',
    },
    formatPillTextActive: {
        color: '#111114',
    },
    tripleInputsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    channelBox: {
        flex: 1,
    },
    hexBox: {
        width: '100%',
    },
    channelLabel: {
        color: '#A1A1AA',
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 4,
    },
    channelInput: {
        backgroundColor: '#101014',
        color: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 15,
        fontWeight: '700',
        borderWidth: 1,
        borderColor: '#32323D',
        textAlign: 'center',
    },
    inputError: {
        borderColor: '#EF4444',
    },
    errorText: {
        color: '#F87171',
        fontSize: 12,
        fontWeight: '600',
    },
});
