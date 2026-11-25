import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import {
    Check,
    ClipboardPaste,
    Copy,
    ExternalLink,
    FileUp,
    Globe,
    Search,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    copyTextToClipboard,
    pickLyricsFile,
    readClipboardText,
} from '../../../modules/snow-metadata';
import {
    buildLetrasComUrl,
    LrclibCandidate,
    parseLyricsText,
    searchLrclibLyrics,
    setCachedTrackLyrics,
} from '../../audio-engine/lyricsParser';
import { updateTrackLyrics } from '../../storage/database/db';
import { resolveIsDarkMode, useTheme } from '../../theme/ThemeContext';
import { useI18n } from '../../i18n';
import { Track } from '../../types/music';

interface LyricsEditorModalProps {
    visible: boolean;
    track: Track;
    initialLyricsText: string;
    titleOverride?: string;
    artistOverride?: string;
    // Si es true guarda directamente en SQLite; si es false devuelve el texto al formulario padre
    saveDirectly?: boolean;
    onClose: () => void;
    onSaved: (rawLyrics: string | null) => void;
}

interface NeutralPalette {
    rootBg: string;
    cardBg: string;
    inputBg: string;
    border: string;
    strongBorder: string;
    text: string;
    muted: string;
    primaryBg: string;
    primaryText: string;
    secondaryBg: string;
    secondaryText: string;
    pillBg: string;
    pillText: string;
}

function getNeutralPalette(isDark: boolean): NeutralPalette {
    if (isDark) {
        return {
            rootBg: '#000000',
            cardBg: '#121212',
            inputBg: '#1C1C1C',
            border: '#2B2B2B',
            strongBorder: '#3F3F46',
            text: '#FFFFFF',
            muted: '#A1A1AA',
            primaryBg: '#FFFFFF',
            primaryText: '#000000',
            secondaryBg: '#1C1C1C',
            secondaryText: '#FFFFFF',
            pillBg: '#262626',
            pillText: '#E4E4E7',
        };
    }
    return {
        rootBg: '#FFFFFF',
        cardBg: '#F4F4F5',
        inputBg: '#FFFFFF',
        border: '#D4D4D8',
        strongBorder: '#A1A1AA',
        text: '#000000',
        muted: '#52525B',
        primaryBg: '#000000',
        primaryText: '#FFFFFF',
        secondaryBg: '#FFFFFF',
        secondaryText: '#000000',
        pillBg: '#E4E4E7',
        pillText: '#18181B',
    };
}

