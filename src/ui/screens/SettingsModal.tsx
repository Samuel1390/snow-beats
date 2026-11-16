import React, { useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Linking,
    Alert,
    StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { ArrowLeft, Image as ImageIcon, Trash2, Mail } from 'lucide-react-native';
import {
    GRADIENT_PRESETS,
    SOLID_PALETTES,
    useTheme,
} from '../../theme/ThemeContext';
import {
    emptyTrash,
    getDeletedTracks,
    restoreTrack,
} from '../../storage/database/db';
import { Track } from '../../types/music';

interface SettingsModalProps {
    visible: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
    const { theme, updateTheme } = useTheme();
    const [customHex, setCustomHex] = useState('#1E1B4B');
    const [gradTop, setGradTop] = useState('#1E3A8A');
    const [gradBottom, setGradBottom] = useState('#000000');
    const [language, setLanguage] = useState<'es' | 'en'>('es');
    const [sleepMinutes, setSleepMinutes] = useState<number>(0);
    const [trash, setTrash] = useState<Track[]>([]);
    const [bugReport, setBugReport] = useState('');

    useEffect(() => {
        if (visible) {
            getDeletedTracks().then(setTrash);
        }
    }, [visible]);

    // Selecciona imagen de galería con blur=0 y brightness=100 por defecto
    const pickGalleryImage = async () => {
        const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.9,
        });
        if (!res.canceled && res.assets[0]?.uri) {
            updateTheme({
                backgroundType: 'image',
                customImage: {
                    uri: res.assets[0].uri,
                    blur: 0,
                    brightness: 100,
                },
                foregroundColor: '#FFFFFF',
            });
        }
    };

    const sendBugReport = () => {
        const subject = encodeURIComponent('Snow Beats - Reporte de problema');
        const body = encodeURIComponent(bugReport || 'Describe el error aquí...');
        Linking.openURL(`mailto:snelo1390@gmail.com?subject=${subject}&body=${body}`);
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
                        <ArrowLeft size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Configuración</Text>
                </View>

                <ScrollView contentContainerStyle={styles.content}>
                    {/* 1. Modo de tema */}
                    <Text style={styles.section}>Tema</Text>
                    <View style={styles.rowChips}>
                        {(['dark', 'light', 'system'] as const).map((m) => (
                            <TouchableOpacity
                                key={m}
                                style={[styles.chip, theme.mode === m && styles.chipActive]}
                                onPress={() =>
                                    updateTheme({
                                        mode: m,
                                        backgroundType: 'solid',
                                        solidColor: m === 'light' ? '#FFFFFF' : '#0A0A0A',
                                    })
                                }
                            >
                                <Text style={styles.chipText}>
                                    {m === 'dark' ? 'Oscuro' : m === 'light' ? 'Claro' : 'Sistema'}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* 2. Colores planos: Selector personalizado primero + 10 predeterminados */}
                    <Text style={styles.subSection}>Colores planos</Text>
                    <View style={styles.customColorRow}>
                        <TextInput
                            style={styles.hexInput}
                            value={customHex}
                            onChangeText={setCustomHex}
                            placeholder="#0A0A0A"
                            placeholderTextColor="#6B7280"
                        />
                        <TouchableOpacity
                            style={styles.applyBtn}
                            onPress={() =>
                                updateTheme({ backgroundType: 'solid', solidColor: customHex })
                            }
                        >
                            <Text style={styles.applyBtnText}>Aplicar color</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
                        {SOLID_PALETTES.map((p) => {
                            const color = theme.mode === 'light' ? p.lightBg : p.darkBg;
                            return (
                                <TouchableOpacity
                                    key={p.name}
                                    style={[styles.swatch, { backgroundColor: color }]}
                                    onPress={() => updateTheme({ backgroundType: 'solid', solidColor: color })}
                                />
                            );
                        })}
                    </ScrollView>

                    {/* 3. Gradientes */}
                    <Text style={styles.subSection}>Gradientes</Text>
                    <View style={styles.customColorRow}>
                        <TextInput
                            style={styles.hexInput}
                            value={gradTop}
                            onChangeText={setGradTop}
                            placeholder="Arriba #HEX"
                            placeholderTextColor="#6B7280"
                        />
                        <TextInput
                            style={styles.hexInput}
                            value={gradBottom}
                            onChangeText={setGradBottom}
                            placeholder="Abajo #HEX"
                            placeholderTextColor="#6B7280"
                        />
                        <TouchableOpacity
                            style={styles.applyBtn}
                            onPress={() =>
                                updateTheme({
                                    backgroundType: 'gradient',
                                    gradientColors: [gradTop, gradBottom],
                                })
                            }
                        >
                            <Text style={styles.applyBtnText}>Aplicar</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.rowChips}>
                        {GRADIENT_PRESETS.map((g) => (
                            <TouchableOpacity
                                key={g.name}
                                style={styles.chip}
                                onPress={() =>
                                    updateTheme({ backgroundType: 'gradient', gradientColors: g.colors })
                                }
                            >
                                <Text style={styles.chipText}>{g.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* 4. Imagen de galería como fondo (blur 0, brillo 100% reducible, texto blanco) */}
                    <Text style={styles.subSection}>Fondo con imagen de galería</Text>
                    <TouchableOpacity style={styles.galleryBtn} onPress={pickGalleryImage}>
                        <ImageIcon size={18} color="#000000" />
                        <Text style={styles.galleryBtnText}>Elegir imagen de la galería</Text>
                    </TouchableOpacity>

                    {theme.backgroundType === 'image' && theme.customImage && (
                        <View style={styles.slidersBox}>
                            <Text style={styles.sliderLabel}>
                                Desenfoque (Blur): {Math.round(theme.customImage.blur)}
                            </Text>
                            <Slider
                                minimumValue={0}
                                maximumValue={25}
                                step={1}
                                value={theme.customImage.blur}
                                onValueChange={(val) =>
                                    updateTheme({
                                        customImage: { ...theme.customImage!, blur: val },
                                    })
                                }
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                            />

                            <Text style={styles.sliderLabel}>
                                Brillo: {Math.round(theme.customImage.brightness)}% (solo oscurece)
                            </Text>
                            <Slider
                                minimumValue={0}
                                maximumValue={100}
                                step={5}
                                value={theme.customImage.brightness}
                                onValueChange={(val) =>
                                    updateTheme({
                                        customImage: { ...theme.customImage!, brightness: val },
                                    })
                                }
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                            />
                        </View>
                    )}

                    {/* 5. Temporizador de apagado y Estadísticas */}
                    <Text style={styles.section}>Temporizador de apagado (Sleep Timer)</Text>
                    <View style={styles.rowChips}>
                        {[0, 15, 30, 45, 60].map((min) => (
                            <TouchableOpacity
                                key={min}
                                style={[styles.chip, sleepMinutes === min && styles.chipActive]}
                                onPress={() => setSleepMinutes(min)}
                            >
                                <Text style={styles.chipText}>{min === 0 ? 'Desactivado' : `${min} min`}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={styles.section}>Estadísticas y Alarma musical</Text>
                    <Text style={styles.infoText}>Tiempo total reproducido: 0 min (activo con motor de audio en el siguiente paso).</Text>
                    <Text style={styles.infoText}>Alarma musical: módulo nativo planificado para fase final.</Text>

                    {/* 6. Papelera interna */}
                    <Text style={styles.section}>Eliminados recientemente ({trash.length})</Text>
                    {trash.length > 0 && (
                        <TouchableOpacity
                            style={styles.dangerBtn}
                            onPress={async () => {
                                await emptyTrash();
                                setTrash([]);
                                Alert.alert('Papelera vaciada');
                            }}
                        >
                            <Trash2 size={16} color="#FFFFFF" />
                            <Text style={{ color: '#FFFFFF', marginLeft: 6 }}>Vaciar papelera</Text>
                        </TouchableOpacity>
                    )}
                    {trash.map((t) => (
                        <TouchableOpacity
                            key={t.id}
                            style={styles.trashRow}
                            onPress={async () => {
                                await restoreTrack(t.id);
                                setTrash(await getDeletedTracks());
                            }}
                        >
                            <Text style={{ color: '#E5E7EB' }}>{t.title}</Text>
                            <Text style={{ color: '#60A5FA', fontSize: 12 }}>Restaurar</Text>
                        </TouchableOpacity>
                    ))}

                    {/* 7. Idioma */}
                    <Text style={styles.section}>Idioma</Text>
                    <View style={styles.rowChips}>
                        <TouchableOpacity
                            style={[styles.chip, language === 'es' && styles.chipActive]}
                            onPress={() => setLanguage('es')}
                        >
                            <Text style={styles.chipText}>Español</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.chip, language === 'en' && styles.chipActive]}
                            onPress={() => setLanguage('en')}
                        >
                            <Text style={styles.chipText}>English</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 8. Reportar problema */}
                    <Text style={styles.section}>Reportar problema</Text>
                    <TextInput
                        style={styles.reportInput}
                        placeholder="Describe el problema..."
                        placeholderTextColor="#6B7280"
                        multiline
                        value={bugReport}
                        onChangeText={setBugReport}
                    />
                    <TouchableOpacity style={styles.galleryBtn} onPress={sendBugReport}>
                        <Mail size={18} color="#000000" />
                        <Text style={styles.galleryBtnText}>Enviar reporte por correo</Text>
                    </TouchableOpacity>

                    {/* 9. Acerca de */}
                    <Text style={styles.section}>Acerca de</Text>
                    <Text style={styles.infoText}>Snow Beats v0.1.0 — Sección lista para completar más adelante.</Text>
                </ScrollView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0A0A0A', paddingTop: 42 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1F2937',
    },
    headerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700', marginLeft: 10 },
    content: { padding: 16, paddingBottom: 48 },
    section: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
    subSection: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6 },
    rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: '#1F2937',
    },
    chipActive: { backgroundColor: '#2563EB' },
    chipText: { color: '#FFFFFF', fontSize: 13 },
    customColorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    hexInput: {
        flex: 1,
        backgroundColor: '#111827',
        color: '#FFFFFF',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#374151',
    },
    applyBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
    applyBtnText: { color: '#000000', fontWeight: '700', fontSize: 12 },
    swatch: {
        width: 38,
        height: 38,
        borderRadius: 19,
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#4B5563',
    },
    galleryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        paddingVertical: 11,
        borderRadius: 10,
        marginTop: 6,
    },
    galleryBtnText: { color: '#000000', fontWeight: '700', marginLeft: 8 },
    slidersBox: { backgroundColor: '#111827', borderRadius: 10, padding: 12, marginTop: 10 },
    sliderLabel: { color: '#E5E7EB', fontSize: 13, marginTop: 6 },
    infoText: { color: '#9CA3AF', fontSize: 13, marginBottom: 4 },
    dangerBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#991B1B',
        padding: 10,
        borderRadius: 8,
        alignSelf: 'flex-start',
        marginBottom: 8,
    },
    trashRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#1F2937',
    },
    reportInput: {
        backgroundColor: '#111827',
        color: '#FFFFFF',
        borderRadius: 8,
        padding: 10,
        minHeight: 70,
        borderWidth: 1,
        borderColor: '#374151',
        marginBottom: 8,
        textAlignVertical: 'top',
    },
});