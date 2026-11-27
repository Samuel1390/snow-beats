package com.snowbeats.metadata

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
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
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.os.bundleOf
import androidx.core.text.HtmlCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class SnowMetadataModule : Module() {
  private var pendingStoragePermPromise: Promise? = null
  private var pendingLyricsFilePromise: Promise? = null

  companion object {
    private const val LYRICS_FILE_REQUEST_CODE = 5095
    private const val MAX_LYRICS_FILE_BYTES = 512 * 1024
  }

  override fun definition() = ModuleDefinition {
    Name("SnowMetadata")

    Events("onMediaAction", "onDownloadProgress")

    OnCreate {
      SnowMediaNotificationService.actionListener = { action, positionSec ->
        try {
          sendEvent(
            "onMediaAction",
            bundleOf(
              "action" to action,
              "positionSec" to (positionSec ?: -1.0)
            )
          )
        } catch (_: Exception) { }
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == SnowDownloaderEngine.SAF_TREE_REQUEST_CODE) {
        val ctx = appContext.reactContext
        val granted = if (ctx != null) {
          SnowDownloaderEngine.handleSafResult(ctx, payload.resultCode, payload.data)
        } else {
          false
        }
        pendingStoragePermPromise?.resolve(granted)
        pendingStoragePermPromise = null
      } else if (payload.requestCode == LYRICS_FILE_REQUEST_CODE) {
        val promise = pendingLyricsFilePromise
        pendingLyricsFilePromise = null
        val ctx = appContext.reactContext
        if (promise != null) {
          if (payload.resultCode != Activity.RESULT_OK || payload.data?.data == null || ctx == null) {
            promise.resolve(mapOf("ok" to false, "cancelled" to true))
          } else {
            promise.resolve(readPickedLyricsDocument(ctx, payload.data!!.data!!))
          }
        }
      }
    }

    OnDestroy {
      SnowMediaNotificationService.actionListener = null
      pendingStoragePermPromise?.resolve(false)
      pendingStoragePermPromise = null
      pendingLyricsFilePromise?.resolve(mapOf("ok" to false, "cancelled" to true))
      pendingLyricsFilePromise = null
    }

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

          val rawBmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
          if (rawBmp != null) {
            dominantHex = extractDominantColorHex(rawBmp)
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

    // Solicita permiso POST_NOTIFICATIONS en Android 13+ para mostrar el control flotante
    AsyncFunction("requestNotificationPermission") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@AsyncFunction true
      val granted = ContextCompat.checkSelfPermission(
        ctx,
        Manifest.permission.POST_NOTIFICATIONS
      ) == PackageManager.PERMISSION_GRANTED
      if (granted) return@AsyncFunction true
      val act = appContext.currentActivity
      if (act != null) {
        ActivityCompat.requestPermissions(
          act,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          4103
        )
      }
      false
    }

    // Actualiza o inicia el control multimedia flotante clásico en la barra de notificaciones
    AsyncFunction("updateMediaNotification") { payload: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      try {
        val intent = Intent(ctx, SnowMediaNotificationService::class.java).apply {
          action = SnowMediaNotificationService.ACTION_UPDATE
          putExtra(SnowMediaNotificationService.EXTRA_TITLE, (payload["title"] as? String) ?: "Snow Beats")
          putExtra(SnowMediaNotificationService.EXTRA_ARTIST, (payload["artist"] as? String) ?: "")
          putExtra(SnowMediaNotificationService.EXTRA_ALBUM, (payload["album"] as? String) ?: "")
          putExtra(SnowMediaNotificationService.EXTRA_ARTWORK, payload["artworkUri"] as? String)
          putExtra(SnowMediaNotificationService.EXTRA_IS_PLAYING, (payload["isPlaying"] as? Boolean) ?: false)
          putExtra(SnowMediaNotificationService.EXTRA_IS_FAVORITE, (payload["isFavorite"] as? Boolean) ?: false)
          putExtra(SnowMediaNotificationService.EXTRA_POSITION_MS, ((payload["positionMs"] as? Number)?.toLong()) ?: 0L)
          putExtra(SnowMediaNotificationService.EXTRA_DURATION_MS, ((payload["durationMs"] as? Number)?.toLong()) ?: 0L)
          putExtra(SnowMediaNotificationService.EXTRA_SPEED, ((payload["speed"] as? Number)?.toFloat()) ?: 1.0f)
        }
        val isPlaying = (payload["isPlaying"] as? Boolean) ?: false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isPlaying) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
        true
      } catch (_: Exception) {
        false
      }
    }

    // Cierra la notificación multimedia flotante
    AsyncFunction("dismissMediaNotification") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      try {
        val intent = Intent(ctx, SnowMediaNotificationService::class.java).apply {
          action = SnowMediaNotificationService.ACTION_DISMISS
        }
        ctx.startService(intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    // Abre únicamente apps de correo con cuerpo HTML y hasta 5 imágenes adjuntas mediante FileProvider
    AsyncFunction("sendEmailWithAttachments") { to: String, subject: String, plainBody: String, htmlBody: String, imageUris: List<String> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      launchEmailWithAttachments(ctx, to, subject, plainBody, htmlBody, imageUris)
    }

    // Controla la orientación de pantalla y barras inmersivas para pantalla completa horizontal en Videos
    AsyncFunction("setScreenOrientation") { mode: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      try {
        activity.runOnUiThread {
          try {
            val window = activity.window
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            when (mode) {
              "landscape" -> {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                controller.systemBarsBehavior =
                  WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
              }
              "unspecified" -> {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                controller.show(WindowInsetsCompat.Type.systemBars())
              }
              else -> {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                controller.show(WindowInsetsCompat.Type.systemBars())
              }
            }
          } catch (_: Exception) { }
        }
        true
      } catch (_: Exception) {
        false
      }
    }

    // Verifica permiso de escritura en almacenamiento interno para guardar descargas
    AsyncFunction("hasStorageWritePermission") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      SnowDownloaderEngine.hasStorageWritePermission(ctx)
    }

    // Solicita permiso de carpeta vía SAF en Android 11+ (sin bloqueos en HyperOS) o WRITE_EXTERNAL_STORAGE en <=10
    AsyncFunction("requestStorageWritePermission") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (SnowDownloaderEngine.hasStorageWritePermission(activity)) {
        promise.resolve(true)
        return@AsyncFunction
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        pendingStoragePermPromise?.resolve(false)
        pendingStoragePermPromise = promise
        val launched = SnowDownloaderEngine.launchStoragePermissionRequest(activity)
        if (!launched) {
          pendingStoragePermPromise = null
          promise.resolve(false)
        }
      } else {
        val launched = SnowDownloaderEngine.launchStoragePermissionRequest(activity)
        promise.resolve(launched)
      }
    }

    // Extrae información, streaming y formatos ordenados (o lista de reproducción) con yt-dlp
    AsyncFunction("extractMediaInfo") { url: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf(
        "ok" to false,
        "errorCode" to "NO_CONTEXT",
        "errorMessage" to "Contexto nativo no disponible."
      )
      SnowDownloaderEngine.extractMediaInfo(ctx, url)
    }

    // Ejecuta descarga mediante yt-dlp emitiendo progreso en tiempo real
    AsyncFunction("downloadMedia") { options: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf(
        "ok" to false,
        "errorCode" to "NO_CONTEXT",
        "errorMessage" to "Contexto nativo no disponible."
      )
      val taskId = (options["taskId"] as? String) ?: "dl_${System.currentTimeMillis()}"
      val url = (options["url"] as? String) ?: ""
      val formatId = (options["formatId"] as? String) ?: ""
      val mediaType = (options["mediaType"] as? String) ?: "audio"
      val audioQuality = options["audioQuality"] as? String
      val targetPath = (options["targetPath"] as? String) ?: "Almacenamiento interno/Snow beats/Download"
      val directStreamUrl = options["directStreamUrl"] as? String
      @Suppress("UNCHECKED_CAST")
      val rawHeaders = options["headers"] as? Map<*, *>
      val parsedHeaders = rawHeaders
        ?.entries
        ?.mapNotNull { (k, v) ->
          val ks = k?.toString()?.trim()
          val vs = v?.toString()?.trim()
          if (!ks.isNullOrEmpty() && !vs.isNullOrEmpty()) ks to vs else null
        }
        ?.toMap()

      var lastEmitMs = 0L
      SnowDownloaderEngine.downloadMedia(
        context = ctx,
        taskId = taskId,
        rawUrl = url,
        formatId = formatId,
        mediaType = mediaType,
        audioQuality = audioQuality,
        targetDisplayPath = targetPath,
        headers = parsedHeaders,
        directStreamUrl = directStreamUrl
      ) { progress, etaInSeconds, line ->
        val now = System.currentTimeMillis()
        if (now - lastEmitMs >= 220L || progress >= 99.5f) {
          lastEmitMs = now
          try {
            sendEvent(
              "onDownloadProgress",
              bundleOf(
                "taskId" to taskId,
                "progress" to progress.toDouble().coerceIn(0.0, 100.0),
                "etaSeconds" to etaInSeconds.toDouble(),
                "line" to line.take(120)
              )
            )
          } catch (_: Exception) { }
        }
      }
    }

    // Cancela una descarga activa de yt-dlp por su taskId
    AsyncFunction("cancelDownload") { taskId: String ->
      SnowDownloaderEngine.cancelDownload(taskId)
    }

    // Guarda la carátula 1:1 recortada en almacenamiento interno persistente y extrae color dominante
    AsyncFunction("persistCoverImage") { sourceUri: String, trackId: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      persistCustomCoverImage(ctx, sourceUri, trackId)
    }

    // Abre el selector nativo de documentos Android para importar archivos .lrc o .txt
    AsyncFunction("pickLyricsFile") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(
          mapOf(
            "ok" to false,
            "errorMessage" to "No hay actividad activa para abrir el selector de archivos."
          )
        )
        return@AsyncFunction
      }
      pendingLyricsFilePromise?.resolve(mapOf("ok" to false, "cancelled" to true))
      pendingLyricsFilePromise = promise
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
        }
        activity.startActivityForResult(intent, LYRICS_FILE_REQUEST_CODE)
      } catch (e: Exception) {
        pendingLyricsFilePromise = null
        promise.resolve(
          mapOf(
            "ok" to false,
            "errorMessage" to (e.message ?: "No se pudo abrir el selector de archivos.")
          )
        )
      }
    }

    // Lee una imagen o enlace de imagen del portapapeles nativo de Android
    AsyncFunction("readClipboardImage") {
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf(
        "ok" to false,
        "errorMessage" to "Contexto nativo no disponible."
      )
      readImageFromClipboard(ctx)
    }

    // Copia la imagen de carátula al portapapeles de Android vía FileProvider
    AsyncFunction("copyImageToClipboard") { sourceUri: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      copyCoverImageToClipboard(ctx, sourceUri)
    }

    // Lee texto plano del portapapeles de Android (para pegar letras o URLs)
    AsyncFunction("readClipboardText") {
      val ctx = appContext.reactContext ?: return@AsyncFunction ""
      readPlainTextFromClipboard(ctx)
    }

    // Copia texto plano al portapapeles de Android
    AsyncFunction("copyTextToClipboard") { text: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      copyPlainTextToClipboard(ctx, text)
    }
  }

  // ==================== ENVÍO DE CORREO (SOLO EMAIL) CON HTML E IMÁGENES ADJUNTAS ====================

  private fun launchEmailWithAttachments(
    ctx: Context,
    to: String,
    subject: String,
    plainBody: String,
    htmlBody: String,
    imageUris: List<String>
  ): Boolean {
    return try {
      val authority = "${ctx.packageName}.snowbeats.fileprovider"
      val cacheDir = File(ctx.cacheDir, "report_attachments").apply { mkdirs() }
      val contentUris = ArrayList<Uri>()

      imageUris.take(5).forEachIndexed { idx, rawUri ->
        try {
          val parsed = Uri.parse(rawUri)
          val dest = File(cacheDir, "snow_report_${System.currentTimeMillis()}_$idx.jpg")
          ctx.contentResolver.openInputStream(parsed)?.use { input ->
            FileOutputStream(dest).use { output -> input.copyTo(output) }
          }
          if (dest.exists() && dest.length() > 0) {
            contentUris.add(FileProvider.getUriForFile(ctx, authority, dest))
          }
        } catch (_: Exception) { }
      }

      // Selector mailto: restringe la resolución estrictamente a clientes de correo (excluye WhatsApp, Telegram, etc.)
      val emailSelector = Intent(Intent.ACTION_SENDTO).apply {
        data = Uri.parse("mailto:")
      }

      // Otorga permiso explícito de lectura FileProvider a todos los clientes de correo instalados
      if (contentUris.isNotEmpty()) {
        try {
          val emailApps = ctx.packageManager.queryIntentActivities(emailSelector, 0)
          for (resolveInfo in emailApps) {
            val pkg = resolveInfo.activityInfo?.packageName ?: continue
            for (uri in contentUris) {
              ctx.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
          }
        } catch (_: Exception) { }
      }

      val richSpanned: CharSequence = if (htmlBody.isNotBlank()) {
        HtmlCompat.fromHtml(htmlBody, HtmlCompat.FROM_HTML_MODE_LEGACY)
      } else {
        plainBody
      }

      val emailIntent = when {
        contentUris.isEmpty() -> {
          Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:")
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, richSpanned)
            if (htmlBody.isNotBlank()) {
              putExtra(Intent.EXTRA_HTML_TEXT, htmlBody)
            }
          }
        }
        contentUris.size == 1 -> {
          Intent(Intent.ACTION_SEND).apply {
            selector = emailSelector
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, richSpanned)
            if (htmlBody.isNotBlank()) {
              putExtra(Intent.EXTRA_HTML_TEXT, htmlBody)
            }
            putExtra(Intent.EXTRA_STREAM, contentUris[0])
            clipData = ClipData.newUri(ctx.contentResolver, "Snow Beats Report", contentUris[0])
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
        }
        else -> {
          Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            selector = emailSelector
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, richSpanned)
            if (htmlBody.isNotBlank()) {
              putExtra(Intent.EXTRA_HTML_TEXT, htmlBody)
            }
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris)
            val clip = ClipData.newUri(ctx.contentResolver, "Snow Beats Report", contentUris[0])
            for (i in 1 until contentUris.size) {
              clip.addItem(ClipData.Item(contentUris[i]))
            }
            clipData = clip
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
        }
      }

      emailIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      try {
        ctx.startActivity(emailIntent)
        true
      } catch (_: Exception) {
        // Respaldo: si el dispositivo no admite selector con adjuntos, abre directamente mailto: solo para email
        val fallbackMailto = Intent(Intent.ACTION_SENDTO).apply {
          data = Uri.parse("mailto:${Uri.encode(to)}")
          putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
          putExtra(Intent.EXTRA_SUBJECT, subject)
          putExtra(Intent.EXTRA_TEXT, richSpanned)
          if (htmlBody.isNotBlank()) {
            putExtra(Intent.EXTRA_HTML_TEXT, htmlBody)
          }
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(fallbackMailto)
        true
      }
    } catch (_: Exception) {
      false
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

  // ==================== EDICIÓN DE CARÁTULA 1:1 E IMPORTACIÓN DE LETRAS ====================

  private fun persistCustomCoverImage(
    ctx: Context,
    sourceUri: String,
    trackId: String
  ): Map<String, String?>? {
    var rawBmp: Bitmap? = null
    var squareBmp: Bitmap? = null
    var finalBmp: Bitmap? = null
    return try {
      rawBmp = decodeCoverBitmap(ctx, sourceUri) ?: return null

      // Asegura relación cuadrada 1:1 (recorte centrado de respaldo si el picker no recortó exacto)
      val side = min(rawBmp.width, rawBmp.height)
      val xOff = (rawBmp.width - side) / 2
      val yOff = (rawBmp.height - side) / 2
      squareBmp = if (rawBmp.width == rawBmp.height) {
        rawBmp
      } else {
        Bitmap.createBitmap(rawBmp, xOff, yOff, side, side)
      }

      // Escala a un máximo de 1080x1080 para mantener alta nitidez sin consumir demasiada RAM
      finalBmp = if (squareBmp.width > 1080) {
        Bitmap.createScaledBitmap(squareBmp, 1080, 1080, true)
      } else {
        squareBmp
      }

      val safeId = trackId.replace(Regex("[^a-zA-Z0-9_-]"), "_")
      val coversDir = File(ctx.filesDir, "snow_custom_covers").apply { mkdirs() }
      coversDir.listFiles()?.forEach { old ->
        if (old.name.startsWith("cover_${safeId}_")) {
          old.delete()
        }
      }

      val outFile = File(coversDir, "cover_${safeId}_${System.currentTimeMillis()}.jpg")
      FileOutputStream(outFile).use { fos ->
        finalBmp.compress(Bitmap.CompressFormat.JPEG, 92, fos)
      }

      val dominantHex = extractDominantColorHex(finalBmp)

      mapOf(
        "artworkUri" to "file://${outFile.absolutePath}",
        "dominantColor" to dominantHex
      )
    } catch (_: Exception) {
      null
    } finally {
      if (finalBmp != null && finalBmp !== squareBmp && finalBmp !== rawBmp) finalBmp.recycle()
      if (squareBmp != null && squareBmp !== rawBmp) squareBmp.recycle()
      rawBmp?.recycle()
    }
  }

  // Extrae el color dominante más representativo de la carátula (24x24 HSV por buckets de matiz)
  // evitando que fondos negros/blancos laven el color a gris; si la portada es monocromática usa el promedio real.
  private fun extractDominantColorHex(source: Bitmap): String {
    val sampleSize = 24
    val scaled = Bitmap.createScaledBitmap(source, sampleSize, sampleSize, true)
    try {
      val buckets = 18
      val weights = FloatArray(buckets)
      val sumR = FloatArray(buckets)
      val sumG = FloatArray(buckets)
      val sumB = FloatArray(buckets)
      val hsv = FloatArray(3)

      var totalR = 0L
      var totalG = 0L
      var totalB = 0L
      var totalCount = 0

      for (y in 0 until sampleSize) {
        for (x in 0 until sampleSize) {
          val pixel = scaled.getPixel(x, y)
          val r = Color.red(pixel)
          val g = Color.green(pixel)
          val b = Color.blue(pixel)
          totalR += r
          totalG += g
          totalB += b
          totalCount++

          Color.RGBToHSV(r, g, b, hsv)
          val hue = hsv[0]
          val sat = hsv[1]
          val valLum = hsv[2]

          // Ignora píxeles casi negros, casi blancos o casi grises al votar por matiz vibrante
          if (sat >= 0.18f && valLum >= 0.14f && valLum <= 0.95f) {
            val idx = ((hue / 360f) * buckets).toInt().coerceIn(0, buckets - 1)
            val lumWeight = 1f - kotlin.math.abs(valLum - 0.55f)
            val w = sat * sat * (0.4f + 0.6f * lumWeight.coerceAtLeast(0.1f))
            weights[idx] += w
            sumR[idx] += r * w
            sumG[idx] += g * w
            sumB[idx] += b * w
          }
        }
      }

      var bestIdx = -1
      var bestWeight = 0f
      for (i in 0 until buckets) {
        if (weights[i] > bestWeight) {
          bestWeight = weights[i]
          bestIdx = i
        }
      }

      if (bestIdx >= 0 && bestWeight >= 1.2f) {
        val avgR = (sumR[bestIdx] / bestWeight).toInt().coerceIn(0, 255)
        val avgG = (sumG[bestIdx] / bestWeight).toInt().coerceIn(0, 255)
        val avgB = (sumB[bestIdx] / bestWeight).toInt().coerceIn(0, 255)
        return String.format("#%02X%02X%02X", avgR, avgG, avgB)
      }

      val c = totalCount.coerceAtLeast(1)
      return String.format(
        "#%02X%02X%02X",
        (totalR / c).toInt().coerceIn(0, 255),
        (totalG / c).toInt().coerceIn(0, 255),
        (totalB / c).toInt().coerceIn(0, 255)
      )
    } finally {
      if (scaled !== source) {
        scaled.recycle()
      }
    }
  }

  private fun decodeCoverBitmap(ctx: Context, sourceUri: String): Bitmap? {
    val trimmed = sourceUri.trim()
    if (trimmed.isEmpty()) return null
    return when {
      trimmed.startsWith("data:image/", ignoreCase = true) -> {
        val comma = trimmed.indexOf(',')
        if (comma < 0) return null
        val b64 = trimmed.substring(comma + 1)
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }
      trimmed.startsWith("http://", ignoreCase = true) ||
        trimmed.startsWith("https://", ignoreCase = true) -> {
        val conn = (URL(trimmed).openConnection() as HttpURLConnection).apply {
          connectTimeout = 10000
          readTimeout = 12000
          instanceFollowRedirects = true
          setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) SnowBeats/1.0")
        }
        try {
          if (conn.responseCode in 200..299) {
            conn.inputStream.use { BitmapFactory.decodeStream(it) }
          } else {
            null
          }
        } finally {
          conn.disconnect()
        }
      }
      trimmed.startsWith("content://", ignoreCase = true) -> {
        ctx.contentResolver.openInputStream(Uri.parse(trimmed))?.use {
          BitmapFactory.decodeStream(it)
        }
      }
      trimmed.startsWith("file://", ignoreCase = true) -> {
        File(Uri.parse(trimmed).path ?: "").takeIf { it.exists() }?.inputStream()?.use {
          BitmapFactory.decodeStream(it)
        }
      }
      else -> {
        File(trimmed).takeIf { it.exists() }?.inputStream()?.use {
          BitmapFactory.decodeStream(it)
        }
      }
    }
  }

  private fun readImageFromClipboard(ctx: Context): Map<String, Any?> {
    return try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return mapOf("ok" to false, "errorMessage" to "Portapapeles no disponible.")
      val clip = cm.primaryClip
      if (clip == null || clip.itemCount == 0) {
        return mapOf("ok" to false, "errorMessage" to "El portapapeles está vacío.")
      }

      val item = clip.getItemAt(0)
      val clipUri = item.uri
      if (clipUri != null) {
        val bmp = ctx.contentResolver.openInputStream(clipUri)?.use {
          BitmapFactory.decodeStream(it)
        }
        if (bmp != null) {
          val dir = File(ctx.cacheDir, "snow_clipboard").apply { mkdirs() }
          val out = File(dir, "clip_${System.currentTimeMillis()}.jpg")
          FileOutputStream(out).use { fos ->
            bmp.compress(Bitmap.CompressFormat.JPEG, 94, fos)
          }
          bmp.recycle()
          return mapOf(
            "ok" to true,
            "uri" to "file://${out.absolutePath}",
            "source" to "clipboard_image"
          )
        }
      }

      val text = item.coerceToText(ctx)?.toString()?.trim() ?: ""
      if (
        text.startsWith("http://", ignoreCase = true) ||
        text.startsWith("https://", ignoreCase = true) ||
        text.startsWith("data:image/", ignoreCase = true) ||
        text.startsWith("file://", ignoreCase = true) ||
        text.startsWith("content://", ignoreCase = true)
      ) {
        return mapOf(
          "ok" to true,
          "uri" to text,
          "source" to "clipboard_url"
        )
      }

      mapOf(
        "ok" to false,
        "errorMessage" to "Copia una imagen o un enlace de imagen válido antes de pegar."
      )
    } catch (e: Exception) {
      mapOf(
        "ok" to false,
        "errorMessage" to (e.message ?: "No se pudo leer la imagen del portapapeles.")
      )
    }
  }

  private fun copyCoverImageToClipboard(ctx: Context, sourceUri: String): Boolean {
    return try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
      val bmp = decodeCoverBitmap(ctx, sourceUri)
      if (bmp != null) {
        val dir = File(ctx.cacheDir, "snow_clipboard").apply { mkdirs() }
        val out = File(dir, "copied_cover_${System.currentTimeMillis()}.jpg")
        FileOutputStream(out).use { fos ->
          bmp.compress(Bitmap.CompressFormat.JPEG, 94, fos)
        }
        bmp.recycle()
        val authority = "${ctx.packageName}.snowbeats.fileprovider"
        val contentUri = FileProvider.getUriForFile(ctx, authority, out)
        val clip = ClipData.newUri(ctx.contentResolver, "Snow Beats Cover", contentUri)
        cm.setPrimaryClip(clip)
        true
      } else {
        false
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun readPlainTextFromClipboard(ctx: Context): String {
    return try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
      val clip = cm.primaryClip ?: return ""
      if (clip.itemCount == 0) return ""
      clip.getItemAt(0).coerceToText(ctx)?.toString() ?: ""
    } catch (_: Exception) {
      ""
    }
  }

  private fun copyPlainTextToClipboard(ctx: Context, text: String): Boolean {
    return try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
      val clip = ClipData.newPlainText("Snow Beats", text)
      cm.setPrimaryClip(clip)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun readPickedLyricsDocument(ctx: Context, uri: Uri): Map<String, Any?> {
    return try {
      var fileName = "letras.lrc"
      ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val colIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (colIdx >= 0) {
            val name = c.getString(colIdx)
            if (!name.isNullOrBlank()) fileName = name
          }
        }
      }

      val bytes = ctx.contentResolver.openInputStream(uri)?.use { stream ->
        readUpTo(stream, MAX_LYRICS_FILE_BYTES)
      } ?: return mapOf("ok" to false, "errorMessage" to "No se pudo abrir el archivo seleccionado.")

      if (bytes.isEmpty()) {
        return mapOf("ok" to false, "errorMessage" to "El archivo seleccionado está vacío.")
      }

      val decoded = decodeLyricsTextBytes(bytes).removePrefix("\uFEFF").trim()
      if (decoded.isEmpty()) {
        return mapOf("ok" to false, "errorMessage" to "No se encontró texto legible en el archivo.")
      }

      mapOf(
        "ok" to true,
        "fileName" to fileName,
        "content" to decoded
      )
    } catch (e: Exception) {
      mapOf(
        "ok" to false,
        "errorMessage" to (e.message ?: "Error leyendo el archivo de letras.")
      )
    }
  }

  private fun decodeLyricsTextBytes(bytes: ByteArray): String {
    return when {
      bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte() ->
        String(bytes, 2, bytes.size - 2, StandardCharsets.UTF_16LE)
      bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte() ->
        String(bytes, 2, bytes.size - 2, StandardCharsets.UTF_16BE)
      else -> {
        val utf8 = String(bytes, StandardCharsets.UTF_8)
        if (utf8.contains('\uFFFD')) String(bytes, Charset.forName("ISO-8859-1")) else utf8
      }
    }
  }
}