import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    Check,
    ExternalLink,
    FileUp,
    Globe,
    Search,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickLyricsFile } from '../../../modules/snow-metadata';
import {
    buildLetrasComUrl,
    LrclibCandidate,
    parseLyricsText,
    searchLrclibLyrics,
    setCachedTrackLyrics,
} from '../../audio-engine/lyricsParser';
import { updateTrackLyrics } from '../../storage/database/db';
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

function formatSec(sec: number): string {
    if (!sec || sec <= 0 || !Number.isFinite(sec)) return '--:--';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// Editor e importador completo de letras: letras.com en navegador, LRCLIB automático, archivo .lrc/.txt y pegado manual
export const LyricsEditorModal: React.FC<LyricsEditorModalProps> = React.memo(
    ({
        visible,
        track,
        initialLyricsText,
        titleOverride,
        artistOverride,
        saveDirectly = true,
        onClose,
        onSaved,
    }) => {
        const insets = useSafeAreaInsets();
        const effectiveTitle = (titleOverride ?? track.title).trim();
        const effectiveArtist = (artistOverride ?? track.artist).trim();

        const [draftText, setDraftText] = useState(initialLyricsText);
        const [saving, setSaving] = useState(false);
        const [importingFile, setImportingFile] = useState(false);
        const [importedFileName, setImportedFileName] = useState<string | null>(null);

        const [searchingAuto, setSearchingAuto] = useState(false);
        const [autoError, setAutoError] = useState<string | null>(null);
        const [autoResults, setAutoResults] = useState<LrclibCandidate[]>([]);

        useEffect(() => {
            if (!visible) return;
            setDraftText(initialLyricsText);
            setImportedFileName(null);
            setAutoError(null);
            setAutoResults([]);
        }, [visible, initialLyricsText, track.id]);

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
                    'Navegador no disponible',
                    `No se pudo abrir ${letrasInfo.displayUrl} automáticamente.`
                );
            }
        }, [letrasInfo]);

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
                    setAutoError(
                        'No se encontraron coincidencias automáticas en LRCLIB. Puedes buscar en letras.com o pegar la letra.'
                    );
                } else {
                    setAutoResults(candidates);
                }
            } catch {
                setAutoError(
                    'No se pudo conectar con LRCLIB (revisa tu internet). Usa letras.com o importa un archivo .lrc/.txt.'
                );
            } finally {
                setSearchingAuto(false);
            }
        }, [effectiveTitle, effectiveArtist, track.duration]);

        const handleApplyCandidate = useCallback((candidate: LrclibCandidate) => {
            const chosen = candidate.syncedLyrics || candidate.plainLyrics || '';
            if (!chosen) return;
            setDraftText(chosen);
            setImportedFileName(
                candidate.syncedLyrics
                    ? `LRCLIB (.lrc sincronizada) · ${candidate.trackName}`
                    : `LRCLIB (texto plano) · ${candidate.trackName}`
            );
            setAutoResults([]);
            setAutoError(null);
        }, []);

        const handleImportLyricsFile = useCallback(async () => {
            // En web usa un input file estándar del navegador
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
                            Alert.alert('Archivo vacío', 'El archivo seleccionado no contiene texto.');
                            return;
                        }
                        setDraftText(content);
                        setImportedFileName(file.name);
                    } catch {
                        Alert.alert('Error', 'No se pudo leer el archivo seleccionado.');
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
                        'Importación fallida',
                        result.errorMessage || 'No se pudo leer el archivo .lrc o .txt.'
                    );
                    return;
                }
                setDraftText(result.content);
                setImportedFileName(result.fileName || 'Archivo importado');
            } finally {
                setImportingFile(false);
            }
        }, []);

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
                Alert.alert('Error', 'No se pudieron guardar las letras en la base de datos local.');
            } finally {
                setSaving(false);
            }
        }, [draftText, saveDirectly, track.id, onSaved, onClose]);

        const handleClearLyrics = useCallback(() => {
            setDraftText('');
            setImportedFileName(null);
        }, []);

        return (
            <Modal
                visible={visible}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={onClose}
            >
                <KeyboardAvoidingView
                    style={styles.root}
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
                        {/* Cabecera superior */}
                        <View style={styles.header}>
                            <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
                                <X size={22} color="#FFFFFF" />
                            </TouchableOpacity>
                            <View style={styles.headerMeta}>
                                <Text style={styles.headerTitle} numberOfLines={1}>
                                    {hadInitialLyrics ? 'Editar o reemplazar letras' : 'Agregar letras'}
                                </Text>
                                <Text style={styles.headerSub} numberOfLines={1}>
                                    {effectiveTitle} · {effectiveArtist}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                                disabled={saving}
                                activeOpacity={0.85}
                                onPress={handleSave}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Check size={16} color="#FFFFFF" />
                                        <Text style={styles.saveBtnText}>Guardar</Text>
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
                            {/* Bloque 1: Enlace directo www.letras.com/{artista}/ + botón Buscar */}
                            <View style={styles.card}>
                                <View style={styles.cardTitleRow}>
                                    <Globe size={16} color="#60A5FA" />
                                    <Text style={styles.cardTitle}>Buscar en letras.com</Text>
                                </View>
                                <Text style={styles.cardHint}>
                                    Abre tu navegador en la página del artista para buscar, copiar o
                                    descargar la letra e importarla aquí.
                                </Text>
                                <View style={styles.urlRow}>
                                    <View style={styles.urlPill}>
                                        <Text style={styles.urlText} numberOfLines={1}>
                                            {letrasInfo.displayUrl}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={styles.navyBtn}
                                        activeOpacity={0.85}
                                        onPress={handleOpenLetrasBrowser}
                                    >
                                        <Search size={15} color="#FFFFFF" />
                                        <Text style={styles.navyBtnText}>Buscar</Text>
                                        <ExternalLink size={13} color="#BFDBFE" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Bloque 2: Importación rápida (LRCLIB automático + Archivo .lrc/.txt) */}
                            <View style={styles.actionsRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.actionCardBtn,
                                        styles.actionCardPrimary,
                                        searchingAuto && { opacity: 0.7 },
                                    ]}
                                    activeOpacity={0.85}
                                    disabled={searchingAuto}
                                    onPress={handleAutoSearchLrclib}
                                >
                                    {searchingAuto ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <Sparkles size={17} color="#93C5FD" />
                                    )}
                                    <Text style={styles.actionCardTitle}>Buscar auto (.lrc)</Text>
                                    <Text style={styles.actionCardSub}>Sincronizadas en LRCLIB</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.actionCardBtn,
                                        importingFile && { opacity: 0.7 },
                                    ]}
                                    activeOpacity={0.85}
                                    disabled={importingFile}
                                    onPress={handleImportLyricsFile}
                                >
                                    {importingFile ? (
                                        <ActivityIndicator size="small" color="#60A5FA" />
                                    ) : (
                                        <FileUp size={17} color="#60A5FA" />
                                    )}
                                    <Text style={styles.actionCardTitle}>Importar archivo</Text>
                                    <Text style={styles.actionCardSub}>Formato .lrc o .txt</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Resultados automáticos de LRCLIB (el usuario elige cuál aplicar) */}
                            {autoError && (
                                <View style={styles.infoBanner}>
                                    <Text style={styles.infoBannerText}>{autoError}</Text>
                                </View>
                            )}

                            {autoResults.length > 0 && (
                                <View style={styles.card}>
                                    <Text style={styles.cardTitle}>
                                        Coincidencias encontradas (toca para cargar)
                                    </Text>
                                    <View style={styles.resultsList}>
                                        {autoResults.map((cand) => (
                                            <TouchableOpacity
                                                key={cand.id}
                                                style={styles.resultItem}
                                                activeOpacity={0.8}
                                                onPress={() => handleApplyCandidate(cand)}
                                            >
                                                <View style={styles.resultMeta}>
                                                    <Text style={styles.resultTitle} numberOfLines={1}>
                                                        {cand.trackName}
                                                    </Text>
                                                    <Text style={styles.resultSub} numberOfLines={1}>
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
                                                            ? styles.typeTagSynced
                                                            : styles.typeTagPlain,
                                                    ]}
                                                >
                                                    <Text style={styles.typeTagText}>
                                                        {cand.syncedLyrics ? 'LRC Sync' : 'Plana'}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            )}

                            {/* Bloque 3: Editor / Pegado directo de letras */}
                            <View style={styles.card}>
                                <View style={styles.editorTopRow}>
                                    <View style={styles.statusCol}>
                                        <Text style={styles.cardTitle}>Texto / archivo .lrc</Text>
                                        <Text style={styles.statusPillText}>
                                            {parsedPreview.lines.length === 0
                                                ? 'Sin contenido'
                                                : parsedPreview.isSynced
                                                ? `Sincronizada en tiempo real · ${parsedPreview.lines.length} líneas`
                                                : `Letra plana · ${parsedPreview.lines.length} líneas`}
                                        </Text>
                                    </View>
                                    {draftText.trim().length > 0 && (
                                        <TouchableOpacity
                                            style={styles.clearBtn}
                                            onPress={handleClearLyrics}
                                        >
                                            <Trash2 size={14} color="#FCA5A5" />
                                            <Text style={styles.clearBtnText}>Quitar</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {importedFileName && (
                                    <View style={styles.importedPill}>
                                        <Check size={13} color="#86EFAC" />
                                        <Text style={styles.importedPillText} numberOfLines={1}>
                                            Cargado: {importedFileName}
                                        </Text>
                                    </View>
                                )}

                                <TextInput
                                    style={styles.lyricsInput}
                                    value={draftText}
                                    onChangeText={setDraftText}
                                    placeholder={
                                        'Pega aquí la letra copiada de letras.com o contenido .lrc:\n[00:12.40] Primera línea...\n[00:16.80] Segunda línea...'
                                    }
                                    placeholderTextColor="#64748B"
                                    multiline
                                    textAlignVertical="top"
                                    autoCorrect={false}
                                />
                            </View>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A1122',
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
        borderBottomColor: 'rgba(59,130,246,0.16)',
    },
    iconBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.08)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerMeta: {
        flex: 1,
    },
    headerTitle: {
        color: '#FFFFFF',
        fontSize: 16.5,
        fontWeight: '800',
    },
    headerSub: {
        color: '#94A3B8',
        fontSize: 12.5,
        marginTop: 1,
    },
    saveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 10,
    },
    saveBtnText: {
        color: '#FFFFFF',
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
        backgroundColor: '#0F1A33',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.2)',
        padding: 14,
        gap: 10,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardTitle: {
        color: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: '700',
    },
    cardHint: {
        color: '#94A3B8',
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
        backgroundColor: '#091020',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.22)',
        paddingHorizontal: 11,
        paddingVertical: 10,
    },
    urlText: {
        color: '#93C5FD',
        fontSize: 12.5,
        fontWeight: '600',
    },
    navyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 10,
    },
    navyBtnText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '800',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    actionCardBtn: {
        flex: 1,
        backgroundColor: '#0F1A33',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.22)',
        padding: 13,
        gap: 4,
    },
    actionCardPrimary: {
        backgroundColor: '#13244C',
        borderColor: 'rgba(59,130,246,0.42)',
    },
    actionCardTitle: {
        color: '#FFFFFF',
        fontSize: 13.5,
        fontWeight: '700',
        marginTop: 2,
    },
    actionCardSub: {
        color: '#94A3B8',
        fontSize: 11.5,
    },
    infoBanner: {
        backgroundColor: 'rgba(30,58,138,0.28)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.3)',
        padding: 12,
    },
    infoBannerText: {
        color: '#BFDBFE',
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
        backgroundColor: '#0A1224',
        borderRadius: 11,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.18)',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    resultMeta: {
        flex: 1,
        gap: 2,
    },
    resultTitle: {
        color: '#FFFFFF',
        fontSize: 13.5,
        fontWeight: '700',
    },
    resultSub: {
        color: '#94A3B8',
        fontSize: 12,
    },
    typeTag: {
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    typeTagSynced: {
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#3B82F6',
    },
    typeTagPlain: {
        backgroundColor: 'rgba(148,163,184,0.18)',
    },
    typeTagText: {
        color: '#FFFFFF',
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
        color: '#60A5FA',
        fontSize: 12,
        fontWeight: '600',
    },
    clearBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(239,68,68,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(248,113,113,0.35)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    clearBtnText: {
        color: '#FCA5A5',
        fontSize: 12,
        fontWeight: '700',
    },
    importedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(34,197,94,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(74,222,128,0.35)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    importedPillText: {
        flex: 1,
        color: '#86EFAC',
        fontSize: 12,
        fontWeight: '600',
    },
    lyricsInput: {
        minHeight: 220,
        maxHeight: 360,
        backgroundColor: '#080F1E',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.22)',
        padding: 12,
        color: '#F8FAFC',
        fontSize: 13.5,
        lineHeight: 20,
    },
});
