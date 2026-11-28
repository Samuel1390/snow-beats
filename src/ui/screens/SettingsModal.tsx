import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Easing,
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
    useWindowDimensions,
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
import { StatsAndAlarmView } from '../components/StatsAndAlarmView';
import { useI18n } from '../../i18n/LanguageContext';
import { usePlayer } from '../../audio-engine/PlayerContext';

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
    onOpenPlayer?: () => void;
}

function escapeHtml(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildBugReportHtml(
    description: string,
    imageCount: number,
    localeTag: string,
    isEnglish: boolean
): string {
    const safeBody = escapeHtml(description).replace(/\n/g, '<br/>');
    const osInfo = `${Platform.OS === 'android' ? 'Android' : Platform.OS} ${String(Platform.Version)}`;
    const dateStr = new Date().toLocaleString(localeTag);
    const attachText = isEnglish
        ? imageCount > 0
            ? `${imageCount} ${imageCount === 1 ? 'attached image' : 'attached images'}`
            : 'No attached images'
        : imageCount > 0
        ? `${imageCount} ${imageCount === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}`
        : 'Sin imágenes adjuntas';

    return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; line-height: 1.5; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 0 auto; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden;">
    <div style="background-color: #0F172A; color: #FFFFFF; padding: 18px 22px;">
      <h2 style="margin: 0; font-size: 19px; letter-spacing: 0.2px;">Snow Beats — ${isEnglish ? 'Issue Report' : 'Reporte de problema'}</h2>
      <p style="margin: 4px 0 0 0; font-size: 12px; color: #93C5FD;">${isEnglish ? 'Sent from mobile app' : 'Enviado desde la aplicación móvil'}</p>
    </div>
    <div style="padding: 20px 22px; background-color: #FFFFFF;">
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #1E3A8A; text-transform: uppercase;">${isEnglish ? 'Issue description' : 'Descripción del fallo'}</h3>
      <div style="background-color: #F8FAFC; border-left: 4px solid #1E3A8A; padding: 12px 14px; border-radius: 6px; font-size: 14px; color: #111827;">
        ${safeBody}
      </div>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 18px 0;" />
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;"><b>${isEnglish ? 'App' : 'Aplicación'}:</b> Snow Beats v0.1.0</p>
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;"><b>${isEnglish ? 'System' : 'Sistema'}:</b> ${escapeHtml(osInfo)}</p>
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;"><b>${isEnglish ? 'Attachments' : 'Adjuntos'}:</b> ${escapeHtml(attachText)}</p>
      <p style="margin: 0; font-size: 13px; color: #374151;"><b>${isEnglish ? 'Date' : 'Fecha'}:</b> ${escapeHtml(dateStr)}</p>
    </div>
  </div>
</body>
</html>`;
}

export const SettingsModal: React.FC<SettingsModalProps> = React.memo(({ visible, onClose, onOpenPlayer }) => {
    const { theme } = useTheme();
    const { language, localeTag, supportedLanguages, setLanguage, t } = useI18n();
    const { sleepMinutes, setSleepTimerMinutes, alarms, playTrack } = usePlayer();
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
    const [trash, setTrash] = useState<Track[]>([]);
    const [bugReport, setBugReport] = useState('');
    const [reportImages, setReportImages] = useState<string[]>([]);
    const [audioDownloadPath, setAudioDownloadPath] = useState(DEFAULT_AUDIO_DOWNLOAD_PATH);
    const [videoDownloadPath, setVideoDownloadPath] = useState(DEFAULT_VIDEO_DOWNLOAD_PATH);
    const [savedAudioPath, setSavedAudioPath] = useState(DEFAULT_AUDIO_DOWNLOAD_PATH);
    const [savedVideoPath, setSavedVideoPath] = useState(DEFAULT_VIDEO_DOWNLOAD_PATH);

    // Progreso de transición horizontal: 0 = menú principal, 1 = subsección visible
    const sectionAnim = useRef(new Animated.Value(0)).current;
    const isClosingSectionRef = useRef(false);

    // Solo habilita "Guardar rutas" cuando alguna de las dos rutas cambió realmente
    const hasUnsavedPathChanges =
        audioDownloadPath.trim() !== savedAudioPath.trim() ||
        videoDownloadPath.trim() !== savedVideoPath.trim();

    useEffect(() => {
        if (visible) {
            isClosingSectionRef.current = false;
            sectionAnim.setValue(0);
            setActiveSection(null);
            getDeletedTracks()
                .then(setTrash)
                .catch(() => { });
            getDownloadPaths()
                .then((cfg) => {
                    setAudioDownloadPath(cfg.audioPath);
                    setVideoDownloadPath(cfg.videoPath);
                    setSavedAudioPath(cfg.audioPath);
                    setSavedVideoPath(cfg.videoPath);
                })
                .catch(() => { });
        }
    }, [visible, sectionAnim]);

    // Abre una subsección deslizándola suavemente desde la derecha hacia la izquierda
    const openSection = useCallback(
        (section: SettingsSection) => {
            isClosingSectionRef.current = false;
            setActiveSection(section);
            sectionAnim.stopAnimation();
            sectionAnim.setValue(0);
            Animated.timing(sectionAnim, {
                toValue: 1,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        },
        [sectionAnim]
    );

    // Cierra la subsección actual deslizándola hacia la derecha antes de desmontarla
    const closeSection = useCallback(() => {
        if (activeSection === null || isClosingSectionRef.current) return;
        isClosingSectionRef.current = true;
        sectionAnim.stopAnimation();
        Animated.timing(sectionAnim, {
            toValue: 0,
            duration: 220,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
        }).start(({ finished }) => {
            isClosingSectionRef.current = false;
            if (finished) {
                setActiveSection(null);
            }
        });
    }, [activeSection, sectionAnim]);

    const handleBackAction = useCallback(() => {
        if (activeSection !== null) {
            closeSection();
        } else {
            onClose();
        }
    }, [activeSection, closeSection, onClose]);

    // Permite adjuntar opcionalmente hasta 5 capturas de pantalla para explicar un problema
    const handlePickReportImages = async () => {
        const remaining = 5 - reportImages.length;
        if (remaining <= 0) {
            Alert.alert(t('settings.report.limitTitle'), t('settings.report.limitBody'));
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
            Alert.alert(t('settings.report.galleryErrorTitle'), t('settings.report.galleryErrorBody'));
        }
    };

    const handleRemoveReportImage = (uri: string) => {
        setReportImages((prev) => prev.filter((item) => item !== uri));
    };

    const sendBugReport = async () => {
        const description = bugReport.trim() || t('settings.report.defaultDesc');
        const subject = t('settings.report.emailSubject');
        const isEnglish = language === 'en';
        const plainBody = [
            isEnglish ? 'SNOW BEATS — ISSUE REPORT' : 'SNOW BEATS — REPORTE DE PROBLEMA',
            '----------------------------------',
            description,
            '',
            `${isEnglish ? 'App' : 'Aplicación'}: Snow Beats v0.1.0`,
            `${isEnglish ? 'System' : 'Sistema'}: ${Platform.OS} ${String(Platform.Version)}`,
            `${isEnglish ? 'Attached images' : 'Imágenes adjuntas'}: ${reportImages.length}`,
        ].join('\n');
        const htmlBody = buildBugReportHtml(description, reportImages.length, localeTag, isEnglish);

        if (Platform.OS === 'android') {
            const launched = await sendEmailWithAttachments(
                'snelo1390@gmail.com',
                subject,
                plainBody,
                htmlBody,
                reportImages
            );
            if (launched) return;
            Alert.alert(t('settings.report.noMailTitle'), t('settings.report.noMailBody'));
            return;
        }

        if (Platform.OS === 'web' && reportImages.length > 0) {
            Alert.alert(
                t('settings.report.attachmentsTitle'),
                isEnglish
                    ? 'Web browsers cannot attach local images automatically via mailto:. Your email draft will open now — attach the screenshots manually or send from the Android app.'
                    : 'Los navegadores web no permiten adjuntar archivos locales automáticamente mediante mailto:. Se abrirá el borrador de correo para que adjuntes la captura manualmente (en la app de Android se adjunta sola).'
            );
        }

        const mailUrl = `mailto:snelo1390@gmail.com?subject=${encodeURIComponent(
            subject
        )}&body=${encodeURIComponent(plainBody)}`;
        Linking.openURL(mailUrl);
    };

    const handleSaveDownloadPaths = async () => {
        if (!hasUnsavedPathChanges) return;
        const saved = await saveDownloadPaths({
            audioPath: audioDownloadPath,
            videoPath: videoDownloadPath,
        });
        setAudioDownloadPath(saved.audioPath);
        setVideoDownloadPath(saved.videoPath);
        setSavedAudioPath(saved.audioPath);
        setSavedVideoPath(saved.videoPath);
    };

    const handleResetDownloadPaths = async () => {
        const restored = await resetDownloadPaths();
        setAudioDownloadPath(restored.audioPath);
        setVideoDownloadPath(restored.videoPath);
        setSavedAudioPath(restored.audioPath);
        setSavedVideoPath(restored.videoPath);
    };

    const modeLabel =
        theme.mode === 'dark'
            ? t('theme.mode.dark')
            : theme.mode === 'light'
            ? t('theme.mode.light')
            : t('theme.mode.system');

    const themeSubtitle =
        theme.backgroundType === 'image'
            ? t('settings.theme.customImage')
            : theme.backgroundType === 'gradient'
            ? t('settings.theme.gradient')
            : t('settings.theme.solidSubtitle', { mode: modeLabel });

    const activeAlarmCount = alarms.filter((a) => a.enabled).length;
    const currentLanguageMeta = supportedLanguages.find((item) => item.code === language);

    const menuItems: {
        key: SettingsSection;
        title: string;
        subtitle: string;
        Icon: React.FC<{ size?: number; color?: string }>;
        iconBg: string;
    }[] = [
        {
            key: 'theme',
            title: t('settings.theme.title'),
            subtitle: themeSubtitle,
            Icon: Palette,
            iconBg: '#1D4ED8',
        },
        {
            key: 'download_paths',
            title: t('settings.paths.title'),
            subtitle: t('settings.paths.subtitle'),
            Icon: FolderDown,
            iconBg: '#0284C7',
        },
        {
            key: 'timer',
            title: t('settings.timer.title'),
            subtitle:
                sleepMinutes === 0
                    ? t('settings.timer.off')
                    : t('settings.timer.minutes', { min: sleepMinutes }),
            Icon: Timer,
            iconBg: '#6D28D9',
        },
        {
            key: 'stats',
            title: t('settings.stats.title'),
            subtitle:
                activeAlarmCount > 0
                    ? t('settings.stats.subtitleActiveAlarms', {
                          count: activeAlarmCount,
                          unit: t('alarm.activeUnit'),
                      })
                    : t('settings.stats.subtitle'),
            Icon: BarChart3,
            iconBg: '#0F766E',
        },
        {
            key: 'trash',
            title: t('settings.trash.title'),
            subtitle:
                trash.length === 0
                    ? t('settings.trash.emptySubtitle')
                    : `${trash.length} ${
                          trash.length === 1 ? t('common.songSingular') : t('common.songPlural')
                      }`,
            Icon: Trash2,
            iconBg: '#B91C1C',
        },
        {
            key: 'language',
            title: t('settings.language.title'),
            subtitle: currentLanguageMeta?.nativeName ?? 'Español',
            Icon: Globe,
            iconBg: '#0369A1',
        },
        {
            key: 'report',
            title: t('settings.report.title'),
            subtitle: t('settings.report.subtitle'),
            Icon: Mail,
            iconBg: '#B45309',
        },
        {
            key: 'about',
            title: t('settings.about.title'),
            subtitle: 'Snow Beats v0.1.0',
            Icon: Info,
            iconBg: '#3F3F46',
        },
    ];

    const renderSubHeader = (title: string) => (
        <View style={styles.header}>
            <TouchableOpacity onPress={closeSection} style={styles.backBtn}>
                <ArrowLeft size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{title}</Text>
        </View>
    );

    const safeWidth = Math.max(screenWidth, 320);
    const menuTranslateX = sectionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -safeWidth * 0.22],
    });
    const menuOpacity = sectionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.55],
    });
    const detailTranslateX = sectionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [safeWidth, 0],
    });

    const renderActiveSectionContent = () => {
        if (activeSection === 'theme') {
            return <ThemeSettingsView onBack={closeSection} />;
        }
        if (activeSection === 'download_paths') {
            return (
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    {renderSubHeader(t('settings.paths.title'))}
                    <ScrollView
                        contentContainerStyle={styles.subContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        <Text style={styles.subDescription}>
                            {t('settings.paths.description')}
                        </Text>

                        <View style={styles.pathCard}>
                            <Text style={styles.pathLabel}>{t('settings.paths.audioFolder')}</Text>
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
                            <Text style={styles.pathLabel}>{t('settings.paths.videoFolder')}</Text>
                            <TextInput
                                style={styles.pathInput}
                                value={videoDownloadPath}
                                onChangeText={setVideoDownloadPath}
                                placeholder={DEFAULT_VIDEO_DOWNLOAD_PATH}
                                placeholderTextColor="#71717A"
                                autoCorrect={false}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.primaryBtn,
                                !hasUnsavedPathChanges && styles.primaryBtnSaved,
                            ]}
                            disabled={!hasUnsavedPathChanges}
                            activeOpacity={0.85}
                            onPress={handleSaveDownloadPaths}
                        >
                            <Check
                                size={18}
                                color={hasUnsavedPathChanges ? '#000000' : '#4ADE80'}
                            />
                            <Text
                                style={[
                                    styles.primaryBtnText,
                                    !hasUnsavedPathChanges && styles.primaryBtnTextSaved,
                                ]}
                            >
                                {hasUnsavedPathChanges
                                    ? t('settings.paths.saveBtn')
                                    : t('settings.paths.savedBtn')}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.secondaryBtn}
                            onPress={handleResetDownloadPaths}
                        >
                            <RotateCcw size={16} color="#E4E4E7" />
                            <Text style={styles.secondaryBtnText}>
                                {t('settings.paths.resetBtn')}
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
                </KeyboardAvoidingView>
            );
        }
        if (activeSection === 'timer') {
            return (
                <>
                    {renderSubHeader(t('settings.timer.title'))}
                    <ScrollView contentContainerStyle={styles.subContent}>
                        <Text style={styles.subDescription}>
                            {t('settings.timer.description')}
                        </Text>
                        {[0, 15, 30, 45, 60, 90].map((min) => {
                            const active = sleepMinutes === min;
                            return (
                                <TouchableOpacity
                                    key={min}
                                    style={[styles.optionCard, active && styles.optionCardActive]}
                                    onPress={() => setSleepTimerMinutes(min)}
                                >
                                    <Text style={styles.optionTitle}>
                                        {min === 0
                                            ? t('settings.timer.off')
                                            : t('settings.timer.minutes', { min })}
                                    </Text>
                                    {active && <Check size={20} color="#60A5FA" />}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </>
            );
        }
        if (activeSection === 'stats') {
            return (
                <StatsAndAlarmView
                    onBack={closeSection}
                    onPlayTrackAndClose={(track, queue) => {
                        playTrack(track, queue);
                        onClose();
                        onOpenPlayer?.();
                    }}
                />
            );
        }
        if (activeSection === 'trash') {
            return (
                <>
                    {renderSubHeader(t('settings.trash.header', { count: trash.length }))}
                    <ScrollView contentContainerStyle={styles.subContent}>
                        {trash.length > 0 ? (
                            <TouchableOpacity
                                style={styles.dangerBtn}
                                onPress={async () => {
                                    await emptyTrash();
                                    setTrash([]);
                                    Alert.alert(t('settings.trash.emptiedAlert'));
                                }}
                            >
                                <Trash2 size={17} color="#FFFFFF" />
                                <Text style={styles.dangerBtnText}>
                                    {t('settings.trash.emptyBtn')}
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={styles.infoCard}>
                                <Text style={styles.infoCardBody}>
                                    {t('settings.trash.emptyBody')}
                                </Text>
                            </View>
                        )}

                        {trash.map((item) => (
                            <View key={item.id} style={styles.trashRow}>
                                <View style={{ flex: 1, marginRight: 12 }}>
                                    <Text style={styles.trashTitle} numberOfLines={1}>
                                        {item.title}
                                    </Text>
                                    <Text style={styles.trashArtist} numberOfLines={1}>
                                        {item.artist}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    style={styles.restorePill}
                                    onPress={async () => {
                                        await restoreTrack(item.id);
                                        setTrash(await getDeletedTracks());
                                    }}
                                >
                                    <Text style={styles.restoreText}>{t('common.restore')}</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </ScrollView>
                </>
            );
        }
        if (activeSection === 'language') {
            return (
                <>
                    {renderSubHeader(t('settings.language.title'))}
                    <ScrollView contentContainerStyle={styles.subContent}>
                        <Text style={styles.subDescription}>
                            {t('settings.language.description')}
                        </Text>
                        {supportedLanguages.map((lang) => {
                            const active = language === lang.code;
                            return (
                                <TouchableOpacity
                                    key={lang.code}
                                    style={[styles.optionCard, active && styles.optionCardActive]}
                                    onPress={() => setLanguage(lang.code)}
                                >
                                    <View>
                                        <Text style={styles.optionTitle}>{lang.nativeName}</Text>
                                        <Text style={styles.optionSub}>{lang.englishName}</Text>
                                    </View>
                                    {active && <Check size={20} color="#60A5FA" />}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </>
            );
        }
        if (activeSection === 'report') {
            return (
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    {renderSubHeader(t('settings.report.title'))}
                    <ScrollView
                        contentContainerStyle={styles.subContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        <Text style={styles.subDescription}>
                            {t('settings.report.description')}
                        </Text>
                        <TextInput
                            style={styles.reportInput}
                            placeholder={t('settings.report.placeholder')}
                            placeholderTextColor="#71717A"
                            multiline
                            value={bugReport}
                            onChangeText={setBugReport}
                        />

                        {/* Adjunto opcional de hasta 5 imágenes */}
                        <View style={styles.attachmentsBlock}>
                            <View style={styles.attachmentsHeader}>
                                <Text style={styles.attachmentsTitle}>
                                    {t('settings.report.attachmentsTitle')}
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
                                        <Text style={styles.addAttachmentText}>
                                            {t('settings.report.attachBtn')}
                                        </Text>
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
                                    ? t('settings.report.sendWithImages', {
                                          count: reportImages.length,
                                          unit:
                                              reportImages.length === 1
                                                  ? t('settings.report.imageSingular')
                                                  : t('settings.report.imagePlural'),
                                      })
                                    : t('settings.report.sendEmail')}
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
                </KeyboardAvoidingView>
            );
        }
        return (
            <>
                {renderSubHeader(t('settings.about.title'))}
                <ScrollView contentContainerStyle={styles.subContent}>
                    <View style={styles.infoCard}>
                        <Text style={styles.infoCardTitle}>Snow Beats</Text>
                        <Text style={styles.infoCardBody}>{t('settings.about.body')}</Text>
                    </View>
                </ScrollView>
            </>
        );
    };

    const topInset = Math.max(insets.top, 26) + 6;
    const bottomInset = Math.max(insets.bottom, 10);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            statusBarTranslucent
            onRequestClose={handleBackAction}
        >
            <View style={styles.container}>
                {/* Menú principal con efecto sutil de desplazamiento al entrar en una subsección */}
                <Animated.View
                    style={[
                        styles.screenLayer,
                        {
                            paddingTop: topInset,
                            paddingBottom: bottomInset,
                            opacity: menuOpacity,
                            transform: [{ translateX: menuTranslateX }],
                        },
                    ]}
                    pointerEvents={activeSection !== null ? 'none' : 'auto'}
                >
                    <View style={styles.header}>
                        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
                            <ArrowLeft size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
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
                                onPress={() => openSection(key)}
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
                </Animated.View>

                {/* Subsección activa deslizándose desde la derecha al entrar y hacia la derecha al salir */}
                {activeSection !== null && (
                    <Animated.View
                        style={[
                            styles.detailOverlay,
                            {
                                paddingTop: topInset,
                                paddingBottom: bottomInset,
                                transform: [{ translateX: detailTranslateX }],
                            },
                        ]}
                    >
                        {renderActiveSectionContent()}
                    </Animated.View>
                )}
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0C0E14',
        overflow: 'hidden',
    },
    screenLayer: {
        flex: 1,
    },
    detailOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: '#0C0E14',
        elevation: 8,
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
    optionSub: {
        color: '#9CA3AF',
        fontSize: 12.5,
        marginTop: 2,
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
    primaryBtnSaved: {
        backgroundColor: 'rgba(74,222,128,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(74,222,128,0.35)',
    },
    primaryBtnText: {
        color: '#000000',
        fontWeight: '800',
        fontSize: 14.5,
    },
    primaryBtnTextSaved: {
        color: '#86EFAC',
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