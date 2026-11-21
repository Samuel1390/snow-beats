const {
    withAndroidManifest,
    withAppBuildGradle,
    withGradleProperties,
} = require('@expo/config-plugins');

// Plugin de Expo para configurar extractNativeLibs, legacy packaging (yt-dlp/FFmpeg) y almacenamiento en Android
module.exports = function withSnowBeatsAndroid(config) {
    // 1. Habilita expo.useLegacyPackaging en gradle.properties para que Expo SDK 58/AGP 9 extraiga libpython.zip.so y libytdlp.zip.so
    config = withGradleProperties(config, (mod) => {
        const key = 'expo.useLegacyPackaging';
        const existing = mod.modResults.find((item) => item.type === 'property' && item.key === key);
        if (existing) {
            existing.value = 'true';
        } else {
            mod.modResults.push({
                type: 'property',
                key,
                value: 'true',
            });
        }
        return mod;
    });

    // 2. Fuerza android:extractNativeLibs="true" con tools:replace para que el merger de Manifest nunca lo sobreescriba a false
    config = withAndroidManifest(config, (mod) => {
        const manifest = mod.modResults.manifest;
        if (!manifest.$) manifest.$ = {};
        if (!manifest.$['xmlns:tools']) {
            manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
        }

        const app = manifest.application?.[0];
        if (app) {
            if (!app.$) app.$ = {};
            app.$['android:extractNativeLibs'] = 'true';
            app.$['android:requestLegacyExternalStorage'] = 'true';

            const currentReplace = (app.$['tools:replace'] || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (!currentReplace.includes('android:extractNativeLibs')) {
                currentReplace.push('android:extractNativeLibs');
            }
            app.$['tools:replace'] = currentReplace.join(',');
        }
        return mod;
    });

    // 3. Solo inyecta packaging { jniLibs { useLegacyPackaging = true } } si el template de Expo no lee ya expo.useLegacyPackaging
    config = withAppBuildGradle(config, (mod) => {
        let contents = mod.modResults.contents;

        // Expo SDK 58 ya lee findProperty('expo.useLegacyPackaging') desde gradle.properties (configurado arriba en true)
        if (contents.includes('expo.useLegacyPackaging')) {
            return mod;
        }

        if (/^\s*useLegacyPackaging\s*=?\s*[^\n]+$/m.test(contents)) {
            contents = contents.replace(
                /^(\s*)useLegacyPackaging\s*=?\s*[^\n]+$/m,
                '$1useLegacyPackaging = true'
            );
        } else if (/jniLibs\s*\{/.test(contents)) {
            contents = contents.replace(
                /jniLibs\s*\{/,
                'jniLibs {\n            useLegacyPackaging = true'
            );
        } else if (/packagingOptions\s*\{/.test(contents)) {
            contents = contents.replace(
                /packagingOptions\s*\{/,
                'packagingOptions {\n        jniLibs {\n            useLegacyPackaging = true\n        }'
            );
        } else if (/packaging\s*\{/.test(contents)) {
            contents = contents.replace(
                /packaging\s*\{/,
                'packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }'
            );
        } else {
            contents = contents.replace(
                /android\s*\{/,
                'android {\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }'
            );
        }

        mod.modResults.contents = contents;
        return mod;
    });

    return config;
};