function formatSec(sec: number): string {
    if (!sec || sec <= 0 || !Number.isFinite(sec)) return '--:--';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// Overlay neutro de pantalla completa (sin Modal nativo anidado para evitar cierres/bloqueos en Android Fabric)
const LyricsEditorContent: React.FC<Omit<LyricsEditorModalProps, 'visible'>> = React.memo(
    ({
        track,
        initialLyricsText,
        titleOverride,
        artistOverride,
        saveDirectly = true,
        onClose,
        onSaved,
    }) => {
        const insets = useSafeAreaInsets();
        const { theme } = useTheme();
        const { t } = useI18n();
        const systemScheme = useColorScheme();
        const isDark = resolveIsDarkMode(theme.mode, systemScheme);
        const ui = useMemo(() => getNeutralPalette(isDark), [isDark]);

        const effectiveTitle = (titleOverride ?? track.title).trim();
        const effectiveArtist = (artistOverride ?? track.artist).trim();

        const [draftText, setDraftText] = useState(initialLyricsText);
        const [saving, setSaving] = useState(false);
        const [importingFile, setImportingFile] = useState(false);
        const [statusNotice, setStatusNotice] = useState<string | null>(null);

        const [searchingAuto, setSearchingAuto] = useState(false);
        const [autoError, setAutoError] = useState<string | null>(null);
        const [autoResults, setAutoResults] = useState<LrclibCandidate[]>([]);

        // Solo reinicia el borrador si cambia de canción mientras el editor está abierto
        const lastTrackIdRef = useRef(track.id);
        useEffect(() => {
            if (lastTrackIdRef.current !== track.id) {
                lastTrackIdRef.current = track.id;
                setDraftText(initialLyricsText);
                setStatusNotice(null);
                setAutoError(null);
                setAutoResults([]);
            }
        }, [track.id, initialLyricsText]);

        const letrasInfo = useMemo(
            () => buildLetrasComUrl(effectiveArtist, effectiveTitle),
            [effectiveArtist, effectiveTitle]
        );

        const parsedPreview = useMemo(() => parseLyricsText(draftText), [draftText]);
        const hadInitialLyrics = initialLyricsText.trim().length > 0;

        const handleOpenLetrasBrowser = useCallback(async () => {
            try {
                await Linking.openURL(letrasInfo.url);
            } catch {
                Alert.alert(
                    t('lyrics.browserUnavailable'),
                    t('lyrics.browserUnavailableBody', { url: letrasInfo.displayUrl })
                );
            }
        }, [letrasInfo, t]);

        const handleAutoSearchLrclib = useCallback(async () => {
            setSearchingAuto(true);
            setAutoError(null);
            setAutoResults([]);
            try {
                const candidates = await searchLrclibLyrics(
                    effectiveTitle,
                    effectiveArtist,
                    track.duration
                );
                if (candidates.length === 0) {
                    setAutoError(t('lyrics.lrclibNotFound'));
                } else {
                    setAutoResults(candidates);
                }
            } catch {
                setAutoError(t('lyrics.lrclibNetworkError'));
            } finally {
                setSearchingAuto(false);
            }
        }, [effectiveTitle, effectiveArtist, track.duration, t]);

        const handleApplyCandidate = useCallback(
            (candidate: LrclibCandidate) => {
                const chosen = candidate.syncedLyrics || candidate.plainLyrics || '';
                if (!chosen) return;
                setDraftText(chosen);
                setStatusNotice(
                    candidate.syncedLyrics
                        ? t('lyrics.lrclibLoadedSynced', { track: candidate.trackName })
                        : t('lyrics.lrclibLoadedPlain', { track: candidate.trackName })
                );
                setAutoResults([]);
                setAutoError(null);
            },
            [t]
        );

        const handleImportLyricsFile = useCallback(async () => {
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.lrc,.txt,text/plain';
                input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                        const content = (await file.text()).replace(/^\uFEFF/, '').trim();
                        if (!content) {
                            Alert.alert(t('lyrics.emptyFileTitle'), t('lyrics.emptyFileBody'));
                            return;
                        }
                        setDraftText(content);
                        setStatusNotice(t('lyrics.importedNotice', { name: file.name }));
                    } catch {
                        Alert.alert(t('common.error'), t('editTrack.importFailedBody'));
                    }
                };
                input.click();
                return;
            }

            setImportingFile(true);
            try {
                const result = await pickLyricsFile();
                if (result.cancelled) return;
                if (!result.ok || !result.content) {
                    Alert.alert(
                        t('editTrack.importFailedTitle'),
                        result.errorMessage || t('lyrics.readFileError')
                    );
                    return;
                }
                setDraftText(result.content);
                setStatusNotice(
                    t('lyrics.importedNotice', {
                        name: result.fileName || t('lyrics.importedDefaultName'),
                    })
                );
            } finally {
                setImportingFile(false);
            }
        }, [t]);

        const handlePasteClipboard = useCallback(async () => {
            try {
                let pasted = '';
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                    pasted = await navigator.clipboard.readText();
                } else {
                    pasted = await readClipboardText();
                }
                const clean = pasted.replace(/^\uFEFF/, '').trim();
                if (!clean) {
                    Alert.alert(t('lyrics.clipboardEmptyTitle'), t('lyrics.clipboardEmptyBody'));
                    return;
                }
                setDraftText(clean);
                setStatusNotice(t('lyrics.pastedNotice'));
            } catch {
                Alert.alert(t('common.error'), t('lyrics.clipboardError'));
            }
        }, [t]);

        const handleCopyLyrics = useCallback(async () => {
            const clean = draftText.trim();
            if (!clean) return;
            try {
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                    await navigator.clipboard.writeText(clean);
                } else {
                    await copyTextToClipboard(clean);
                }
                setStatusNotice(t('lyrics.copiedNotice'));
            } catch {
                Alert.alert(t('common.error'), t('lyrics.copyError'));
            }
        }, [draftText, t]);

        const handleSave = useCallback(async () => {
            const cleaned = draftText.trim();
            const finalText = cleaned.length > 0 ? cleaned : null;

            if (!saveDirectly) {
                onSaved(finalText);
                onClose();
                return;
            }

            setSaving(true);
            try {
                await updateTrackLyrics(track.id, finalText);
                setCachedTrackLyrics(track.id, finalText);
                onSaved(finalText);
                onClose();
            } catch {
                Alert.alert(t('common.error'), t('lyrics.saveError'));
            } finally {
                setSaving(false);
            }
        }, [draftText, saveDirectly, track.id, onSaved, onClose, t]);

        const handleClearLyrics = useCallback(() => {
            setDraftText('');
            setStatusNotice(null);
        }, []);

        return (
            <View style={[styles.overlayRoot, { backgroundColor: ui.rootBg }]}>
                <KeyboardAvoidingView
                    style={styles.flexOne}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View
                        style={[
                            styles.container,
                            {
                                paddingTop: Math.max(insets.top, 26) + 6,
                                paddingBottom: Math.max(insets.bottom, 14) + 8,
                            },
                        ]}
                    >
                        {/* Cabecera superior monocromática */}
                        <View style={[styles.header, { borderBottomColor: ui.border }]}>
                            <TouchableOpacity
                                style={[
                                    styles.iconBtn,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                                onPress={onClose}
                            >
                                <X size={20} color={ui.text} />
                            </TouchableOpacity>
                            <View style={styles.headerMeta}>
                                <Text style={[styles.headerTitle, { color: ui.text }]} numberOfLines={1}>
                                    {hadInitialLyrics
                                        ? t('lyrics.editOrReplace')
                                        : t('lyrics.addTitle')}
                                </Text>
                                <Text style={[styles.headerSub, { color: ui.muted }]} numberOfLines={1}>
                                    {effectiveTitle} · {effectiveArtist}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={[
                                    styles.saveBtn,
                                    { backgroundColor: ui.primaryBg },
                                    saving && { opacity: 0.6 },
                                ]}
                                disabled={saving}
                                activeOpacity={0.85}
                                onPress={handleSave}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color={ui.primaryText} />
                                ) : (
                                    <>
                                        <Check size={16} color={ui.primaryText} />
                                        <Text style={[styles.saveBtnText, { color: ui.primaryText }]}>
                                            {t('common.save')}
                                        </Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.scrollContent}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            {/* Bloque 1: Enlace directo https://www.letras.com/{artista}/{titulo}/ + botón Buscar */}
                            <View
                                style={[
                                    styles.card,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                            >
                                <View style={styles.cardTitleRow}>
                                    <Globe size={16} color={ui.text} />
                                    <Text style={[styles.cardTitle, { color: ui.text }]}>
                                        {t('lyrics.searchOnLetras')}
                                    </Text>
                                </View>
                                <Text style={[styles.cardHint, { color: ui.muted }]}>
                                    {t('lyrics.searchOnLetrasHint')}
                                </Text>
                                <View style={styles.urlRow}>
                                    <View
                                        style={[
                                            styles.urlPill,
                                            { backgroundColor: ui.inputBg, borderColor: ui.border },
                                        ]}
                                    >
                                        <Text
                                            style={[styles.urlText, { color: ui.text }]}
                                            numberOfLines={1}
                                        >
                                            {letrasInfo.displayUrl}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[
                                            styles.primaryActionBtn,
                                            { backgroundColor: ui.primaryBg },
                                        ]}
                                        activeOpacity={0.85}
                                        onPress={handleOpenLetrasBrowser}
                                    >
                                        <Search size={15} color={ui.primaryText} />
                                        <Text
                                            style={[
                                                styles.primaryActionBtnText,
                                                { color: ui.primaryText },
                                            ]}
                                        >
                                            {t('common.search')}
                                        </Text>
                                        <ExternalLink size={13} color={ui.primaryText} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Bloque 2: LRCLIB automático + Importar archivo .lrc/.txt */}
                            <View style={styles.actionsRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.actionCardBtn,
                                        {
                                            backgroundColor: ui.cardBg,
                                            borderColor: ui.strongBorder,
                                        },
                                        searchingAuto && { opacity: 0.7 },
                                    ]}
                                    activeOpacity={0.85}
                                    disabled={searchingAuto}
                                    onPress={handleAutoSearchLrclib}
                                >
                                    {searchingAuto ? (
                                        <ActivityIndicator size="small" color={ui.text} />
                                    ) : (
                                        <Sparkles size={17} color={ui.text} />
                                    )}
                                    <Text style={[styles.actionCardTitle, { color: ui.text }]}>
                                        {t('lyrics.autoSearchTitle')}
                                    </Text>
                                    <Text style={[styles.actionCardSub, { color: ui.muted }]}>
                                        {t('lyrics.autoSearchSub')}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.actionCardBtn,
                                        {
                                            backgroundColor: ui.cardBg,
                                            borderColor: ui.border,
                                        },
                                        importingFile && { opacity: 0.7 },
                                    ]}
                                    activeOpacity={0.85}
                                    disabled={importingFile}
                                    onPress={handleImportLyricsFile}
                                >
                                    {importingFile ? (
                                        <ActivityIndicator size="small" color={ui.text} />
                                    ) : (
                                        <FileUp size={17} color={ui.text} />
                                    )}
                                    <Text style={[styles.actionCardTitle, { color: ui.text }]}>
                                        {t('lyrics.importFileTitle')}
                                    </Text>
                                    <Text style={[styles.actionCardSub, { color: ui.muted }]}>
                                        {t('lyrics.importFileSub')}
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Avisos o coincidencias automáticas de LRCLIB */}
                            {autoError && (
                                <View
                                    style={[
                                        styles.infoBanner,
                                        { backgroundColor: ui.cardBg, borderColor: ui.strongBorder },
                                    ]}
                                >
                                    <Text style={[styles.infoBannerText, { color: ui.muted }]}>
                                        {autoError}
                                    </Text>
                                </View>
                            )}

                            {autoResults.length > 0 && (
                                <View
                                    style={[
                                        styles.card,
                                        { backgroundColor: ui.cardBg, borderColor: ui.border },
                                    ]}
                                >
                                    <Text style={[styles.cardTitle, { color: ui.text }]}>
                                        {t('lyrics.matchesFound')}
                                    </Text>
                                    <View style={styles.resultsList}>
                                        {autoResults.map((cand) => (
                                            <TouchableOpacity
                                                key={cand.id}
                                                style={[
                                                    styles.resultItem,
                                                    {
                                                        backgroundColor: ui.inputBg,
                                                        borderColor: ui.border,
                                                    },
                                                ]}
                                                activeOpacity={0.8}
                                                onPress={() => handleApplyCandidate(cand)}
                                            >
                                                <View style={styles.resultMeta}>
                                                    <Text
                                                        style={[styles.resultTitle, { color: ui.text }]}
                                                        numberOfLines={1}
                                                    >
                                                        {cand.trackName}
                                                    </Text>
                                                    <Text
                                                        style={[styles.resultSub, { color: ui.muted }]}
                                                        numberOfLines={1}
                                                    >
                                                        {cand.artistName}
                                                        {cand.duration > 0
                                                            ? ` · ${formatSec(cand.duration)}`
                                                            : ''}
                                                    </Text>
                                                </View>
                                                <View
                                                    style={[
                                                        styles.typeTag,
                                                        cand.syncedLyrics
                                                            ? { backgroundColor: ui.primaryBg }
                                                            : {
                                                                  backgroundColor: ui.pillBg,
                                                                  borderWidth: 1,
                                                                  borderColor: ui.border,
                                                              },
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.typeTagText,
                                                            {
                                                                color: cand.syncedLyrics
                                                                    ? ui.primaryText
                                                                    : ui.pillText,
                                                            },
                                                        ]}
                                                    >
                                                        {cand.syncedLyrics ? 'LRC Sync' : 'Manual'}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            )}

                            {/* Bloque 3: Editor / Pegado y copiado directo de letras */}
                            <View
                                style={[
                                    styles.card,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                            >
                                <View style={styles.editorTopRow}>
                                    <View style={styles.statusCol}>
                                        <Text style={[styles.cardTitle, { color: ui.text }]}>
                                            {t('lyrics.textOrLrc')}
                                        </Text>
                                        <Text style={[styles.statusPillText, { color: ui.muted }]}>
                                            {parsedPreview.lines.length === 0
                                                ? t('lyrics.emptyContent')
                                                : parsedPreview.isSynced
                                                ? t('lyrics.syncedPreview', {
                                                      count: parsedPreview.lines.length,
                                                  })
                                                : t('lyrics.manualPreview', {
                                                      count: parsedPreview.lines.length,
                                                  })}
                                        </Text>
                                    </View>
                                </View>

                                {/* Acciones rápidas de portapapeles para editar letras manualmente */}
                                <View style={styles.clipboardRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.smallNeutralBtn,
                                            {
                                                backgroundColor: ui.secondaryBg,
                                                borderColor: ui.border,
                                            },
                                        ]}
                                        activeOpacity={0.8}
                                        onPress={handlePasteClipboard}
                                    >
                                        <ClipboardPaste size={14} color={ui.secondaryText} />
                                        <Text
                                            style={[
                                                styles.smallNeutralBtnText,
                                                { color: ui.secondaryText },
                                            ]}
                                        >
                                            {t('common.paste')}
                                        </Text>
                                    </TouchableOpacity>

                                    {draftText.trim().length > 0 && (
                                        <>
                                            <TouchableOpacity
                                                style={[
                                                    styles.smallNeutralBtn,
                                                    {
                                                        backgroundColor: ui.secondaryBg,
                                                        borderColor: ui.border,
                                                    },
                                                ]}
                                                activeOpacity={0.8}
                                                onPress={handleCopyLyrics}
                                            >
                                                <Copy size={14} color={ui.secondaryText} />
                                                <Text
                                                    style={[
                                                        styles.smallNeutralBtnText,
                                                        { color: ui.secondaryText },
                                                    ]}
                                                >
                                                    {t('common.copy')}
                                                </Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={[
                                                    styles.smallNeutralBtn,
                                                    {
                                                        backgroundColor: ui.secondaryBg,
                                                        borderColor: ui.strongBorder,
                                                    },
                                                ]}
                                                activeOpacity={0.8}
                                                onPress={handleClearLyrics}
                                            >
                                                <Trash2 size={14} color={ui.muted} />
                                                <Text
                                                    style={[
                                                        styles.smallNeutralBtnText,
                                                        { color: ui.muted },
                                                    ]}
                                                >
                                                    {t('common.remove')}
                                                </Text>
                                            </TouchableOpacity>
                                        </>
                                    )}
                                </View>

                                {statusNotice && (
                                    <View
                                        style={[
                                            styles.noticePill,
                                            { backgroundColor: ui.pillBg, borderColor: ui.border },
                                        ]}
                                    >
                                        <Check size={13} color={ui.text} />
                                        <Text
                                            style={[styles.noticePillText, { color: ui.pillText }]}
                                            numberOfLines={1}
                                        >
                                            {statusNotice}
                                        </Text>
                                    </View>
                                )}

                                <TextInput
                                    style={[
                                        styles.lyricsInput,
                                        {
                                            backgroundColor: ui.inputBg,
                                            borderColor: ui.border,
                                            color: ui.text,
                                        },
                                    ]}
                                    value={draftText}
                                    onChangeText={setDraftText}
                                    placeholder={t('lyrics.inputPlaceholder')}
                                    placeholderTextColor={ui.muted}
                                    multiline
                                    textAlignVertical="top"
                                    autoCorrect={false}
                                />
                            </View>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </View>
        );
    }
);

export const LyricsEditorModal: React.FC<LyricsEditorModalProps> = React.memo(
    ({ visible, ...rest }) => {
        // Desmonta completamente al cerrar para evitar bloqueos de estado o de gestos en Android
        if (!visible) return null;
        return <LyricsEditorContent {...rest} />;
    }
);

const styles = StyleSheet.create({
    overlayRoot: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 60,
        elevation: 32,
    },
    flexOne: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        gap: 10,
        borderBottomWidth: 1,
    },
    iconBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerMeta: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 16.5,
        fontWeight: '800',
    },
    headerSub: {
        fontSize: 12.5,
        marginTop: 1,
    },
    saveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 10,
    },
    saveBtnText: {
        fontSize: 13.5,
        fontWeight: '800',
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        gap: 14,
        paddingBottom: 32,
    },
    card: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 14,
        gap: 10,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardTitle: {
        fontSize: 14.5,
        fontWeight: '700',
    },
    cardHint: {
        fontSize: 12.5,
        lineHeight: 18,
    },
    urlRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    urlPill: {
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 11,
        paddingVertical: 10,
    },
    urlText: {
        fontSize: 12,
        fontWeight: '600',
    },
    primaryActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 10,
    },
    primaryActionBtnText: {
        fontSize: 13,
        fontWeight: '800',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    actionCardBtn: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        padding: 13,
        gap: 4,
    },
    actionCardTitle: {
        fontSize: 13.5,
        fontWeight: '700',
        marginTop: 2,
    },
    actionCardSub: {
        fontSize: 11.5,
    },
    infoBanner: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
    },
    infoBannerText: {
        fontSize: 12.5,
        lineHeight: 18,
    },
    resultsList: {
        gap: 8,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 11,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    resultMeta: {
        flex: 1,
        gap: 2,
    },
    resultTitle: {
        fontSize: 13.5,
        fontWeight: '700',
    },
    resultSub: {
        fontSize: 12,
    },
    typeTag: {
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    typeTagText: {
        fontSize: 11,
        fontWeight: '800',
    },
    editorTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    statusCol: {
        flex: 1,
        gap: 2,
    },
    statusPillText: {
        fontSize: 12,
        fontWeight: '600',
    },
    clipboardRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    smallNeutralBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderWidth: 1,
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 9,
    },
    smallNeutralBtnText: {
        fontSize: 12,
        fontWeight: '700',
    },
    noticePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    noticePillText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
    },
    lyricsInput: {
        minHeight: 220,
        maxHeight: 360,
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        fontSize: 13.5,
        lineHeight: 20,
    },
});
