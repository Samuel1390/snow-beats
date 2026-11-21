package com.snowbeats.metadata

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

// Motor nativo de extracción y descarga basado en yt-dlp (github.com/yt-dlp/yt-dlp) + FFmpeg
object SnowDownloaderEngine {
  @Volatile
  private var initialized = false
  private val initLock = Any()

  private val allowedHosts = listOf(
    "youtube.com",
    "youtu.be",
    "music.youtube.com",
    "instagram.com",
    "instagr.am",
    "tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
    "facebook.com",
    "fb.watch",
    "fb.com",
    "x.com",
    "twitter.com",
    "t.co"
  )

  fun ensureInitialized(context: Context) {
    if (initialized) return
    synchronized(initLock) {
      if (initialized) return
      val appCtx = context.applicationContext
      YoutubeDL.getInstance().init(appCtx)
      try {
        FFmpeg.getInstance().init(appCtx)
      } catch (_: Exception) {
        // FFmpeg es opcional si solo se descargan flujos progresivos directos
      }
      initialized = true
    }
  }

  fun isNetworkAvailable(context: Context): Boolean {
    return try {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      } else {
        @Suppress("DEPRECATION")
        cm.activeNetworkInfo?.isConnected == true
      }
    } catch (_: Exception) {
      true
    }
  }

  fun hasStorageWritePermission(context: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
      ) == PackageManager.PERMISSION_GRANTED
    }
  }

  fun requestStorageWritePermission(activity: Activity?): Boolean {
    if (activity == null) return false
    if (hasStorageWritePermission(activity)) return true

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
          data = Uri.parse("package:${activity.packageName}")
        }
        activity.startActivity(intent)
        true
      } catch (_: Exception) {
        try {
          val fallback = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
          activity.startActivity(fallback)
          true
        } catch (_: Exception) {
          false
        }
      }
    } else {
      ActivityCompat.requestPermissions(
        activity,
        arrayOf(
          Manifest.permission.WRITE_EXTERNAL_STORAGE,
          Manifest.permission.READ_EXTERNAL_STORAGE
        ),
        5091
      )
      true
    }
  }

  // Convierte una ruta amigable ("Almacenamiento interno/Snow beats/...") en carpeta real en Android
  fun resolveTargetDirectory(displayPath: String): File {
    val root = Environment.getExternalStorageDirectory()
    val cleaned = displayPath
      .trim()
      .replace("\\", "/")
      .removePrefix("Almacenamiento interno/")
      .removePrefix("Almacenamiento interno")
      .removePrefix("/storage/emulated/0/")
      .removePrefix("/")
      .replace("..", "")

    return if (cleaned.isBlank()) {
      File(root, "Snow beats/Download")
    } else {
      File(root, cleaned)
    }
  }

  private fun getAvailableSpaceBytes(dir: File): Long {
    return try {
      val checkDir = if (dir.exists()) dir else Environment.getExternalStorageDirectory()
      val stat = StatFs(checkDir.absolutePath)
      stat.availableBytes
    } catch (_: Exception) {
      Long.MAX_VALUE
    }
  }

  fun detectPlatform(url: String): String? {
    return try {
      val host = (Uri.parse(url).host ?: "").lowercase(Locale.US).removePrefix("www.").removePrefix("m.")
      when {
        host.contains("youtube.com") || host == "youtu.be" -> "YouTube"
        host.contains("instagram.com") || host.contains("instagr.am") -> "Instagram"
        host.contains("tiktok.com") -> "TikTok"
        host.contains("facebook.com") || host == "fb.watch" || host == "fb.com" -> "Facebook"
        host == "x.com" || host.endsWith(".x.com") || host.contains("twitter.com") || host == "t.co" -> "X"
        else -> null
      }
    } catch (_: Exception) {
      null
    }
  }

  fun isAllowedUrl(url: String): Boolean {
    return try {
      val parsed = Uri.parse(url.trim())
      val scheme = parsed.scheme?.lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") return false
      val host = (parsed.host ?: "").lowercase(Locale.US).removePrefix("www.").removePrefix("m.")
      allowedHosts.any { allowed -> host == allowed || host.endsWith(".$allowed") }
    } catch (_: Exception) {
      false
    }
  }

  // Extrae metadatos, formatos disponibles (audio/video ordenados de menor a mayor) o elementos de playlist
  fun extractMediaInfo(context: Context, rawUrl: String): Map<String, Any?> {
    val url = rawUrl.trim()
    if (!isAllowedUrl(url)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "UNSUPPORTED_URL",
        "errorMessage" to "Enlace no compatible. Usa URLs de YouTube, Instagram, TikTok, Facebook o X."
      )
    }

    if (!isNetworkAvailable(context)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "NO_INTERNET",
        "errorMessage" to "Sin conexión a internet. Verifica tu Wi-Fi o datos móviles e intenta nuevamente."
      )
    }

    return try {
      ensureInitialized(context)

      val request = YoutubeDLRequest(url).apply {
        addOption("--dump-single-json")
        addOption("--no-warnings")
        addOption("--flat-playlist")
        addOption("--no-check-certificates")
      }

      val response = YoutubeDL.getInstance().execute(request, "extract_${System.currentTimeMillis()}")
      val rawOut = response.out?.trim() ?: ""
      if (rawOut.isBlank()) {
        return mapOf(
          "ok" to false,
          "errorCode" to "EMPTY_RESPONSE",
          "errorMessage" to "yt-dlp no devolvió información para este enlace."
        )
      }

      val jsonLine = rawOut.lineSequence().lastOrNull { it.trim().startsWith("{") } ?: rawOut
      val root = JSONObject(jsonLine)
      val type = root.optString("_type", "video")
      val platform = detectPlatform(url) ?: root.optString("extractor_key", "Web")
      val hostDomain = Uri.parse(url).host ?: platform

      // Caso 1: Playlist o colección de múltiples videos/pistas
      if (type == "playlist" || root.has("entries")) {
        val entriesArr = root.optJSONArray("entries") ?: JSONArray()
        val items = mutableListOf<Map<String, Any?>>()
        for (i in 0 until entriesArr.length()) {
          val entry = entriesArr.optJSONObject(i) ?: continue
          val entryId = entry.optString("id", "item_$i")
          val entryTitle = entry.optString("title", "Elemento ${i + 1}")
          val entryDuration = entry.optDouble("duration", 0.0).takeIf { !it.isNaN() } ?: 0.0
          val entryUrl = entry.optString("url").ifBlank {
            entry.optString("webpage_url").ifBlank {
              if (platform == "YouTube" && entryId.isNotBlank()) "https://www.youtube.com/watch?v=$entryId" else url
            }
          }
          val thumb = extractBestThumbnail(entry)
          items.add(
            mapOf(
              "id" to entryId,
              "index" to (i + 1),
              "title" to entryTitle,
              "artist" to entry.optString("uploader", entry.optString("channel", platform)),
              "duration" to entryDuration,
              "thumbnail" to thumb,
              "url" to entryUrl
            )
          )
        }

        // Formatos estándar para descarga masiva de playlist (ordenados de menor a mayor calidad)
        val defaultAudioFormats = buildStandardPlaylistAudioFormats()
        val defaultVideoFormats = buildStandardPlaylistVideoFormats()

        return mapOf(
          "ok" to true,
          "isPlaylist" to true,
          "isAudioOnly" to false,
          "title" to root.optString("title", "Lista de reproducción"),
          "uploader" to root.optString("uploader", platform),
          "domain" to hostDomain,
          "platform" to platform,
          "thumbnail" to (extractBestThumbnail(root) ?: items.firstOrNull()?.get("thumbnail")),
          "duration" to 0.0,
          "url" to url,
          "previewStreamUrl" to null,
          "entries" to items,
          "audioFormats" to defaultAudioFormats,
          "videoFormats" to defaultVideoFormats
        )
      }

      // Caso 2: Recurso individual (video o audio)
      val parsedFormats = parseFormats(root)
      val previewInfo = pickPreviewStream(root)

      mapOf(
        "ok" to true,
        "isPlaylist" to false,
        "isAudioOnly" to previewInfo.first,
        "title" to root.optString("title", "Sin título"),
        "uploader" to root.optString("uploader", root.optString("channel", platform)),
        "domain" to hostDomain,
        "platform" to platform,
        "thumbnail" to extractBestThumbnail(root),
        "duration" to (root.optDouble("duration", 0.0).takeIf { !it.isNaN() } ?: 0.0),
        "url" to root.optString("webpage_url", url),
        "previewStreamUrl" to previewInfo.second,
        "entries" to emptyList<Map<String, Any?>>(),
        "audioFormats" to parsedFormats.first,
        "videoFormats" to parsedFormats.second
      )
    } catch (e: Exception) {
      val (code, msg) = classifyError(e, context)
      mapOf(
        "ok" to false,
        "errorCode" to code,
        "errorMessage" to msg
      )
    }
  }

  private fun extractBestThumbnail(obj: JSONObject): String? {
    val direct = obj.optString("thumbnail")
    if (direct.startsWith("http")) return direct
    val arr = obj.optJSONArray("thumbnails") ?: return null
    for (i in arr.length() - 1 downTo 0) {
      val item = arr.optJSONObject(i) ?: continue
      val u = item.optString("url")
      if (u.startsWith("http")) return u
    }
    return null
  }

  // Selecciona una URL de streaming directa compatible con exo-video / exo-audio
  private fun pickPreviewStream(root: JSONObject): Pair<Boolean, String?> {
    val formats = root.optJSONArray("formats")
    if (formats == null || formats.length() == 0) {
      val direct = root.optString("url").takeIf { it.startsWith("http") }
      val vcodec = root.optString("vcodec", "none")
      val isAudioOnly = vcodec == "none"
      return Pair(isAudioOnly, direct)
    }

    var bestProgressiveVideo: String? = null
    var bestProgressiveHeight = 0
    var bestAnyVideo: String? = null
    var bestAudioOnly: String? = null
    var bestAudioAbr = 0.0

    for (i in 0 until formats.length()) {
      val f = formats.optJSONObject(i) ?: continue
      val u = f.optString("url")
      if (!u.startsWith("http")) continue
      val protocol = f.optString("protocol", "")
      if (protocol.contains("mhtml")) continue

      val vcodec = f.optString("vcodec", "none")
      val acodec = f.optString("acodec", "none")
      val ext = f.optString("ext", "")
      val height = f.optInt("height", 0)
      val abr = f.optDouble("abr", 0.0).takeIf { !it.isNaN() } ?: 0.0

      if (vcodec != "none" && acodec != "none") {
        // Prioriza MP4 progresivo hasta 720p para carga rápida de vista previa
        if (ext == "mp4" && height in 240..720 && height >= bestProgressiveHeight) {
          bestProgressiveHeight = height
          bestProgressiveVideo = u
        } else if (bestAnyVideo == null) {
          bestAnyVideo = u
        }
      } else if (vcodec == "none" && acodec != "none") {
        if (abr >= bestAudioAbr) {
          bestAudioAbr = abr
          bestAudioOnly = u
        }
      }
    }

    val chosenVideo = bestProgressiveVideo ?: bestAnyVideo
    if (chosenVideo != null) return Pair(false, chosenVideo)
    if (bestAudioOnly != null) return Pair(true, bestAudioOnly)

    val fallback = root.optString("url").takeIf { it.startsWith("http") }
    return Pair(false, fallback)
  }

  // Extrae todos los formatos soportados y los ordena estrictamente de MENOR a MAYOR calidad
  private fun parseFormats(root: JSONObject): Pair<List<Map<String, Any?>>, List<Map<String, Any?>>> {
    val formats = root.optJSONArray("formats") ?: JSONArray()
    val duration = root.optDouble("duration", 0.0).takeIf { !it.isNaN() } ?: 0.0

    val audioByKbps = mutableMapOf<Int, MutableMap<String, Any?>>()
    val videoByHeight = mutableMapOf<Int, MutableMap<String, Any?>>()

    var bestAudioSize = 0L

    for (i in 0 until formats.length()) {
      val f = formats.optJSONObject(i) ?: continue
      val formatId = f.optString("format_id")
      if (formatId.isBlank()) continue
      val ext = f.optString("ext", "")
      if (ext == "mhtml" || ext == "jpg" || ext == "webp") continue

      val vcodec = f.optString("vcodec", "none")
      val acodec = f.optString("acodec", "none")
      val height = f.optInt("height", 0)
      val fps = f.optInt("fps", 0)
      val abr = f.optDouble("abr", 0.0).takeIf { !it.isNaN() } ?: 0.0
      val tbr = f.optDouble("tbr", 0.0).takeIf { !it.isNaN() } ?: 0.0
      val rawSize = f.optLong("filesize", f.optLong("filesize_approx", 0L))
      val estimatedSize = if (rawSize > 0L) rawSize else ((tbr * 1000.0 / 8.0) * duration).toLong()

      if (vcodec == "none" && acodec != "none") {
        if (estimatedSize > bestAudioSize) bestAudioSize = estimatedSize
        val kbps = (if (abr > 0) abr else tbr).toInt().coerceAtLeast(48)
        val bucket = when {
          kbps <= 64 -> 64
          kbps <= 128 -> 128
          kbps <= 192 -> 192
          kbps <= 256 -> 256
          else -> 320
        }
        val existing = audioByKbps[bucket]
        if (existing == null || ext == "m4a") {
          audioByKbps[bucket] = mutableMapOf(
            "id" to "audio_${bucket}_${formatId}",
            "formatId" to formatId,
            "mediaType" to "audio",
            "label" to "MP3 ${bucket} kbps",
            "ext" to "mp3",
            "qualityRank" to bucket,
            "audioQuality" to "${bucket}K",
            "filesize" to estimatedSize
          )
        }
      } else if (vcodec != "none" && height > 0) {
        val existing = videoByHeight[height]
        val existingIsMp4 = (existing?.get("ext") as? String) == "mp4"
        if (existing == null || (ext == "mp4" && !existingIsMp4)) {
          val labelPrefix = when {
            height <= 360 -> "Rápido (${height}p)"
            height <= 480 -> "Estándar (${height}p)"
            height <= 720 -> "Alta calidad (${height}p)"
            height <= 1080 -> "Full HD (${height}p)"
            height <= 1440 -> "2K (${height}p)"
            else -> "4K (${height}p)"
          }
          val totalSize = if (acodec == "none" && estimatedSize > 0L) {
            estimatedSize + bestAudioSize
          } else {
            estimatedSize
          }
          val selector = if (acodec == "none") {
            "${formatId}+bestaudio[ext=m4a]/best[height<=${height}]/best"
          } else {
            formatId
          }
          videoByHeight[height] = mutableMapOf(
            "id" to "video_${height}_${formatId}",
            "formatId" to selector,
            "mediaType" to "video",
            "label" to if (fps >= 50) "$labelPrefix ${fps}fps" else labelPrefix,
            "ext" to "mp4",
            "qualityRank" to height,
            "height" to height,
            "filesize" to totalSize
          )
        }
      }
    }

    // Garantiza opciones estándar ordenadas de menor a mayor calidad si la plataforma expone pocos metadatos (TikTok/IG/X)
    val sortedAudio = audioByKbps.values
      .sortedBy { (it["qualityRank"] as? Int) ?: 0 }
      .ifEmpty { buildStandardPlaylistAudioFormats() }

    val sortedVideo = videoByHeight.values
      .sortedBy { (it["qualityRank"] as? Int) ?: 0 }
      .ifEmpty { buildStandardPlaylistVideoFormats() }

    return Pair(sortedAudio, sortedVideo)
  }

  private fun buildStandardPlaylistAudioFormats(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "std_audio_64",
      "formatId" to "worstaudio/bestaudio",
      "mediaType" to "audio",
      "label" to "Rápido (64 kbps)",
      "ext" to "mp3",
      "qualityRank" to 64,
      "audioQuality" to "64K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_audio_128",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "MP3 clásico (128 kbps)",
      "ext" to "mp3",
      "qualityRank" to 128,
      "audioQuality" to "128K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_audio_192",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Alta calidad (192 kbps)",
      "ext" to "mp3",
      "qualityRank" to 192,
      "audioQuality" to "192K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_audio_320",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Máxima calidad (320 kbps)",
      "ext" to "mp3",
      "qualityRank" to 320,
      "audioQuality" to "320K",
      "filesize" to 0L
    )
  )

  private fun buildStandardPlaylistVideoFormats(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "std_video_360",
      "formatId" to "bestvideo[height<=360]+bestaudio/best[height<=360]/best",
      "mediaType" to "video",
      "label" to "Rápido (360p)",
      "ext" to "mp4",
      "qualityRank" to 360,
      "height" to 360,
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_video_480",
      "formatId" to "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
      "mediaType" to "video",
      "label" to "Estándar (480p)",
      "ext" to "mp4",
      "qualityRank" to 480,
      "height" to 480,
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_video_720",
      "formatId" to "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "mediaType" to "video",
      "label" to "Alta calidad (720p)",
      "ext" to "mp4",
      "qualityRank" to 720,
      "height" to 720,
      "filesize" to 0L
    ),
    mapOf(
      "id" to "std_video_1080",
      "formatId" to "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      "mediaType" to "video",
      "label" to "Full HD (1080p)",
      "ext" to "mp4",
      "qualityRank" to 1080,
      "height" to 1080,
      "filesize" to 0L
    )
  )

  // Ejecuta una descarga real mediante yt-dlp reportando progreso en vivo
  fun downloadMedia(
    context: Context,
    taskId: String,
    rawUrl: String,
    formatId: String,
    mediaType: String,
    audioQuality: String?,
    targetDisplayPath: String,
    onProgress: (Float, Long, String) -> Unit
  ): Map<String, Any?> {
    val url = rawUrl.trim()

    if (!hasStorageWritePermission(context)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "PERMISSION_DENIED",
        "errorMessage" to "Permiso de almacenamiento no concedido. Habilítalo para guardar archivos."
      )
    }

    if (!isNetworkAvailable(context)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "NO_INTERNET",
        "errorMessage" to "Sin conexión a internet. Conéctate a una red e intenta reanudar."
      )
    }

    val destDir = resolveTargetDirectory(targetDisplayPath)
    if (!destDir.exists() && !destDir.mkdirs()) {
      return mapOf(
        "ok" to false,
        "errorCode" to "PERMISSION_DENIED",
        "errorMessage" to "No se pudo crear la carpeta de destino (${destDir.absolutePath}). Revisa permisos."
      )
    }

    // Verifica al menos 25 MB libres antes de iniciar
    val freeBytes = getAvailableSpaceBytes(destDir)
    if (freeBytes < 25L * 1024L * 1024L) {
      return mapOf(
        "ok" to false,
        "errorCode" to "NO_SPACE",
        "errorMessage" to "Espacio insuficiente en el almacenamiento interno. Libera memoria e intenta de nuevo."
      )
    }

    return try {
      ensureInitialized(context)

      val beforeFiles = destDir.listFiles()?.map { it.absolutePath }?.toSet() ?: emptySet()
      val request = YoutubeDLRequest(url).apply {
        addOption("--no-playlist")
        addOption("--no-warnings")
        addOption("--no-check-certificates")
        addOption("--newline")
        addOption("--restrict-filenames")
        addOption("-o", File(destDir, "%(title).110B.%(ext)s").absolutePath)

        if (mediaType == "audio") {
          addOption("-f", formatId.ifBlank { "bestaudio/best" })
          addOption("-x")
          addOption("--audio-format", "mp3")
          addOption("--audio-quality", audioQuality ?: "128K")
          addOption("--embed-thumbnail")
          addOption("--add-metadata")
        } else {
          addOption("-f", formatId.ifBlank { "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" })
          addOption("--merge-output-format", "mp4")
        }
      }

      YoutubeDL.getInstance().execute(request, taskId) { progress, etaInSeconds, line ->
        onProgress(progress, etaInSeconds, line)
      }

      // Detecta el archivo nuevo generado y notifica a MediaStore para que aparezca en Snow Beats
      val newFiles = destDir.listFiles()
        ?.filter { !beforeFiles.contains(it.absolutePath) && it.isFile }
        ?.sortedByDescending { it.lastModified() }
        ?: emptyList()

      val savedFile = newFiles.firstOrNull()
      if (savedFile != null) {
        MediaScannerConnection.scanFile(
          context.applicationContext,
          arrayOf(savedFile.absolutePath),
          null,
          null
        )
      }

      mapOf(
        "ok" to true,
        "filePath" to (savedFile?.absolutePath ?: destDir.absolutePath),
        "fileName" to (savedFile?.name ?: "")
      )
    } catch (e: Exception) {
      val (code, msg) = classifyError(e, context)
      mapOf(
        "ok" to false,
        "errorCode" to code,
        "errorMessage" to msg
      )
    }
  }

  fun cancelDownload(taskId: String): Boolean {
    return try {
      YoutubeDL.getInstance().destroyProcessById(taskId)
    } catch (_: Exception) {
      false
    }
  }

  // Clasifica cualquier error de yt-dlp / Android en un motivo claro para el usuario
  private fun classifyError(e: Exception, context: Context): Pair<String, String> {
    val raw = (e.message ?: e.toString()).lowercase(Locale.US)
    return when {
      raw.contains("canceled") || raw.contains("cancelled") || raw.contains("destroyed") || raw.contains("interrupted") ->
        Pair("CANCELLED", "Descarga cancelada por el usuario.")

      raw.contains("no space") || raw.contains("enospc") || raw.contains("disk full") ->
        Pair("NO_SPACE", "Sin espacio disponible en el disco del dispositivo.")

      !isNetworkAvailable(context) ||
        raw.contains("unable to download webpage") ||
        raw.contains("unknownhost") ||
        raw.contains("failed to resolve") ||
        raw.contains("network is unreachable") ||
        raw.contains("timed out") ||
        raw.contains("connection reset") ||
        raw.contains("socket") ->
        Pair("NO_INTERNET", "Error de conexión a internet o tiempo de espera agotado.")

      raw.contains("permission denied") || raw.contains("eacces") || raw.contains("read-only file system") ->
        Pair("PERMISSION_DENIED", "Permiso de escritura denegado en la ruta de destino.")

      raw.contains("private video") ||
        raw.contains("login required") ||
        raw.contains("sign in") ||
        raw.contains("unavailable") ||
        raw.contains("removed") ||
        raw.contains("404") ||
        raw.contains("403") ->
        Pair("PRIVATE_OR_UNAVAILABLE", "El contenido es privado, requiere inicio de sesión o no está disponible.")

      raw.contains("429") || raw.contains("too many requests") ->
        Pair("RATE_LIMITED", "La plataforma limitó temporalmente las peticiones (HTTP 429). Intenta más tarde.")

      raw.contains("unsupported url") ->
        Pair("UNSUPPORTED_URL", "URL no soportada por yt-dlp.")

      else ->
        Pair("UNKNOWN", "Error durante el proceso: ${(e.message ?: "desconocido").take(140)}")
    }
  }
}
