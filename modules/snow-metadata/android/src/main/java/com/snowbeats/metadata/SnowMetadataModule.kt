package com.snowbeats.metadata

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class SnowMetadataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnowMetadata")

    // Extrae etiquetas ID3, guarda la portada en caché y devuelve el color dominante hex
    AsyncFunction("readTrackTags") { uriText: String, trackId: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val mmr = MediaMetadataRetriever()

      try {
        mmr.setDataSource(ctx, Uri.parse(uriText))

        val title = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
        val artist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
        val album = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)

        var artworkUri: String? = null
        var dominantHex: String? = null

        val bytes = mmr.embeddedPicture
        if (bytes != null && bytes.isNotEmpty()) {
          val dir = File(ctx.cacheDir, "snow_artworks").apply { mkdirs() }
          val outFile = File(dir, "$trackId.jpg")

          if (!outFile.exists()) {
            FileOutputStream(outFile).use { it.write(bytes) }
          }
          artworkUri = "file://${outFile.absolutePath}"

          // Escala a 1x1 para obtener el color promedio rápido sin bloquear memoria
          val rawBmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
          if (rawBmp != null) {
            val tiny = Bitmap.createScaledBitmap(rawBmp, 1, 1, true)
            val pixel = tiny.getPixel(0, 0)
            dominantHex = String.format("#%02X%02X%02X", Color.red(pixel), Color.green(pixel), Color.blue(pixel))
            tiny.recycle()
            rawBmp.recycle()
          }
        }

        mapOf(
          "title" to title,
          "artist" to artist,
          "album" to album,
          "artworkUri" to artworkUri,
          "dominantColor" to dominantHex
        )
      } catch (_: Exception) {
        null
      } finally {
        try { mmr.release() } catch (_: Exception) {}
      }
    }
  }
}