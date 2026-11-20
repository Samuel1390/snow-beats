import { Track } from '../../types/music';
import { upsertScannedTracks } from '../database/db';

// Lee la duración real de un archivo de audio en el navegador mediante HTMLAudioElement
function readAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve(180);
      return;
    }
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (val: number) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(Number.isFinite(val) && val > 0 ? val : 180);
    };
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(180);
    audio.src = url;
  });
}

// Abre el selector de archivos del navegador para probar pistas locales en la vista web
export function pickWebAudioFiles(): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(0);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;

    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(0);
        return;
      }

      const tracks: Track[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uri = URL.createObjectURL(file);
        const duration = await readAudioDuration(uri);
        const cleanName = file.name.replace(/\.[^/.]+$/, '').trim();
        const parts = cleanName.split(' - ');
        const artist = parts.length > 1 ? parts[0].trim() : 'Artista desconocido';
        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanName;

        tracks.push({
          id: `web_${Date.now()}_${i}_${file.name}`,
          uri,
          filename: file.name,
          title,
          artist,
          album: 'Biblioteca Web',
          duration,
          artworkUri: null,
          hasLyrics: false,
          folderPath: '/Web/Audio',
          creationTime: file.lastModified || Date.now(),
          playCount: 0,
          isFavorite: false,
          isHidden: false,
          isDeleted: false,
        });
      }

      await upsertScannedTracks(tracks);
      resolve(tracks.length);
    };

    input.click();
  });
}
