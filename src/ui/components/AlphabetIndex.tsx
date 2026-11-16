import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface AlphabetIndexProps {
    visible: boolean;
    onSelectLetter: (letter: string) => void;
}

export const AlphabetIndex: React.FC<AlphabetIndexProps> = ({ visible, onSelectLetter }) => {
    const [activeLetter, setActiveLetter] = useState<string | null>(null);

    if (!visible) return null;

    const handlePress = (letter: string) => {
        setActiveLetter(letter);
        onSelectLetter(letter);
        setTimeout(() => setActiveLetter(null), 900);
    };

    return (
        <>
            {activeLetter && (
                <View style={styles.pill}>
                    <Text style={styles.pillText}>{activeLetter}</Text>
                </View>
            )}
            <View style={styles.bar}>
                {LETTERS.map((letter) => (
                    <TouchableOpacity key={letter} onPress={() => handlePress(letter)} style={styles.item}>
                        <Text style={styles.letter}>{letter}</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </>
    );
};

const styles = StyleSheet.create({
    bar: {
        position: 'absolute',
        right: 2,
        top: 12,
        bottom: 12,
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 4,
        zIndex: 10,
    },
    item: { paddingHorizontal: 5, paddingVertical: 1 },
    letter: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700' },
    pill: {
        position: 'absolute',
        right: 34,
        top: '45%',
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 20,
    },
    pillText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
});