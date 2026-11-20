package com.snowbeats.metadata

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.URL
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

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
            dominantHex = String.format(
              "#%02X%02X%02X",
              Color.red(pixel),
              Color.green(pixel),
              Color.blue(pixel)
            )
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

    // Extrae letras incrustadas (ID3v2 SYLT/USLT/TXXX, MP4 ©lyr, FLAC/OGG Vorbis) o archivo .lrc hermano
    AsyncFunction("readTrackLyrics") { uriText: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      try {
        val uri = Uri.parse(uriText)
        val companionLrc = readCompanionLrc(ctx, uri)
        if (!companionLrc.isNullOrBlank() && companionLrc.contains("[")) {
          return@AsyncFunction companionLrc.trim()
        }

        val embedded = extractEmbeddedLyrics(ctx, uri)
        if (!embedded.isNullOrBlank()) {
          return@AsyncFunction embedded.trim()
        }

        companionLrc?.trim()?.takeIf { it.isNotEmpty() }
      } catch (_: Exception) {
        null
      }
    }

    // Renderiza una tarjeta PNG en alta resolución (1080px) para compartir canción o fragmento de letra
    AsyncFunction("renderShareCard") { options: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      try {
        renderShareCardPng(ctx, options)
      } catch (_: Exception) {
        null
      }
    }
  }

  // ==================== EXTRACCIÓN DE LETRAS INCRUSTADAS ====================

  private fun readCompanionLrc(ctx: Context, uri: Uri): String? {
    val filePath = resolveFilePath(ctx, uri) ?: return null
    val dotIdx = filePath.lastIndexOf('.')
    if (dotIdx <= 0) return null
    val lrcFile = File(filePath.substring(0, dotIdx) + ".lrc")
    if (!lrcFile.exists() || !lrcFile.canRead() || lrcFile.length() > 512 * 1024) return null
    return try {
      lrcFile.readText(StandardCharsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  private fun resolveFilePath(ctx: Context, uri: Uri): String? {
    if (uri.scheme == "file") return uri.path
    if (uri.scheme != "content") return null
    return try {
      ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun extractEmbeddedLyrics(ctx: Context, uri: Uri): String? {
    val header = ByteArray(16)
    ctx.contentResolver.openInputStream(uri)?.use { stream ->
      val read = readFully(stream, header, 0, header.size)
      if (read < 4) return null
    } ?: return null

    // 1. MP3 con cabecera ID3v2
    if (header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
      return parseId3v2Lyrics(ctx, uri)
    }

    // 2. FLAC (fLaC)
    if (header[0] == 'f'.code.toByte() && header[1] == 'L'.code.toByte() &&
      header[2] == 'a'.code.toByte() && header[3] == 'C'.code.toByte()
    ) {
      return parseFlacLyrics(ctx, uri)
    }

    // 3. OGG Vorbis (OggS)
    if (header[0] == 'O'.code.toByte() && header[1] == 'g'.code.toByte() &&
      header[2] == 'g'.code.toByte() && header[3] == 'S'.code.toByte()
    ) {
      return parseOggVorbisLyrics(ctx, uri)
    }

    // 4. M4A / MP4 (ftyp en bytes 4..7)
    if (header[4] == 'f'.code.toByte() && header[5] == 't'.code.toByte() &&
      header[6] == 'y'.code.toByte() && header[7] == 'p'.code.toByte()
    ) {
      return parseMp4Lyrics(ctx, uri)
    }

    return null
  }

  private fun parseId3v2Lyrics(ctx: Context, uri: Uri): String? {
    ctx.contentResolver.openInputStream(uri)?.use { stream ->
      val head = ByteArray(10)
      if (readFully(stream, head, 0, 10) < 10) return null
      val majorVer = head[3].toInt() and 0xFF
      val flags = head[5].toInt() and 0xFF
      val tagSize = syncSafeToInt(head, 6)
      if (tagSize <= 0 || tagSize > 8 * 1024 * 1024) return null

      val tagBytes = ByteArray(tagSize)
      val got = readFully(stream, tagBytes, 0, tagSize)
      if (got <= 0) return null

      var pos = 0
      // Salta cabecera extendida si existe
      if ((flags and 0x40) != 0 && got >= 4) {
        val extSize = if (majorVer == 4) syncSafeToInt(tagBytes, 0) else bigEndianInt(tagBytes, 0)
        pos += if (majorVer == 4) extSize else (extSize + 4)
      }

      var syncedResult: String? = null
      var unsyncedResult: String? = null

      while (pos + 10 <= got) {
        val frameId = String(tagBytes, pos, 4, StandardCharsets.ISO_8859_1)
        if (frameId[0] == '\u0000') break
        val frameSize = if (majorVer == 4) syncSafeToInt(tagBytes, pos + 4) else bigEndianInt(tagBytes, pos + 4)
        pos += 10
        if (frameSize <= 0 || pos + frameSize > got) break

        when (frameId) {
          "SYLT" -> {
            val parsed = decodeSyltFrame(tagBytes, pos, frameSize)
            if (!parsed.isNullOrBlank()) syncedResult = parsed
          }
          "USLT" -> {
            val parsed = decodeUsltFrame(tagBytes, pos, frameSize)
            if (!parsed.isNullOrBlank()) {
              if (parsed.contains("[") && syncedResult == null) {
                syncedResult = parsed
              } else if (unsyncedResult == null) {
                unsyncedResult = parsed
              }
            }
          }
          "TXXX" -> {
            val parsed = decodeTxxxLyricsFrame(tagBytes, pos, frameSize)
            if (!parsed.isNullOrBlank()) {
              if (parsed.contains("[") && syncedResult == null) {
                syncedResult = parsed
              } else if (unsyncedResult == null) {
                unsyncedResult = parsed
              }
            }
          }
        }
        pos += frameSize
      }

      return syncedResult ?: unsyncedResult
    }
    return null
  }

  private fun decodeUsltFrame(data: ByteArray, offset: Int, length: Int): String? {
    if (length < 5) return null
    val encoding = data[offset].toInt() and 0xFF
    var cursor = offset + 4 // 1 byte encoding + 3 bytes idioma
    val end = offset + length
    // Salta la descripción de contenido terminada en nulo
    cursor = skipNullTerminated(data, cursor, end, encoding)
    if (cursor >= end) return null
    return decodeId3Text(data, cursor, end - cursor, encoding).trim().takeIf { it.isNotEmpty() }
  }

  private fun decodeTxxxLyricsFrame(data: ByteArray, offset: Int, length: Int): String? {
    if (length < 2) return null
    val encoding = data[offset].toInt() and 0xFF
    val start = offset + 1
    val end = offset + length
    val nextPos = skipNullTerminated(data, start, end, encoding)
    val descLen = max(0, nextPos - start - if (encoding == 1 || encoding == 2) 2 else 1)
    val desc = decodeId3Text(data, start, descLen, encoding).uppercase()
    if (!desc.contains("LYRIC")) return null
    if (nextPos >= end) return null
    return decodeId3Text(data, nextPos, end - nextPos, encoding).trim().takeIf { it.isNotEmpty() }
  }

  private fun decodeSyltFrame(data: ByteArray, offset: Int, length: Int): String? {
    if (length < 7) return null
    val encoding = data[offset].toInt() and 0xFF
    val timestampFormat = data[offset + 4].toInt() and 0xFF
    if (timestampFormat != 2) return null // 2 = milisegundos
    val end = offset + length
    var cursor = skipNullTerminated(data, offset + 6, end, encoding)
    val sb = StringBuilder()

    while (cursor < end) {
      val textStart = cursor
      val afterNull = skipNullTerminated(data, cursor, end, encoding)
      val nullBytes = if (encoding == 1 || encoding == 2) 2 else 1
      val textLen = max(0, afterNull - textStart - nullBytes)
      if (afterNull + 4 > end) break
      val ms = bigEndianInt(data, afterNull).toLong() and 0xFFFFFFFFL
      val chunk = decodeId3Text(data, textStart, textLen, encoding).replace("\r", "").trim()
      if (chunk.isNotEmpty()) {
        val mins = (ms / 60000L).toInt()
        val secs = ((ms % 60000L) / 1000L).toInt()
        val cs = ((ms % 1000L) / 10L).toInt()
        sb.append(String.format("[%02d:%02d.%02d]%s\n", mins, secs, cs, chunk))
      }
      cursor = afterNull + 4
    }
    return sb.toString().trim().takeIf { it.isNotEmpty() }
  }

  private fun skipNullTerminated(data: ByteArray, start: Int, end: Int, encoding: Int): Int {
    var i = start
    if (encoding == 1 || encoding == 2) {
      while (i + 1 < end) {
        if (data[i].toInt() == 0 && data[i + 1].toInt() == 0) return i + 2
        i += 2
      }
      return end
    }
    while (i < end) {
      if (data[i].toInt() == 0) return i + 1
      i++
    }
    return end
  }

  private fun decodeId3Text(data: ByteArray, offset: Int, length: Int, encoding: Int): String {
    if (length <= 0) return ""
    val charset: Charset = when (encoding) {
      1 -> StandardCharsets.UTF_16
      2 -> StandardCharsets.UTF_16BE
      3 -> StandardCharsets.UTF_8
      else -> StandardCharsets.ISO_8859_1
    }
    return String(data, offset, length, charset).replace("\uFEFF", "").replace("\u0000", "")
  }

  private fun parseFlacLyrics(ctx: Context, uri: Uri): String? {
    ctx.contentResolver.openInputStream(uri)?.use { stream ->
      val magic = ByteArray(4)
      if (readFully(stream, magic, 0, 4) < 4) return null

      while (true) {
        val bh = ByteArray(4)
        if (readFully(stream, bh, 0, 4) < 4) break
        val isLast = (bh[0].toInt() and 0x80) != 0
        val blockType = bh[0].toInt() and 0x7F
        val blockLen = ((bh[1].toInt() and 0xFF) shl 16) or
          ((bh[2].toInt() and 0xFF) shl 8) or
          (bh[3].toInt() and 0xFF)

        if (blockType == 4 && blockLen in 1..(2 * 1024 * 1024)) {
          val commentBytes = ByteArray(blockLen)
          if (readFully(stream, commentBytes, 0, blockLen) == blockLen) {
            return parseVorbisCommentLyrics(commentBytes)
          }
          break
        } else {
          if (skipExact(stream, blockLen.toLong()) < blockLen.toLong()) break
        }
        if (isLast) break
      }
    }
    return null
  }

  private fun parseOggVorbisLyrics(ctx: Context, uri: Uri): String? {
    // Lee solo los primeros 256 KB donde viven las cabeceras de comentarios Vorbis
    ctx.contentResolver.openInputStream(uri)?.use { stream ->
      val buf = readUpTo(stream, 256 * 1024)
      val marker = byteArrayOf(0x03, 'v'.code.toByte(), 'o'.code.toByte(), 'r'.code.toByte(), 'b'.code.toByte(), 'i'.code.toByte(), 's'.code.toByte())
      val idx = indexOfBytes(buf, marker)
      if (idx >= 0 && idx + marker.size < buf.size) {
        val slice = buf.copyOfRange(idx + marker.size, buf.size)
        return parseVorbisCommentLyrics(slice)
      }
    }
    return null
  }

  private fun parseVorbisCommentLyrics(data: ByteArray): String? {
    if (data.size < 8) return null
    var pos = 0
    val vendorLen = littleEndianInt(data, pos)
    pos += 4 + max(0, vendorLen)
    if (pos + 4 > data.size) return null
    val count = littleEndianInt(data, pos)
    pos += 4

    var synced: String? = null
    var plain: String? = null
    for (i in 0 until min(count, 200)) {
      if (pos + 4 > data.size) break
      val len = littleEndianInt(data, pos)
      pos += 4
      if (len < 0 || pos + len > data.size) break
      val entry = String(data, pos, len, StandardCharsets.UTF_8)
      pos += len
      val eq = entry.indexOf('=')
      if (eq > 0) {
        val key = entry.substring(0, eq).uppercase()
        val value = entry.substring(eq + 1).trim()
        if (value.isNotEmpty() && (key == "LYRICS" || key == "UNSYNCEDLYRICS" || key == "SYNCEDLYRICS")) {
          if (value.contains("[") && synced == null) synced = value else if (plain == null) plain = value
        }
      }
    }
    return synced ?: plain
  }

  private fun parseMp4Lyrics(ctx: Context, uri: Uri): String? {
    // Lee las cabeceras/átomos MP4 buscando ©lyr dentro de moov -> udta -> meta -> ilst
    ctx.contentResolver.openInputStream(uri)?.use { stream ->
      val buf = readUpTo(stream, 4 * 1024 * 1024)
      val lyrMarker = byteArrayOf(0xA9.toByte(), 'l'.code.toByte(), 'y'.code.toByte(), 'r'.code.toByte())
      val idx = indexOfBytes(buf, lyrMarker)
      if (idx < 4 || idx + 20 >= buf.size) return null

      val atomSize = bigEndianInt(buf, idx - 4)
      val atomEnd = min(buf.size, (idx - 4) + max(atomSize, 0))
      val dataMarker = byteArrayOf('d'.code.toByte(), 'a'.code.toByte(), 't'.code.toByte(), 'a'.code.toByte())
      val dataIdx = indexOfBytes(buf, dataMarker, idx + 4, atomEnd)
      if (dataIdx < 4 || dataIdx + 12 >= atomEnd) return null

      val dataSize = bigEndianInt(buf, dataIdx - 4)
      val textStart = dataIdx + 12 // 4 'data' + 4 type + 4 locale
      val textEnd = min(atomEnd, (dataIdx - 4) + dataSize)
      if (textStart >= textEnd) return null
      return String(buf, textStart, textEnd - textStart, StandardCharsets.UTF_8).trim().takeIf { it.isNotEmpty() }
    }
    return null
  }

  // ==================== RENDERIZADO NATIVO DE TARJETA COMPARTIBLE (PNG 1080px) ====================

  private fun renderShareCardPng(ctx: Context, options: Map<String, Any?>): String? {
    val mode = (options["mode"] as? String) ?: "song"
    val title = (options["title"] as? String)?.ifBlank { "Sin título" } ?: "Sin título"
    val artist = (options["artist"] as? String)?.ifBlank { "Artista desconocido" } ?: "Artista desconocido"
    val artworkUri = options["artworkUri"] as? String
    val logoUri = options["logoUri"] as? String
    val bgImageUri = options["bgImageUri"] as? String
    val bgColorHex = (options["bgColor"] as? String) ?: "#1E1E24"
    val bgColorBottomHex = (options["bgColorBottom"] as? String) ?: bgColorHex
    val textColorHex = (options["textColor"] as? String) ?: "#FFFFFF"
    val mutedColorHex = (options["mutedColor"] as? String) ?: "#CCCCCC"
    val fontStyle = (options["fontStyle"] as? String) ?: "classic"
    val textAlignStr = (options["textAlign"] as? String) ?: "left"
    val uppercase = (options["uppercase"] as? Boolean) ?: false
    @Suppress("UNCHECKED_CAST")
    val rawLines = (options["lines"] as? List<*>)?.mapNotNull { it?.toString() } ?: emptyList()

    val cardWidth = 1080
    val pad = 76
    val contentWidth = cardWidth - pad * 2

    val primaryColor = parseHexColor(textColorHex, Color.WHITE)
    val secondaryColor = parseHexColor(mutedColorHex, Color.argb(200, 255, 255, 255))
    val topColor = parseHexColor(bgColorHex, Color.parseColor("#1E1E24"))
    val bottomColor = parseHexColor(bgColorBottomHex, topColor)

    // Prepara StaticLayout para calcular la altura dinámica exacta en modo letra
    val lyricsJoined = rawLines.joinToString("\n").let { if (uppercase) it.uppercase() else it }
    val lyricsPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = primaryColor
      textSize = when (fontStyle) {
        "wide" -> 58f
        "narrow" -> 56f
        else -> 56f
      }
      typeface = when (fontStyle) {
        "italic" -> Typeface.create(Typeface.SERIF, Typeface.BOLD_ITALIC)
        "narrow" -> Typeface.create("sans-serif-condensed", Typeface.BOLD)
        else -> Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      }
      letterSpacing = when (fontStyle) {
        "wide" -> 0.06f
        "narrow" -> -0.02f
        else -> 0f
      }
      if (bgImageUri != null) {
        setShadowLayer(12f, 0f, 3f, Color.argb(160, 0, 0, 0))
      }
    }

    val layoutAlign = when (textAlignStr) {
      "center" -> Layout.Alignment.ALIGN_CENTER
      "right" -> Layout.Alignment.ALIGN_OPPOSITE
      else -> Layout.Alignment.ALIGN_NORMAL
    }

    val lyricsLayout: StaticLayout? = if (mode == "lyrics" && lyricsJoined.isNotBlank()) {
      StaticLayout.Builder.obtain(lyricsJoined, 0, lyricsJoined.length, lyricsPaint, contentWidth)
        .setAlignment(layoutAlign)
        .setLineSpacing(0f, 1.24f)
        .setIncludePad(false)
        .build()
    } else {
      null
    }

    val cardHeight = if (mode == "song") {
      1380
    } else {
      max(1040, 270 + (lyricsLayout?.height ?: 260) + 195)
    }

    val bitmap = Bitmap.createBitmap(cardWidth, cardHeight, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    // Clip con esquinas redondeadas de tarjeta
    val cardRect = RectF(0f, 0f, cardWidth.toFloat(), cardHeight.toFloat())
    val clipPath = Path().apply { addRoundRect(cardRect, 56f, 56f, Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(clipPath)

    // 1. Fondo: imagen personalizada con scrim doble WCAG o gradiente de color
    val bgBmp = bgImageUri?.let { loadBitmapFromUri(ctx, it, 1280) }
    if (bgBmp != null) {
      drawCenterCropBitmap(canvas, bgBmp, cardRect)
      bgBmp.recycle()
      // Scrim protector de doble capa para garantizar legibilidad sobre cualquier foto
      val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(
          0f, 0f, 0f, cardHeight.toFloat(),
          intArrayOf(Color.argb(110, 0, 0, 0), Color.argb(145, 0, 0, 0), Color.argb(190, 0, 0, 0)),
          floatArrayOf(0f, 0.5f, 1f),
          Shader.TileMode.CLAMP
        )
      }
      canvas.drawRect(cardRect, scrimPaint)
    } else {
      val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(
          0f, 0f, 0f, cardHeight.toFloat(),
          topColor,
          bottomColor,
          Shader.TileMode.CLAMP
        )
      }
      canvas.drawRect(cardRect, bgPaint)
    }

    if (mode == "song") {
      // Modo Tarjeta de Canción: Carátula grande centrada + Título + Artista + Logo Snow Beats
      val artSize = cardWidth - pad * 2
      val artRect = RectF(pad.toFloat(), pad.toFloat(), (pad + artSize).toFloat(), (pad + artSize).toFloat())
      drawRoundedArtwork(ctx, canvas, artworkUri, artRect, 36f)

      val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = primaryColor
        textSize = 54f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      }
      val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = secondaryColor
        textSize = 38f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
      }

      val titleY = artRect.bottom + 56f
      val titleLayout = StaticLayout.Builder.obtain(title, 0, title.length, titlePaint, contentWidth)
        .setMaxLines(2)
        .setIncludePad(false)
        .build()
      canvas.save()
      canvas.translate(pad.toFloat(), titleY)
      titleLayout.draw(canvas)
      canvas.restore()

      val artistY = titleY + titleLayout.height + 16f
      val artistLayout = StaticLayout.Builder.obtain(artist, 0, artist.length, artistPaint, contentWidth)
        .setMaxLines(1)
        .setIncludePad(false)
        .build()
      canvas.save()
      canvas.translate(pad.toFloat(), artistY)
      artistLayout.draw(canvas)
      canvas.restore()
    } else {
      // Modo Tarjeta de Letra: Mini carátula + Título + "Canción · Artista" + Letra estilizada
      val thumbSize = 112f
      val thumbRect = RectF(pad.toFloat(), pad.toFloat(), pad + thumbSize, pad + thumbSize)
      drawRoundedArtwork(ctx, canvas, artworkUri, thumbRect, 18f)

      val metaLeft = pad + thumbSize + 28f
      val metaWidth = (cardWidth - pad - metaLeft).toInt()
      val headerTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = primaryColor
        textSize = 36f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      }
      val headerSubPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = secondaryColor
        textSize = 29f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
      }

      val headerTitleLayout = StaticLayout.Builder.obtain(title, 0, title.length, headerTitlePaint, metaWidth)
        .setMaxLines(1)
        .setIncludePad(false)
        .build()
      canvas.save()
      canvas.translate(metaLeft, pad + 14f)
      headerTitleLayout.draw(canvas)
      canvas.restore()

      val subText = "Canción · $artist"
      val headerSubLayout = StaticLayout.Builder.obtain(subText, 0, subText.length, headerSubPaint, metaWidth)
        .setMaxLines(1)
        .setIncludePad(false)
        .build()
      canvas.save()
      canvas.translate(metaLeft, pad + 62f)
      headerSubLayout.draw(canvas)
      canvas.restore()

      if (lyricsLayout != null) {
        canvas.save()
        canvas.translate(pad.toFloat(), 252f)
        lyricsLayout.draw(canvas)
        canvas.restore()
      }
    }

    // Marca de agua inferior: Logo Snow Beats + texto "Snow Beats"
    val brandY = cardHeight - pad - 58f
    drawSnowBeatsBrand(ctx, canvas, logoUri, pad.toFloat(), brandY, primaryColor)

    canvas.restore()

    val dir = File(ctx.cacheDir, "snow_shares").apply { mkdirs() }
    val outFile = File(dir, "snow_beats_${System.currentTimeMillis()}.png")
    FileOutputStream(outFile).use { fos ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 95, fos)
    }
    bitmap.recycle()
    return "file://${outFile.absolutePath}"
  }

  private fun drawRoundedArtwork(ctx: Context, canvas: Canvas, artworkUri: String?, rect: RectF, radius: Float) {
    val bmp = artworkUri?.let { loadBitmapFromUri(ctx, it, 1024) }
    val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(path)
    if (bmp != null) {
      drawCenterCropBitmap(canvas, bmp, rect)
      bmp.recycle()
    } else {
      val phPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#27272A") }
      canvas.drawRect(rect, phPaint)
      val notePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#71717A")
        textSize = rect.width() * 0.34f
        textAlign = Paint.Align.CENTER
      }
      val cy = rect.centerY() - (notePaint.descent() + notePaint.ascent()) / 2f
      canvas.drawText("♪", rect.centerX(), cy, notePaint)
    }
    canvas.restore()
  }

  private fun drawSnowBeatsBrand(
    ctx: Context,
    canvas: Canvas,
    logoUri: String?,
    left: Float,
    top: Float,
    inkColor: Int
  ) {
    val iconSize = 54f
    val iconRect = RectF(left, top, left + iconSize, top + iconSize)
    val logoBmp = logoUri?.let { loadBitmapFromUri(ctx, it, 192) }

    if (logoBmp != null) {
      val path = Path().apply { addRoundRect(iconRect, 12f, 12f, Path.Direction.CW) }
      canvas.save()
      canvas.clipPath(path)
      drawCenterCropBitmap(canvas, logoBmp, iconRect)
      canvas.restore()
      logoBmp.recycle()
    } else {
      // Fallback vectorial minimalista de copo de nieve Snow Beats
      val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = inkColor
        strokeWidth = 4.5f
        strokeCap = Paint.Cap.ROUND
      }
      val cx = iconRect.centerX()
      val cy = iconRect.centerY()
      val r = iconSize * 0.42f
      for (i in 0 until 6) {
        val angle = Math.toRadians((i * 60).toDouble())
        val dx = (cos(angle) * r).toFloat()
        val dy = (sin(angle) * r).toFloat()
        canvas.drawLine(cx, cy, cx + dx, cy + dy, p)
      }
    }

    val brandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = inkColor
      textSize = 36f
      typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }
    val textY = top + iconSize / 2f - (brandPaint.descent() + brandPaint.ascent()) / 2f
    canvas.drawText("Snow Beats", left + iconSize + 18f, textY, brandPaint)
  }

  private fun drawCenterCropBitmap(canvas: Canvas, bmp: Bitmap, dst: RectF) {
    val srcRatio = bmp.width.toFloat() / max(1, bmp.height).toFloat()
    val dstRatio = dst.width() / max(1f, dst.height())
    val srcRect = if (srcRatio > dstRatio) {
      val newW = (bmp.height * dstRatio).toInt()
      val x = (bmp.width - newW) / 2
      Rect(x, 0, x + newW, bmp.height)
    } else {
      val newH = (bmp.width / dstRatio).toInt()
      val y = (bmp.height - newH) / 2
      Rect(0, y, bmp.width, y + newH)
    }
    canvas.drawBitmap(bmp, srcRect, dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
  }

  private fun loadBitmapFromUri(ctx: Context, uriStr: String, maxDim: Int): Bitmap? {
    return try {
      val bytes = when {
        uriStr.startsWith("file://") -> File(Uri.parse(uriStr).path ?: return null).readBytes()
        uriStr.startsWith("content://") -> ctx.contentResolver.openInputStream(Uri.parse(uriStr))?.use { it.readBytes() }
        uriStr.startsWith("http://") || uriStr.startsWith("https://") -> URL(uriStr).openStream().use { it.readBytes() }
        else -> {
          // Recurso empaquetado de Android en builds release (drawable)
          val resId = ctx.resources.getIdentifier(uriStr, "drawable", ctx.packageName)
          if (resId != 0) return BitmapFactory.decodeResource(ctx.resources, resId)
          null
        }
      } ?: return null

      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (bounds.outWidth / sample > maxDim || bounds.outHeight / sample > maxDim) {
        sample *= 2
      }
      val opts = BitmapFactory.Options().apply { inSampleSize = sample }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    } catch (_: Exception) {
      null
    }
  }

  // ==================== UTILIDADES BINARIAS ====================

  private fun parseHexColor(hex: String, fallback: Int): Int {
    return try {
      Color.parseColor(hex)
    } catch (_: Exception) {
      fallback
    }
  }

  private fun readFully(stream: InputStream, buffer: ByteArray, offset: Int, length: Int): Int {
    var total = 0
    while (total < length) {
      val r = stream.read(buffer, offset + total, length - total)
      if (r <= 0) break
      total += r
    }
    return total
  }

  private fun readUpTo(stream: InputStream, maxBytes: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val chunk = ByteArray(16384)
    var remaining = maxBytes
    while (remaining > 0) {
      val r = stream.read(chunk, 0, min(chunk.size, remaining))
      if (r <= 0) break
      out.write(chunk, 0, r)
      remaining -= r
    }
    return out.toByteArray()
  }

  private fun skipExact(stream: InputStream, bytes: Long): Long {
    var remaining = bytes
    while (remaining > 0) {
      val skipped = stream.skip(remaining)
      if (skipped <= 0) {
        if (stream.read() == -1) break
        remaining -= 1
      } else {
        remaining -= skipped
      }
    }
    return bytes - remaining
  }

  private fun syncSafeToInt(b: ByteArray, off: Int): Int =
    ((b[off].toInt() and 0x7F) shl 21) or
      ((b[off + 1].toInt() and 0x7F) shl 14) or
      ((b[off + 2].toInt() and 0x7F) shl 7) or
      (b[off + 3].toInt() and 0x7F)

  private fun bigEndianInt(b: ByteArray, off: Int): Int =
    ((b[off].toInt() and 0xFF) shl 24) or
      ((b[off + 1].toInt() and 0xFF) shl 16) or
      ((b[off + 2].toInt() and 0xFF) shl 8) or
      (b[off + 3].toInt() and 0xFF)

  private fun littleEndianInt(b: ByteArray, off: Int): Int =
    (b[off].toInt() and 0xFF) or
      ((b[off + 1].toInt() and 0xFF) shl 8) or
      ((b[off + 2].toInt() and 0xFF) shl 16) or
      ((b[off + 3].toInt() and 0xFF) shl 24)

  private fun indexOfBytes(haystack: ByteArray, needle: ByteArray, from: Int = 0, to: Int = haystack.size): Int {
    val limit = min(to, haystack.size) - needle.size
    outer@ for (i in max(0, from)..limit) {
      for (j in needle.indices) {
        if (haystack[i + j] != needle[j]) continue@outer
      }
      return i
    }
    return -1
  }
}