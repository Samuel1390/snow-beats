import React, { useEffect, useState } from 'react';
import {
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
    ArrowLeft,
    BarChart3,
    Check,
    ChevronRight,
    Globe,
    Info,
    Mail,
    Palette,
    Timer,
    Trash2,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { emptyTrash, getDeletedTracks, restoreTrack } from '../../storage/database/db';
import { Track } from '../../types/music';
import { ThemeSettingsView } from '../components/ThemeSettingsView';

type SettingsSection =
    | 'theme'
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

    useEffect(() => {
        if (visible) {
            setActiveSection(null);
            getDeletedTracks()
                .then(setTrash)
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

    const sendBugReport = () => {
        const subject = encodeURIComponent('Snow Beats - Reporte de problema');
        const body = encodeURIComponent(bugReport || 'Describe el error aquí...');
        Linking.openURL(`mailto:snelo1390@gmail.com?subject=${subject}&body=${body}`);
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
                                Cuéntanos qué ocurrió y se abrirá tu app de correo con el reporte listo para enviar.
                            </Text>
                            <TextInput
                                style={styles.reportInput}
                                placeholder="Describe el problema..."
                                placeholderTextColor="#71717A"
                                multiline
                                value={bugReport}
                                onChangeText={setBugReport}
                            />
                            <TouchableOpacity style={styles.primaryBtn} onPress={sendBugReport}>
                                <Mail size={18} color="#000000" />
                                <Text style={styles.primaryBtnText}>Enviar reporte por correo</Text>
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
});