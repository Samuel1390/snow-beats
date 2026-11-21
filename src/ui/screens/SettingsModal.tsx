import React, { useEffect, useState } from 'react';
import {
    Alert,
    Image,
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
import * as ImagePicker from 'expo-image-picker';
import {
    ArrowLeft,
    BarChart3,
    Check,
    ChevronRight,
    FolderDown,
    Globe,
    ImagePlus,
    Info,
    Mail,
    Palette,
    RotateCcw,
    Timer,
    Trash2,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { emptyTrash, getDeletedTracks, restoreTrack } from '../../storage/database/db';
import {
    DEFAULT_AUDIO_DOWNLOAD_PATH,
    DEFAULT_VIDEO_DOWNLOAD_PATH,
    getDownloadPaths,
    resetDownloadPaths,
    saveDownloadPaths,
} from '../../storage/downloadSettings';
import { sendEmailWithAttachments } from '../../../modules/snow-metadata';
import { Track } from '../../types/music';
import { ThemeSettingsView } from '../components/ThemeSettingsView';

type SettingsSection =
    | 'theme'
    | 'download_paths'
    | 'timer'
    | 'stats'
    | 'trash'
    | 'language'
    | 'report'
    | 'about';

interface SettingsModalProps {
    visible: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = React.memo(({ visible, onClose }) => {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
    const [language, setLanguage] = useState<'es' | 'en'>('es');
    const [sleepMinutes, setSleepMinutes] = useState<number>(0);
    const [trash, setTrash] = useState<Track[]>([]);
    const [bugReport, setBugReport] = useState('');
    const [reportImages, setReportImages] = useState<string[]>([]);
    const [audioDownloadPath, setAudioDownloadPath] = useState(DEFAULT_AUDIO_DOWNLOAD_PATH);
    const [videoDownloadPath, setVideoDownloadPath] = useState(DEFAULT_VIDEO_DOWNLOAD_PATH);
    const [pathsSavedFeedback, setPathsSavedFeedback] = useState(false);

    useEffect(() => {
        if (visible) {
            setActiveSection(null);
            setPathsSavedFeedback(false);
            getDeletedTracks()
                .then(setTrash)
                .catch(() => { });
            getDownloadPaths()
                .then((cfg) => {
                    setAudioDownloadPath(cfg.audioPath);
                    setVideoDownloadPath(cfg.videoPath);
                })
                .catch(() => { });
        }
    }, [visible]);

    const handleBackAction = () => {
        if (activeSection !== null) {
            setActiveSection(null);
        } else {
            onClose();
        }
    };

    // Permite adjuntar opcionalmente hasta 5 capturas de pantalla para explicar un problema
    const handlePickReportImages = async () => {
        const remaining = 5 - reportImages.length;
        if (remaining <= 0) {
            Alert.alert('Límite alcanzado', 'Puedes adjuntar un máximo de 5 imágenes por reporte.');
            return;
        }
        try {
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsMultipleSelection: true,
                selectionLimit: remaining,
                quality: 0.85,
            });
            if (!res.canceled && res.assets?.length) {
                const pickedUris = res.assets.map((a) => a.uri).filter(Boolean);
                setReportImages((prev) => [...prev, ...pickedUris].slice(0, 5));
            }
        } catch {
            Alert.alert('Imágenes', 'No se pudo abrir la galería para seleccionar capturas.');
        }
    };

    const handleRemoveReportImage = (uri: string) => {
        setReportImages((prev) => prev.filter((item) => item !== uri));
    };

    const sendBugReport = async () => {
        const subject = 'Snow Beats - Reporte de problema';
        const body = bugReport.trim() || 'Describe el error aquí...';

        if (Platform.OS === 'android') {
            const launched = await sendEmailWithAttachments(
                'snelo1390@gmail.com',
                subject,
                body,
                reportImages
            );
            if (launched) return;
        }

        const mailUrl = `mailto:snelo1390@gmail.com?subject=${encodeURIComponent(
            subject
        )}&body=${encodeURIComponent(body)}`;
        Linking.openURL(mailUrl);
    };

    const handleSaveDownloadPaths = async () => {
        const saved = await saveDownloadPaths({
            audioPath: audioDownloadPath,
            videoPath: videoDownloadPath,
        });
        setAudioDownloadPath(saved.audioPath);
        setVideoDownloadPath(saved.videoPath);
        setPathsSavedFeedback(true);
        setTimeout(() => setPathsSavedFeedback(false), 2200);
    };

    const handleResetDownloadPaths = async () => {
        const restored = await resetDownloadPaths();
        setAudioDownloadPath(restored.audioPath);
        setVideoDownloadPath(restored.videoPath);
        setPathsSavedFeedback(true);
        setTimeout(() => setPathsSavedFeedback(false), 2200);
    };

    const themeSubtitle =
        theme.backgroundType === 'image'
            ? 'Imagen personalizada'
            : theme.backgroundType === 'gradient'
            ? 'Gradiente'
            : `${theme.mode === 'dark' ? 'Oscuro' : theme.mode === 'light' ? 'Claro' : 'Sistema'} · Color sólido`;

    const menuItems: {
        key: SettingsSection;
        title: string;
        subtitle: string;
        Icon: React.FC<{ size?: number; color?: string }>;
        iconBg: string;
    }[] = [
        {
            key: 'theme',
            title: 'Tema',
            subtitle: themeSubtitle,
            Icon: Palette,
            iconBg: '#1D4ED8',
        },
        {
            key: 'download_paths',
            title: 'Ruta de descarga',
            subtitle: 'Carpetas de audio y video',
            Icon: FolderDown,
            iconBg: '#0284C7',
        },
        {
            key: 'timer',
            title: 'Temporizador de apagado',
            subtitle: sleepMinutes === 0 ? 'Desactivado' : `${sleepMinutes} minutos`,
            Icon: Timer,
            iconBg: '#6D28D9',
        },
        {
            key: 'stats',
            title: 'Estadísticas y Alarma',
            subtitle: 'Tiempo reproducido y alarma musical',
            Icon: BarChart3,
            iconBg: '#0F766E',
        },
        {
            key: 'trash',
            title: 'Eliminados recientemente',
            subtitle:
                trash.length === 0
                    ? 'Papelera vacía'
                    : `${trash.length} ${trash.length === 1 ? 'canción' : 'canciones'}`,
            Icon: Trash2,
            iconBg: '#B91C1C',
        },
        {
            key: 'language',
            title: 'Idioma',
            subtitle: language === 'es' ? 'Español' : 'English',
            Icon: Globe,
            iconBg: '#0369A1',
        },
        {
            key: 'report',
            title: 'Reportar problema',
            subtitle: 'Enviar correo al desarrollador',
            Icon: Mail,
            iconBg: '#B45309',
        },
        {
            key: 'about',
            title: 'Acerca de',
            subtitle: 'Snow Beats v0.1.0',
            Icon: Info,
            iconBg: '#3F3F46',
        },
    ];

    const renderSubHeader = (title: string) => (
        <View style={styles.header}>
            <TouchableOpacity onPress={() => setActiveSection(null)} style={styles.backBtn}>
                <ArrowLeft size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{title}</Text>
        </View>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            statusBarTranslucent
            onRequestClose={handleBackAction}
        >
            <View
                style={[
                    styles.container,
                    {
                        paddingTop: Math.max(insets.top, 26) + 6,
                        paddingBottom: Math.max(insets.bottom, 10),
                    },
                ]}
            >
                {/* Pantalla dedicada de Tema */}
                {activeSection === 'theme' ? (
                    <ThemeSettingsView onBack={() => setActiveSection(null)} />
                ) : activeSection === null ? (
                    /* Menú principal limpio listado por categorías */
                    <>
                        <View style={styles.header}>
                            <TouchableOpacity onPress={onClose} style={styles.backBtn}>
                                <ArrowLeft size={22} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle}>Configuración</Text>
                        </View>

                        <ScrollView
                            contentContainerStyle={styles.menuListContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {menuItems.map(({ key, title, subtitle, Icon, iconBg }) => (
                                <TouchableOpacity
                                    key={key}
                                    style={styles.menuRow}
                                    activeOpacity={0.75}
                                    onPress={() => setActiveSection(key)}
                                >
                                    <View style={[styles.menuIconWrap, { backgroundColor: iconBg }]}>
                                        <Icon size={20} color="#FFFFFF" />
                                    </View>
                                    <View style={styles.menuTextCol}>
                                        <Text style={styles.menuTitle}>{title}</Text>
                                        <Text style={styles.menuSubtitle} numberOfLines={1}>
                                            {subtitle}
                                        </Text>
                                    </View>
                                    <ChevronRight size={20} color="#71717A" />
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </>
                ) : activeSection === 'download_paths' ? (
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                        {renderSubHeader('Ruta de descarga')}
                        <ScrollView
                            contentContainerStyle={styles.subContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.subDescription}>
                                Configura las carpetas dentro del almacenamiento interno donde Snow Beats guardará tus descargas de audio y video.
                            </Text>

                            <View style={styles.pathCard}>
                                <Text style={styles.pathLabel}>Carpeta de audio</Text>
                                <TextInput
                                    style={styles.pathInput}
                                    value={audioDownloadPath}
                                    onChangeText={setAudioDownloadPath}
                                    placeholder={DEFAULT_AUDIO_DOWNLOAD_PATH}
                                    placeholderTextColor="#71717A"
                                    autoCorrect={false}
                                />
                            </View>

                            <View style={styles.pathCard}>
                                <Text style={styles.pathLabel}>Carpeta de video</Text>
                                <TextInput
                                    style={styles.pathInput}
                                    value={videoDownloadPath}
                                    onChangeText={setVideoDownloadPath}
                                    placeholder={DEFAULT_VIDEO_DOWNLOAD_PATH}
                                    placeholderTextColor="#71717A"
                                    autoCorrect={false}
                                />
                            </View>

                            <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveDownloadPaths}>
                                <Check size={18} color="#000000" />
                                <Text style={styles.primaryBtnText}>
                                    {pathsSavedFeedback ? 'Rutas guardadas' : 'Guardar rutas'}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.secondaryBtn}
                                onPress={handleResetDownloadPaths}
                            >
                                <RotateCcw size={16} color="#E4E4E7" />
                                <Text style={styles.secondaryBtnText}>Restaurar rutas predeterminadas</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </KeyboardAvoidingView>
                ) : activeSection === 'timer' ? (
                    <>
                        {renderSubHeader('Temporizador de apagado')}
                        <ScrollView contentContainerStyle={styles.subContent}>
                            <Text style={styles.subDescription}>
                                Detiene la reproducción automáticamente al finalizar el tiempo seleccionado.
                            </Text>
                            {[0, 15, 30, 45, 60, 90].map((min) => {
                                const active = sleepMinutes === min;
                                return (
                                    <TouchableOpacity
                                        key={min}
                                        style={[styles.optionCard, active && styles.optionCardActive]}
                                        onPress={() => setSleepMinutes(min)}
                                    >
                                        <Text style={styles.optionTitle}>
                                            {min === 0 ? 'Desactivado' : `${min} minutos`}
                                        </Text>
                                        {active && <Check size={20} color="#60A5FA" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </>
                ) : activeSection === 'stats' ? (
                    <>
                        {renderSubHeader('Estadísticas y Alarma')}
                        <ScrollView contentContainerStyle={styles.subContent}>
                            <View style={styles.infoCard}>
                                <Text style={styles.infoCardTitle}>Tiempo total reproducido</Text>
                                <Text style={styles.infoCardBody}>
                                    0 min — El registro acumulado de escucha se conectará con el motor de estadísticas local.
                                </Text>
                            </View>
                            <View style={styles.infoCard}>
                                <Text style={styles.infoCardTitle}>Alarma musical</Text>
                                <Text style={styles.infoCardBody}>
                                    Módulo nativo de alarma programada planificado para la siguiente fase.
                                </Text>
                            </View>
                        </ScrollView>
                    </>
                ) : activeSection === 'trash' ? (
                    <>
                        {renderSubHeader(`Eliminados recientemente (${trash.length})`)}
                        <ScrollView contentContainerStyle={styles.subContent}>
                            {trash.length > 0 ? (
                                <TouchableOpacity
                                    style={styles.dangerBtn}
                                    onPress={async () => {
                                        await emptyTrash();
                                        setTrash([]);
                                        Alert.alert('Papelera vaciada');
                                    }}
                                >
                                    <Trash2 size={17} color="#FFFFFF" />
                                    <Text style={styles.dangerBtnText}>Vaciar papelera</Text>
                                </TouchableOpacity>
                            ) : (
                                <View style={styles.infoCard}>
                                    <Text style={styles.infoCardBody}>
                                        No hay canciones en la papelera interna.
                                    </Text>
                                </View>
                            )}

                            {trash.map((t) => (
                                <View key={t.id} style={styles.trashRow}>
                                    <View style={{ flex: 1, marginRight: 12 }}>
                                        <Text style={styles.trashTitle} numberOfLines={1}>
                                            {t.title}
                                        </Text>
                                        <Text style={styles.trashArtist} numberOfLines={1}>
                                            {t.artist}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={styles.restorePill}
                                        onPress={async () => {
                                            await restoreTrack(t.id);
                                            setTrash(await getDeletedTracks());
                                        }}
                                    >
                                        <Text style={styles.restoreText}>Restaurar</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </ScrollView>
                    </>
                ) : activeSection === 'language' ? (
                    <>
                        {renderSubHeader('Idioma')}
                        <ScrollView contentContainerStyle={styles.subContent}>
                            {(
                                [
                                    { code: 'es', label: 'Español' },
                                    { code: 'en', label: 'English' },
                                ] as const
                            ).map((lang) => {
                                const active = language === lang.code;
                                return (
                                    <TouchableOpacity
                                        key={lang.code}
                                        style={[styles.optionCard, active && styles.optionCardActive]}
                                        onPress={() => setLanguage(lang.code)}
                                    >
                                        <Text style={styles.optionTitle}>{lang.label}</Text>
                                        {active && <Check size={20} color="#60A5FA" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </>
                ) : activeSection === 'report' ? (
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                        {renderSubHeader('Reportar problema')}
                        <ScrollView
                            contentContainerStyle={styles.subContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.subDescription}>
                                Cuéntanos qué ocurrió y opcionalmente adjunta hasta 5 capturas para ayudarnos a reproducir el fallo.
                            </Text>
                            <TextInput
                                style={styles.reportInput}
                                placeholder="Describe el problema..."
                                placeholderTextColor="#71717A"
                                multiline
                                value={bugReport}
                                onChangeText={setBugReport}
                            />

                            {/* Adjunto opcional de hasta 5 imágenes */}
                            <View style={styles.attachmentsBlock}>
                                <View style={styles.attachmentsHeader}>
                                    <Text style={styles.attachmentsTitle}>
                                        Capturas adjuntas (opcional)
                                    </Text>
                                    <Text style={styles.attachmentsCounter}>
                                        {reportImages.length}/5
                                    </Text>
                                </View>

                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.attachmentsRow}
                                >
                                    {reportImages.length < 5 && (
                                        <TouchableOpacity
                                            style={styles.addAttachmentBtn}
                                            activeOpacity={0.8}
                                            onPress={handlePickReportImages}
                                        >
                                            <ImagePlus size={22} color="#60A5FA" />
                                            <Text style={styles.addAttachmentText}>Adjuntar</Text>
                                        </TouchableOpacity>
                                    )}

                                    {reportImages.map((uri) => (
                                        <View key={uri} style={styles.attachmentThumbWrap}>
                                            <Image
                                                source={{ uri }}
                                                style={styles.attachmentThumb}
                                                resizeMode="cover"
                                            />
                                            <TouchableOpacity
                                                style={styles.attachmentRemoveBtn}
                                                onPress={() => handleRemoveReportImage(uri)}
                                            >
                                                <X size={13} color="#FFFFFF" />
                                            </TouchableOpacity>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>

                            <TouchableOpacity style={styles.primaryBtn} onPress={sendBugReport}>
                                <Mail size={18} color="#000000" />
                                <Text style={styles.primaryBtnText}>
                                    {reportImages.length > 0
                                        ? `Enviar reporte (${reportImages.length} ${
                                              reportImages.length === 1 ? 'imagen' : 'imágenes'
                                          })`
                                        : 'Enviar reporte por correo'}
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </KeyboardAvoidingView>
                ) : (
                    <>
                        {renderSubHeader('Acerca de')}
                        <ScrollView contentContainerStyle={styles.subContent}>
                            <View style={styles.infoCard}>
                                <Text style={styles.infoCardTitle}>Snow Beats</Text>
                                <Text style={styles.infoCardBody}>
                                    Versión 0.1.0 · Reproductor de música local diseñado para alto rendimiento,
                                    privacidad total sin servidor y personalización visual.
                                </Text>
                            </View>
                        </ScrollView>
                    </>
                )}
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0C0E14',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        color: '#FFFFFF',
        fontSize: 19,
        fontWeight: '700',
        marginLeft: 6,
    },
    menuListContent: {
        padding: 16,
        gap: 10,
    },
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#151822',
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    menuIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuTextCol: {
        flex: 1,
        marginLeft: 14,
        marginRight: 8,
    },
    menuTitle: {
        color: '#FFFFFF',
        fontSize: 15.5,
        fontWeight: '700',
    },
    menuSubtitle: {
        color: '#9CA3AF',
        fontSize: 13,
        marginTop: 2,
    },
    subContent: {
        padding: 18,
        gap: 12,
        paddingBottom: 40,
    },
    subDescription: {
        color: '#9CA3AF',
        fontSize: 13.5,
        lineHeight: 20,
        marginBottom: 4,
    },
    optionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#151822',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    optionCardActive: {
        borderColor: '#2563EB',
        backgroundColor: '#17223B',
    },
    optionTitle: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
    },
    infoCard: {
        backgroundColor: '#151822',
        padding: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        gap: 6,
    },
    infoCardTitle: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    infoCardBody: {
        color: '#A1A1AA',
        fontSize: 13.5,
        lineHeight: 20,
    },
    dangerBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#991B1B',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignSelf: 'flex-start',
    },
    dangerBtnText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14,
    },
    trashRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#151822',
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    trashTitle: {
        color: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: '600',
    },
    trashArtist: {
        color: '#9CA3AF',
        fontSize: 12.5,
        marginTop: 2,
    },
    restorePill: {
        backgroundColor: 'rgba(96,165,250,0.16)',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
    },
    restoreText: {
        color: '#60A5FA',
        fontSize: 12.5,
        fontWeight: '700',
    },
    reportInput: {
        backgroundColor: '#151822',
        color: '#FFFFFF',
        borderRadius: 14,
        padding: 14,
        minHeight: 120,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        textAlignVertical: 'top',
        fontSize: 14.5,
    },
    primaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFFFFF',
        paddingVertical: 13,
        borderRadius: 14,
    },
    primaryBtnText: {
        color: '#000000',
        fontWeight: '800',
        fontSize: 14.5,
    },
    secondaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#1B2030',
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    secondaryBtnText: {
        color: '#E4E4E7',
        fontWeight: '700',
        fontSize: 13.5,
    },
    pathCard: {
        backgroundColor: '#151822',
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 8,
    },
    pathLabel: {
        color: '#E4E4E7',
        fontSize: 13.5,
        fontWeight: '700',
    },
    pathInput: {
        backgroundColor: '#0E1118',
        color: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    attachmentsBlock: {
        backgroundColor: '#151822',
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 10,
    },
    attachmentsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    attachmentsTitle: {
        color: '#E4E4E7',
        fontSize: 13.5,
        fontWeight: '700',
    },
    attachmentsCounter: {
        color: '#60A5FA',
        fontSize: 12.5,
        fontWeight: '700',
    },
    attachmentsRow: {
        gap: 10,
        paddingVertical: 2,
    },
    addAttachmentBtn: {
        width: 78,
        height: 78,
        borderRadius: 12,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: 'rgba(96,165,250,0.45)',
        backgroundColor: 'rgba(37,99,235,0.08)',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    addAttachmentText: {
        color: '#93C5FD',
        fontSize: 11.5,
        fontWeight: '700',
    },
    attachmentThumbWrap: {
        width: 78,
        height: 78,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.16)',
    },
    attachmentThumb: {
        width: '100%',
        height: '100%',
    },
    attachmentRemoveBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
    },
});