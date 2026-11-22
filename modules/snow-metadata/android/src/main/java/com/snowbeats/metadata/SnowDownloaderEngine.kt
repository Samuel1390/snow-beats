package com.snowbeats.metadata

import android.Manifest
import android.app.Activity
import android.content.ContentValues
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
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import android.webkit.CookieManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.Locale

data class ExtractionStrategy(
  val name: String,
  val extractorArgs: String? = null,
  val userAgent: String? = null,
  val referer: String? = null,
  val extraHeaders: Map<String, String> = emptyMap(),
  val extraOptions: List<Pair<String, String?>> = emptyList(),
  val overrideUrl: String? = null
)

data class PreviewStreamSelection(
  val isAudioOnly: Boolean,
  val streamUrl: String?,
  val headers: Map<String, String>
)

// Motor nativo de extracción y descarga basado en yt-dlp (github.com/yt-dlp/yt-dlp) + FFmpeg + WebView oculto
object SnowDownloaderEngine {
  private const val TAG = "SnowDownloaderEngine"
  private const val PREFS_NAME = "snow_beats_storage_prefs"
  private const val KEY_SAF_TREE_URI = "saf_tree_uri"
  private const val KEY_LAST_YTDLP_UPDATE_MS = "last_ytdlp_update_ms"
  private const val YTDLP_UPDATE_INTERVAL_MS = 24L * 60L * 60L * 1000L
  const val SAF_TREE_REQUEST_CODE = 5092
  const val LEGACY_STORAGE_REQUEST_CODE = 5091

  private const val MOBILE_CHROME_UA = SnowHiddenWebViewExtractor.MOBILE_CHROME_UA
  private const val DESKTOP_CHROME_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

  @Volatile
  private var initialized = false
  @Volatile
  private var updatedThisSession = false
  private val initLock = Any()
  private val updateLock = Any()

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
      val nativeLibDir = appCtx.applicationInfo.nativeLibraryDir
      val pythonLib = File(nativeLibDir, "libpython.zip.so")

      try {
        YoutubeDL.getInstance().init(appCtx)
      } catch (e: Exception) {
        val causeChain = buildCauseChain(e)
        Log.e(TAG, "Error inicializando YoutubeDL (nativeLibDir=$nativeLibDir): $causeChain", e)
        if (!pythonLib.exists()) {
          throw IllegalStateException(
            "Faltan librerías nativas de yt-dlp (libpython.zip.so no extraída en APK). " +
              "Ejecuta 'npx expo prebuild --clean' y 'npx expo run:android' para aplicar useLegacyPackaging=true.",
            e
          )
        }
        throw IllegalStateException("No se pudo inicializar yt-dlp: $causeChain", e)
      }

      try {
        FFmpeg.getInstance().init(appCtx)
      } catch (e: Exception) {
        // FFmpeg es opcional si solo se descargan flujos progresivos directos
        Log.w(TAG, "FFmpeg no disponible: ${buildCauseChain(e)}")
      }
      initialized = true

      // Actualiza el binario yt-dlp una vez cada 24h en segundo plano para evitar bloqueos 403 de YouTube/IG
      maybeUpdateYtDlp(appCtx, force = false)
    }
  }

  // Actualiza yt-dlp desde el canal estable oficial (resuelve cambios frecuentes de YouTube/Instagram)
  private fun maybeUpdateYtDlp(context: Context, force: Boolean): Boolean {
    synchronized(updateLock) {
      val appCtx = context.applicationContext
      if (!isNetworkAvailable(appCtx)) return false
      val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val lastUpdate = prefs.getLong(KEY_LAST_YTDLP_UPDATE_MS, 0L)
      val now = System.currentTimeMillis()

      if (!force && (now - lastUpdate) < YTDLP_UPDATE_INTERVAL_MS) {
        return false
      }
      if (force && updatedThisSession) {
        return false
      }

      return try {
        Log.i(TAG, "Actualizando binario interno de yt-dlp (force=$force)...")
        YoutubeDL.getInstance().updateYoutubeDL(appCtx)
        updatedThisSession = true
        prefs.edit().putLong(KEY_LAST_YTDLP_UPDATE_MS, now).apply()
        Log.i(TAG, "yt-dlp actualizado correctamente.")
        true
      } catch (e: Exception) {
        Log.w(TAG, "No se pudo actualizar yt-dlp: ${buildCauseChain(e)}")
        false
      }
    }
  }

  private fun buildCauseChain(throwable: Throwable): String {
    val parts = mutableListOf<String>()
    var cur: Throwable? = throwable
    var depth = 0
    while (cur != null && depth < 6) {
      val msg = cur.message?.trim()
      if (!msg.isNullOrEmpty() && !parts.contains(msg)) {
        parts.add(msg)
      }
      cur = cur.cause
      depth++
    }
    return if (parts.isEmpty()) throwable.javaClass.simpleName else parts.joinToString(" -> ")
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

  // Obtiene la URI persistida de SAF si el usuario concedió acceso a una carpeta
  fun getPersistedSafTreeUri(context: Context): Uri? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val saved = prefs.getString(KEY_SAF_TREE_URI, null) ?: return null
    val uri = try { Uri.parse(saved) } catch (_: Exception) { return null }
    val stillGranted = context.contentResolver.persistedUriPermissions.any { perm ->
      perm.uri == uri && perm.isWritePermission
    }
    return if (stillGranted) uri else null
  }

  // Guarda el permiso persistente devuelto por ACTION_OPEN_DOCUMENT_TREE (compatible con HyperOS)
  fun handleSafResult(context: Context, resultCode: Int, data: Intent?): Boolean {
    if (resultCode != Activity.RESULT_OK) return false
    val treeUri = data?.data ?: return false
    return try {
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      context.contentResolver.takePersistableUriPermission(treeUri, flags)
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_SAF_TREE_URI, treeUri.toString())
        .apply()
      true
    } catch (e: Exception) {
      Log.e(TAG, "No se pudo persistir permiso SAF: ${e.message}", e)
      false
    }
  }

  fun hasStorageWritePermission(context: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // Acepta Acceso a todos los archivos O carpeta autorizada vía SAF (no bloqueado en HyperOS)
      Environment.isExternalStorageManager() || getPersistedSafTreeUri(context) != null
    } else {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
      ) == PackageManager.PERMISSION_GRANTED
    }
  }

  // Lanza selector de carpeta SAF en Android 11+ (evita el bloqueo de Ajustes Restringidos en HyperOS)
  fun launchStoragePermissionRequest(activity: Activity?): Boolean {
    if (activity == null) return false
    if (hasStorageWritePermission(activity)) return true

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
          addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
              Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
              Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
              Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
          )
          // Sugiere iniciar en Music/ para que el usuario pueda confirmar o crear "Snow beats" en 1 toque
          val initialUri = DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents",
            "primary:Music"
          )
          putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri)
        }
        activity.startActivityForResult(intent, SAF_TREE_REQUEST_CODE)
        true
      } catch (e: Exception) {
        Log.e(TAG, "Error lanzando ACTION_OPEN_DOCUMENT_TREE: ${e.message}", e)
        false
      }
    } else {
      ActivityCompat.requestPermissions(
        activity,
        arrayOf(
          Manifest.permission.WRITE_EXTERNAL_STORAGE,
          Manifest.permission.READ_EXTERNAL_STORAGE
        ),
        LEGACY_STORAGE_REQUEST_CODE
      )
      true
    }
  }

  // Convierte una ruta amigable ("Almacenamiento interno/Snow beats/...") en segmentos relativos limpios
  private fun cleanRelativePath(displayPath: String): String {
    val cleaned = displayPath
      .trim()
      .replace("\\", "/")
      .removePrefix("Almacenamiento interno/")
      .removePrefix("Almacenamiento interno")
      .removePrefix("/storage/emulated/0/")
      .removePrefix("/")
      .replace("..", "")
      .trim('/')
    return cleaned.ifBlank { "Snow beats/Download" }
  }

  // Convierte una ruta amigable ("Almacenamiento interno/Snow beats/...") en carpeta real en Android
  fun resolveTargetDirectory(displayPath: String): File {
    val root = Environment.getExternalStorageDirectory()
    return File(root, cleanRelativePath(displayPath))
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

  // Extrae la URL real si el usuario pegó un redireccionamiento de Google Search (google.com/url?...&url=...)
  private fun unwrapGoogleRedirect(rawUrl: String): String {
    val trimmed = rawUrl.trim()
    return try {
      val uri = Uri.parse(trimmed)
      val host = (uri.host ?: "").lowercase(Locale.US)
      if (host.contains("google.") && (uri.path ?: "").startsWith("/url")) {
        val inner = uri.getQueryParameter("url") ?: uri.getQueryParameter("q")
        if (!inner.isNullOrBlank()) {
          val decoded = try { URLDecoder.decode(inner, "UTF-8") } catch (_: Exception) { inner }
          if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
            return decoded.trim()
          }
        }
      }
      trimmed
    } catch (_: Exception) {
      trimmed
    }
  }

  // Resuelve enlaces cortos y compartidos (vm.tiktok.com, vt.tiktok.com, fb.watch, facebook.com/share/, t.co, instagr.am)
  private fun resolveShortRedirect(url: String): String {
    val lower = url.lowercase(Locale.US)
    val shouldResolve = lower.contains("vm.tiktok.com") ||
      lower.contains("vt.tiktok.com") ||
      lower.contains("fb.watch") ||
      lower.contains("facebook.com/share/") ||
      lower.contains("fb.com/") ||
      lower.contains("://t.co/") ||
      lower.contains("instagr.am/")
    if (!shouldResolve) return url

    var current = url
    repeat(5) {
      var conn: HttpURLConnection? = null
      try {
        conn = (URL(current).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          instanceFollowRedirects = false
          connectTimeout = 7000
          readTimeout = 7000
          setRequestProperty("User-Agent", MOBILE_CHROME_UA)
          setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        }
        val code = conn.responseCode
        if (code in 300..399) {
          val location = conn.getHeaderField("Location")?.trim()
          if (location.isNullOrBlank()) return current
          current = if (location.startsWith("http://") || location.startsWith("https://")) {
            location
          } else {
            URL(URL(current), location).toString()
          }
        } else {
          return current
        }
      } catch (_: Exception) {
        return current
      } finally {
        try { conn?.disconnect() } catch (_: Exception) { }
      }
    }
    return current
  }

  // Limpia parámetros de rastreo (?dmpr=, ?avpt=, ?igsh=, ?gwpx=) y desenrolla redirecciones
  private fun normalizeUrl(rawUrl: String, followShortLinks: Boolean = false): String {
    var current = unwrapGoogleRedirect(rawUrl)
    if (followShortLinks) {
      current = resolveShortRedirect(current)
    }
    return try {
      val uri = Uri.parse(current)
      val host = (uri.host ?: "").lowercase(Locale.US)
      if (host.contains("instagram.com")) {
        val path = (uri.path ?: "").trimEnd('/')
        if (path.startsWith("/reel/") || path.startsWith("/reels/") || path.startsWith("/p/") || path.startsWith("/tv/")) {
          val normalizedPath = path.replaceFirst("/reels/", "/reel/")
          return "https://www.instagram.com$normalizedPath/"
        }
      }
      if (host == "x.com" || host.endsWith(".x.com") || host.contains("twitter.com")) {
        val path = (uri.path ?: "").trimEnd('/')
        val statusMatch = Regex("^/([^/]+/status/\\d+)").find(path)
        if (statusMatch != null) {
          return "https://x.com/${statusMatch.groupValues[1]}"
        }
      }
      current
    } catch (_: Exception) {
      current
    }
  }

  // Construye la cascada de estrategias de cliente móvil spoofeado por plataforma (Paso 2)
  private fun buildPlatformStrategies(platform: String?, canonicalUrl: String): List<ExtractionStrategy> {
    return when (platform) {
      "YouTube" -> listOf(
        ExtractionStrategy(name = "yt_android_ios", extractorArgs = "youtube:player_client=android,ios"),
        ExtractionStrategy(name = "yt_android_vr", extractorArgs = "youtube:player_client=android_vr"),
        ExtractionStrategy(name = "yt_tv_mweb", extractorArgs = "youtube:player_client=tv,mweb"),
        ExtractionStrategy(name = "yt_default")
      )

      "Instagram" -> {
        val list = mutableListOf(
          ExtractionStrategy(
            name = "ig_mobile",
            userAgent = MOBILE_CHROME_UA,
            referer = "https://www.instagram.com/",
            extraHeaders = mapOf("Accept-Language" to "es-ES,es;q=0.9,en;q=0.8")
          )
        )
        val passiveCookies = try {
          CookieManager.getInstance().getCookie("https://www.instagram.com")
        } catch (_: Exception) {
          null
        }
        if (!passiveCookies.isNullOrBlank()) {
          list.add(
            ExtractionStrategy(
              name = "ig_mobile_webview_cookies",
              userAgent = MOBILE_CHROME_UA,
              referer = "https://www.instagram.com/",
              extraHeaders = mapOf(
                "Cookie" to passiveCookies,
                "Accept-Language" to "es-ES,es;q=0.9,en;q=0.8"
              )
            )
          )
        }
        list
      }

      "TikTok" -> listOf(
        ExtractionStrategy(
          name = "tt_mobile",
          userAgent = MOBILE_CHROME_UA,
          referer = "https://www.tiktok.com/"
        ),
        ExtractionStrategy(
          name = "tt_api_host",
          extractorArgs = "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com",
          userAgent = MOBILE_CHROME_UA,
          referer = "https://www.tiktok.com/"
        ),
        ExtractionStrategy(name = "tt_default")
      )

      "Facebook" -> listOf(
        ExtractionStrategy(
          name = "fb_mobile",
          userAgent = MOBILE_CHROME_UA,
          referer = "https://m.facebook.com/"
        ),
        ExtractionStrategy(
          name = "fb_desktop_hd",
          userAgent = DESKTOP_CHROME_UA,
          referer = "https://www.facebook.com/"
        )
      )

      "X" -> {
        val twitterAltUrl = canonicalUrl.replace("://x.com/", "://twitter.com/")
        listOf(
          ExtractionStrategy(
            name = "x_default",
            userAgent = MOBILE_CHROME_UA,
            referer = "https://x.com/"
          ),
          ExtractionStrategy(
            name = "x_syndication",
            extractorArgs = "twitter:api=syndication",
            userAgent = MOBILE_CHROME_UA,
            referer = "https://twitter.com/",
            overrideUrl = twitterAltUrl
          )
        )
      }

      else -> listOf(ExtractionStrategy(name = "generic_default"))
    }
  }

  private fun applyStrategyToRequest(request: YoutubeDLRequest, strategy: ExtractionStrategy) {
    if (!strategy.extractorArgs.isNullOrBlank()) {
      request.addOption("--extractor-args", strategy.extractorArgs)
    }
    if (!strategy.userAgent.isNullOrBlank()) {
      request.addOption("--user-agent", strategy.userAgent)
    }
    if (!strategy.referer.isNullOrBlank()) {
      request.addOption("--referer", strategy.referer)
    }
    strategy.extraHeaders.forEach { (k, v) ->
      if (k.isNotBlank() && v.isNotBlank()) {
        request.addOption("--add-header", "$k:$v")
      }
    }
    strategy.extraOptions.forEach { (opt, value) ->
      if (value == null) request.addOption(opt) else request.addOption(opt, value)
    }
  }

  private fun applyCustomHeadersToRequest(request: YoutubeDLRequest, headers: Map<String, String>?) {
    if (headers.isNullOrEmpty()) return
    headers.forEach { (rawKey, rawVal) ->
      val key = rawKey.trim()
      val value = rawVal.trim()
      if (key.isEmpty() || value.isEmpty()) return@forEach
      when (key.lowercase(Locale.US)) {
        "user-agent" -> request.addOption("--user-agent", value)
        "referer" -> request.addOption("--referer", value)
        else -> request.addOption("--add-header", "$key:$value")
      }
    }
  }

  private fun isRetryableExtractorError(e: Exception): Boolean {
    val raw = buildCauseChain(e).lowercase(Locale.US)
    return raw.contains("403") ||
      raw.contains("forbidden") ||
      raw.contains("sign in") ||
      raw.contains("bot") ||
      raw.contains("player") ||
      raw.contains("requested format is not available") ||
      raw.contains("nsig") ||
      raw.contains("sabr")
  }

  // Construye opciones estándar de descarga cuando la fuente entrega una URL directa (embed / WebView)
  private fun buildDirectStreamAudioFormats(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "direct_audio_64",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Rápido (64 kbps)",
      "ext" to "mp3",
      "qualityRank" to 64,
      "audioQuality" to "64K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_128",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "MP3 clásico (128 kbps)",
      "ext" to "mp3",
      "qualityRank" to 128,
      "audioQuality" to "128K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_192",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Alta calidad (192 kbps)",
      "ext" to "mp3",
      "qualityRank" to 192,
      "audioQuality" to "192K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_320",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Máxima calidad (320 kbps)",
      "ext" to "mp3",
      "qualityRank" to 320,
      "audioQuality" to "320K",
      "filesize" to 0L
    )
  )

  private fun buildDirectStreamVideoFormats(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "direct_video_original",
      "formatId" to "best",
      "mediaType" to "video",
      "label" to "Calidad original (MP4)",
      "ext" to "mp4",
      "qualityRank" to 720,
      "height" to 720,
      "filesize" to 0L
    )
  )

  // Respaldo público para Reels/Posts de Instagram vía página embed cuando yt-dlp recibe bloqueo anónimo
  private fun tryInstagramPublicEmbedFallback(canonicalUrl: String): Map<String, Any?>? {
    val match = Regex("instagram\\.com/(reel|p|tv)/([A-Za-z0-9_-]+)").find(canonicalUrl) ?: return null
    val kind = match.groupValues[1]
    val shortcode = match.groupValues[2]
    val embedUrl = "https://www.instagram.com/$kind/$shortcode/embed/captioned/"

    return try {
      val conn = (URL(embedUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 10000
        readTimeout = 10000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", MOBILE_CHROME_UA)
        setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        setRequestProperty("Accept-Language", "es-ES,es;q=0.9,en;q=0.8")
      }
      if (conn.responseCode !in 200..299) {
        conn.disconnect()
        return null
      }
      val html = conn.inputStream.bufferedReader().use { it.readText() }
      conn.disconnect()

      val rawVideoUrl = Regex("\"video_url\"\\s*:\\s*\"([^\"]+)\"")
        .find(html)?.groupValues?.getOrNull(1)
        ?: Regex("\\\\\"video_url\\\\\"\\s*:\\s*\\\\\"([^\\\\\"]+)\\\\\"")
          .find(html)?.groupValues?.getOrNull(1)
        ?: return null

      val videoUrl = unescapeJsonUrl(rawVideoUrl)
      if (!videoUrl.startsWith("http")) return null

      val rawThumb = Regex("\"display_url\"\\s*:\\s*\"([^\"]+)\"")
        .find(html)?.groupValues?.getOrNull(1)
        ?: Regex("\"thumbnail_src\"\\s*:\\s*\"([^\"]+)\"")
          .find(html)?.groupValues?.getOrNull(1)
      val thumbUrl = rawThumb?.let { unescapeJsonUrl(it) }?.takeIf { it.startsWith("http") }

      val rawAuthor = Regex("\"username\"\\s*:\\s*\"([^\"]+)\"")
        .find(html)?.groupValues?.getOrNull(1) ?: "Instagram"

      val title = "Instagram Reel · @$rawAuthor"
      val embedHeaders = mapOf(
        "User-Agent" to MOBILE_CHROME_UA,
        "Referer" to "https://www.instagram.com/"
      )

      mapOf(
        "ok" to true,
        "isPlaylist" to false,
        "isAudioOnly" to false,
        "extractionSource" to "embed",
        "title" to title,
        "uploader" to "@$rawAuthor",
        "domain" to "instagram.com",
        "platform" to "Instagram",
        "thumbnail" to thumbUrl,
        "duration" to 0.0,
        "url" to canonicalUrl,
        "directStreamUrl" to videoUrl,
        "previewStreamUrl" to videoUrl,
        "previewHeaders" to embedHeaders,
        "entries" to emptyList<Map<String, Any?>>(),
        "audioFormats" to buildDirectStreamAudioFormats(),
        "videoFormats" to buildDirectStreamVideoFormats()
      )
    } catch (e: Exception) {
      Log.w(TAG, "Respaldo embed de Instagram no disponible: ${e.message}")
      null
    }
  }

  private fun unescapeJsonUrl(raw: String): String {
    return raw
      .replace("\\/", "/")
      .replace("\\u0026", "&")
      .replace("\\u002F", "/")
      .replace("&amp;", "&")
      .replace("\\\\", "\\")
  }

  // Respaldo de Paso 3 mediante WebView oculto nativo cuando las estrategias yt-dlp/embed son bloqueadas
  private fun tryHiddenWebViewFallback(
    context: Context,
    canonicalUrl: String,
    platform: String
  ): Map<String, Any?>? {
    val wv = SnowHiddenWebViewExtractor.extract(
      context = context,
      pageUrl = canonicalUrl,
      platform = platform,
      timeoutMs = 14_000L
    )
    val streamUrl = wv.streamUrl
    if (streamUrl.isNullOrBlank()) {
      if (wv.requiresLogin) {
        return mapOf(
          "ok" to false,
          "errorCode" to "PRIVATE_CONTENT",
          "errorMessage" to "$platform restringe esta publicación (es privada o requiere inicio de sesión en la cuenta)."
        )
      }
      return null
    }

    val hostDomain = try { Uri.parse(canonicalUrl).host ?: platform } catch (_: Exception) { platform }
    val cleanTitle = wv.title?.takeIf { it.isNotBlank() } ?: "Video de $platform"
    return mapOf(
      "ok" to true,
      "isPlaylist" to false,
      "isAudioOnly" to false,
      "extractionSource" to "webview",
      "title" to cleanTitle,
      "uploader" to platform,
      "domain" to hostDomain,
      "platform" to platform,
      "thumbnail" to wv.thumbnail,
      "duration" to 0.0,
      "url" to canonicalUrl,
      "directStreamUrl" to streamUrl,
      "previewStreamUrl" to streamUrl,
      "previewHeaders" to wv.headers,
      "entries" to emptyList<Map<String, Any?>>(),
      "audioFormats" to buildDirectStreamAudioFormats(),
      "videoFormats" to buildDirectStreamVideoFormats()
    )
  }

  // Extrae metadatos, formatos disponibles (audio/video ordenados de menor a mayor) o elementos de playlist
  fun extractMediaInfo(context: Context, rawUrl: String): Map<String, Any?> {
    val unwrapped = unwrapGoogleRedirect(rawUrl)
    if (!isAllowedUrl(unwrapped)) {
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

    val url = normalizeUrl(unwrapped, followShortLinks = true)
    val detectedPlatform = detectPlatform(url) ?: detectPlatform(unwrapped)

    return try {
      ensureInitialized(context)

      val strategies = buildPlatformStrategies(detectedPlatform, url)
      var rawOut = ""
      var lastException: Exception? = null
      var didForceUpdate = false

      var idx = 0
      while (idx < strategies.size) {
        val strategy = strategies[idx]
        val attemptUrl = strategy.overrideUrl ?: url
        try {
          val request = YoutubeDLRequest(attemptUrl).apply {
            addOption("--dump-single-json")
            addOption("--no-warnings")
            addOption("--flat-playlist")
            addOption("--no-check-certificates")
            addOption("--geo-bypass")
            applyStrategyToRequest(this, strategy)
          }
          val response = YoutubeDL.getInstance().execute(request, "extract_${System.currentTimeMillis()}")
          val out = response.out?.trim() ?: ""
          if (out.isNotBlank()) {
            rawOut = out
            lastException = null
            break
          }
        } catch (e: Exception) {
          lastException = e
          Log.w(TAG, "extractMediaInfo fallo (platform=$detectedPlatform, strategy=${strategy.name}): ${buildCauseChain(e)}")
          // Si falla por bloqueo/403 y aún no actualizamos yt-dlp en esta sesión, actualiza y reintenta
          if (!didForceUpdate && isRetryableExtractorError(e)) {
            didForceUpdate = true
            if (maybeUpdateYtDlp(context, force = true)) {
              continue
            }
          }
        }
        idx++
      }

      if (rawOut.isBlank()) {
        // Paso 2.3: Para Instagram público intenta respaldo /embed/captioned/
        if (detectedPlatform == "Instagram") {
          val igFallback = tryInstagramPublicEmbedFallback(url)
          if (igFallback != null) return igFallback
        }

        // Paso 3: WebView oculto nativo (Instagram, TikTok, Facebook y X)
        if (detectedPlatform != null && detectedPlatform != "YouTube") {
          val webViewResult = tryHiddenWebViewFallback(context, url, detectedPlatform)
          if (webViewResult != null) return webViewResult
        }

        if (lastException != null) {
          val (code, msg) = classifyError(lastException, context, detectedPlatform)
          return mapOf(
            "ok" to false,
            "errorCode" to code,
            "errorMessage" to msg
          )
        }
        return mapOf(
          "ok" to false,
          "errorCode" to "EMPTY_RESPONSE",
          "errorMessage" to "yt-dlp no devolvió información para este enlace."
        )
      }

      val jsonLine = rawOut.lineSequence().lastOrNull { it.trim().startsWith("{") } ?: rawOut
      val root = JSONObject(jsonLine)
      val type = root.optString("_type", "video")
      val platform = detectedPlatform ?: root.optString("extractor_key", "Web")
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

        val defaultAudioFormats = buildStandardPlaylistAudioFormats()
        val defaultVideoFormats = buildStandardPlaylistVideoFormats()

        return mapOf(
          "ok" to true,
          "isPlaylist" to true,
          "isAudioOnly" to false,
          "extractionSource" to "yt-dlp",
          "title" to root.optString("title", "Lista de reproducción"),
          "uploader" to root.optString("uploader", platform),
          "domain" to hostDomain,
          "platform" to platform,
          "thumbnail" to (extractBestThumbnail(root) ?: items.firstOrNull()?.get("thumbnail")),
          "duration" to 0.0,
          "url" to url,
          "directStreamUrl" to null,
          "previewStreamUrl" to null,
          "previewHeaders" to emptyMap<String, String>(),
          "entries" to items,
          "audioFormats" to defaultAudioFormats,
          "videoFormats" to defaultVideoFormats
        )
      }

      // Caso 2: Recurso individual (video o audio) con propagación de headers HTTP para evitar 403 en vista previa
      val parsedFormats = parseFormats(root)
      val previewInfo = pickPreviewStream(root)

      mapOf(
        "ok" to true,
        "isPlaylist" to false,
        "isAudioOnly" to previewInfo.isAudioOnly,
        "extractionSource" to "yt-dlp",
        "title" to root.optString("title", "Sin título"),
        "uploader" to root.optString("uploader", root.optString("channel", platform)),
        "domain" to hostDomain,
        "platform" to platform,
        "thumbnail" to extractBestThumbnail(root),
        "duration" to (root.optDouble("duration", 0.0).takeIf { !it.isNaN() } ?: 0.0),
        "url" to root.optString("webpage_url", url),
        "directStreamUrl" to if (platform != "YouTube") previewInfo.streamUrl else null,
        "previewStreamUrl" to previewInfo.streamUrl,
        "previewHeaders" to previewInfo.headers,
        "entries" to emptyList<Map<String, Any?>>(),
        "audioFormats" to parsedFormats.first,
        "videoFormats" to parsedFormats.second
      )
    } catch (e: Exception) {
      val (code, msg) = classifyError(e, context, detectedPlatform)
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

  private fun parseHttpHeadersJson(obj: JSONObject?): Map<String, String> {
    if (obj == null) return emptyMap()
    val out = LinkedHashMap<String, String>()
    val keys = obj.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      val v = obj.optString(k, "").trim()
      if (k.isNotBlank() && v.isNotBlank()) {
        out[k] = v
      }
    }
    return out
  }

  // Selecciona una URL de streaming directa + sus headers HTTP reales para exo-video / exo-audio
  private fun pickPreviewStream(root: JSONObject): PreviewStreamSelection {
    val rootHeaders = parseHttpHeadersJson(root.optJSONObject("http_headers"))
    val formats = root.optJSONArray("formats")
    if (formats == null || formats.length() == 0) {
      val direct = root.optString("url").takeIf { it.startsWith("http") }
      val vcodec = root.optString("vcodec", "none")
      val isAudioOnly = vcodec == "none"
      return PreviewStreamSelection(isAudioOnly, direct, rootHeaders)
    }

    var bestProgressiveVideo: String? = null
    var bestProgressiveHeaders: Map<String, String> = rootHeaders
    var bestProgressiveHeight = 0
    var bestAnyVideo: String? = null
    var bestAnyVideoHeaders: Map<String, String> = rootHeaders
    var bestAudioOnly: String? = null
    var bestAudioHeaders: Map<String, String> = rootHeaders
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
      val fmtHeaders = parseHttpHeadersJson(f.optJSONObject("http_headers")).ifEmpty { rootHeaders }

      if (vcodec != "none" && acodec != "none") {
        // Prioriza MP4 progresivo hasta 720p para carga rápida de vista previa
        if (ext == "mp4" && height in 240..720 && height >= bestProgressiveHeight) {
          bestProgressiveHeight = height
          bestProgressiveVideo = u
          bestProgressiveHeaders = fmtHeaders
        } else if (bestAnyVideo == null) {
          bestAnyVideo = u
          bestAnyVideoHeaders = fmtHeaders
        }
      } else if (vcodec == "none" && acodec != "none") {
        if (abr >= bestAudioAbr) {
          bestAudioAbr = abr
          bestAudioOnly = u
          bestAudioHeaders = fmtHeaders
        }
      }
    }

    if (bestProgressiveVideo != null) {
      return PreviewStreamSelection(false, bestProgressiveVideo, bestProgressiveHeaders)
    }
    if (bestAnyVideo != null) {
      return PreviewStreamSelection(false, bestAnyVideo, bestAnyVideoHeaders)
    }
    if (bestAudioOnly != null) {
      return PreviewStreamSelection(true, bestAudioOnly, bestAudioHeaders)
    }

    val fallback = root.optString("url").takeIf { it.startsWith("http") }
    return PreviewStreamSelection(false, fallback, rootHeaders)
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
            "formatId" to "bestaudio[ext=m4a]/bestaudio/best",
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
          // Selector resiliente por altura (evita fallos 403 por format_id caducados o específicos de un cliente)
          val selector =
            "bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best"
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

  // Ejecuta una descarga real mediante yt-dlp (con cascada por plataforma, headers, respaldo directo HTTP y FFmpeg local)
  fun downloadMedia(
    context: Context,
    taskId: String,
    rawUrl: String,
    formatId: String,
    mediaType: String,
    audioQuality: String?,
    targetDisplayPath: String,
    headers: Map<String, String>? = null,
    directStreamUrl: String? = null,
    onProgress: (Float, Long, String) -> Unit
  ): Map<String, Any?> {
    val url = normalizeUrl(rawUrl, followShortLinks = true)
    val detectedPlatform = detectPlatform(url) ?: detectPlatform(rawUrl)

    if (!hasStorageWritePermission(context)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "PERMISSION_DENIED",
        "errorMessage" to "Permiso de almacenamiento no concedido. Selecciona tu carpeta de descargas para guardar archivos."
      )
    }

    if (!isNetworkAvailable(context)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "NO_INTERNET",
        "errorMessage" to "Sin conexión a internet. Conéctate a una red e intenta reanudar."
      )
    }

    // Verifica al menos 25 MB libres antes de iniciar
    val freeBytes = getAvailableSpaceBytes(context.cacheDir)
    if (freeBytes < 25L * 1024L * 1024L) {
      return mapOf(
        "ok" to false,
        "errorCode" to "NO_SPACE",
        "errorMessage" to "Espacio insuficiente en el almacenamiento interno. Libera memoria e intenta de nuevo."
      )
    }

    val safeTaskDir = taskId.replace(Regex("[^a-zA-Z0-9_-]"), "_")
    val tempDir = File(File(context.cacheDir, "snow_dl_tmp"), safeTaskDir).apply {
      if (exists()) deleteRecursively()
      mkdirs()
    }

    return try {
      ensureInitialized(context)

      var lastError: Exception? = null
      var didForceUpdate = false
      var succeeded = false

      // Si tenemos una directStreamUrl capturada (WebView/embed), la intentamos primero con yt-dlp (maneja HLS y FFmpeg MP3)
      val hasDirectStream = !directStreamUrl.isNullOrBlank() && directStreamUrl.startsWith("http")
      if (hasDirectStream && (detectedPlatform == "Instagram" || detectedPlatform == "TikTok" || detectedPlatform == "Facebook" || detectedPlatform == "X")) {
        try {
          tempDir.listFiles()?.forEach { it.deleteRecursively() }
          runYtDlpDownloadRequest(
            targetUrl = directStreamUrl!!,
            tempDir = tempDir,
            taskId = taskId,
            formatId = if (mediaType == "audio") "bestaudio/best" else "best",
            mediaType = mediaType,
            audioQuality = audioQuality,
            strategy = null,
            customHeaders = headers,
            onProgress = onProgress
          )
          succeeded = findDownloadedTempFile(tempDir) != null
        } catch (e: Exception) {
          lastError = e
          val rawErr = buildCauseChain(e).lowercase(Locale.US)
          if (rawErr.contains("canceled") || rawErr.contains("cancelled") || rawErr.contains("destroyed")) {
            throw e
          }
          Log.w(TAG, "yt-dlp sobre directStreamUrl falló, intentando estrategias de plataforma: $rawErr")
        }
      }

      // Cascada de estrategias por plataforma en yt-dlp
      if (!succeeded) {
        val strategies = buildPlatformStrategies(detectedPlatform, url)
        var idx = 0
        while (idx < strategies.size) {
          val strategy = strategies[idx]
          val attemptUrl = strategy.overrideUrl ?: url
          tempDir.listFiles()?.forEach { it.deleteRecursively() }

          try {
            runYtDlpDownloadRequest(
              targetUrl = attemptUrl,
              tempDir = tempDir,
              taskId = taskId,
              formatId = formatId,
              mediaType = mediaType,
              audioQuality = audioQuality,
              strategy = strategy,
              customHeaders = headers,
              onProgress = onProgress
            )
            succeeded = true
            lastError = null
            break
          } catch (e: Exception) {
            lastError = e
            val rawErr = buildCauseChain(e).lowercase(Locale.US)
            Log.w(TAG, "downloadMedia fallo (platform=$detectedPlatform, strategy=${strategy.name}): $rawErr")
            if (rawErr.contains("canceled") || rawErr.contains("cancelled") || rawErr.contains("destroyed")) {
              throw e
            }

            // Si falló únicamente por selector de calidad rígido, reintenta con 'best' + transcodificación local FFmpeg
            if (rawErr.contains("requested format is not available")) {
              try {
                tempDir.listFiles()?.forEach { it.deleteRecursively() }
                runYtDlpDownloadRequest(
                  targetUrl = attemptUrl,
                  tempDir = tempDir,
                  taskId = taskId,
                  formatId = if (mediaType == "audio") "bestaudio/best" else "best",
                  mediaType = mediaType,
                  audioQuality = audioQuality,
                  strategy = strategy,
                  customHeaders = headers,
                  onProgress = onProgress
                )
                succeeded = true
                lastError = null
                break
              } catch (fallbackFmtErr: Exception) {
                lastError = fallbackFmtErr
              }
            }

            if (!didForceUpdate && isRetryableExtractorError(e)) {
              didForceUpdate = true
              if (maybeUpdateYtDlp(context, force = true)) {
                continue
              }
            }
          }
          idx++
        }
      }

      // Último respaldo (Paso 3): descarga directa HTTP de MP4 + conversión local a MP3 con FFmpeg si aplica
      if (!succeeded) {
        var fallbackStreamUrl = directStreamUrl?.takeIf { it.startsWith("http") }
        var fallbackHeaders = headers ?: emptyMap()

        // Si no teníamos stream directo aún y es red social, intenta capturarlo con el WebView oculto
        if (fallbackStreamUrl == null && detectedPlatform != null && detectedPlatform != "YouTube") {
          val wv = SnowHiddenWebViewExtractor.extract(context, url, detectedPlatform, 14_000L)
          if (!wv.streamUrl.isNullOrBlank()) {
            fallbackStreamUrl = wv.streamUrl
            fallbackHeaders = wv.headers
          }
        }

        if (fallbackStreamUrl != null) {
          val lowerStream = fallbackStreamUrl.lowercase(Locale.US)
          val isManifest = lowerStream.contains(".m3u8") || lowerStream.contains(".mpd")
          tempDir.listFiles()?.forEach { it.deleteRecursively() }

          if (isManifest) {
            try {
              runYtDlpDownloadRequest(
                targetUrl = fallbackStreamUrl,
                tempDir = tempDir,
                taskId = taskId,
                formatId = if (mediaType == "audio") "bestaudio/best" else "best",
                mediaType = mediaType,
                audioQuality = audioQuality,
                strategy = null,
                customHeaders = fallbackHeaders,
                onProgress = onProgress
              )
              succeeded = findDownloadedTempFile(tempDir) != null
            } catch (e: Exception) {
              lastError = e
            }
          } else {
            val directFile = downloadDirectStreamViaHttp(
              streamUrl = fallbackStreamUrl,
              headers = fallbackHeaders,
              tempDir = tempDir,
              baseName = "snow_beats_${System.currentTimeMillis()}",
              onProgress = onProgress
            )
            if (directFile != null && directFile.exists() && directFile.length() > 0L) {
              if (mediaType == "audio") {
                convertLocalMediaToMp3(directFile, tempDir, taskId, audioQuality ?: "128K")
              }
              succeeded = findDownloadedTempFile(tempDir) != null
            }
          }
        }
      }

      if (!succeeded && lastError != null) {
        throw lastError
      }

      val downloadedFile = findDownloadedTempFile(tempDir)
        ?: return mapOf(
          "ok" to false,
          "errorCode" to "EMPTY_OUTPUT",
          "errorMessage" to "No se generó el archivo de salida tras la descarga."
        )

      val exported = exportDownloadedFile(
        context = context,
        sourceFile = downloadedFile,
        mediaType = mediaType,
        targetDisplayPath = targetDisplayPath
      )

      if (exported == null) {
        return mapOf(
          "ok" to false,
          "errorCode" to "PERMISSION_DENIED",
          "errorMessage" to "No se pudo guardar el archivo en la carpeta seleccionada. Revisa permisos."
        )
      }

      mapOf(
        "ok" to true,
        "filePath" to exported.first,
        "fileName" to exported.second
      )
    } catch (e: Exception) {
      val (code, msg) = classifyError(e, context, detectedPlatform)
      mapOf(
        "ok" to false,
        "errorCode" to code,
        "errorMessage" to msg
      )
    } finally {
      try {
        tempDir.deleteRecursively()
      } catch (_: Exception) { }
    }
  }

  private fun runYtDlpDownloadRequest(
    targetUrl: String,
    tempDir: File,
    taskId: String,
    formatId: String,
    mediaType: String,
    audioQuality: String?,
    strategy: ExtractionStrategy?,
    customHeaders: Map<String, String>?,
    onProgress: (Float, Long, String) -> Unit
  ) {
    val request = YoutubeDLRequest(targetUrl).apply {
      addOption("--no-playlist")
      addOption("--no-warnings")
      addOption("--no-check-certificates")
      addOption("--geo-bypass")
      addOption("--retries", "3")
      addOption("--fragment-retries", "3")
      addOption("--newline")
      addOption("--restrict-filenames")
      if (strategy != null) {
        applyStrategyToRequest(this, strategy)
      } else {
        applyCustomHeadersToRequest(this, customHeaders)
      }
      addOption("-o", File(tempDir, "%(title).110B.%(ext)s").absolutePath)

      if (mediaType == "audio") {
        addOption("-f", formatId.ifBlank { "bestaudio[ext=m4a]/bestaudio/best" })
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
  }

  // Descarga progresiva directa con HttpURLConnection reportando progreso en vivo
  private fun downloadDirectStreamViaHttp(
    streamUrl: String,
    headers: Map<String, String>,
    tempDir: File,
    baseName: String,
    onProgress: (Float, Long, String) -> Unit
  ): File? {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(streamUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        instanceFollowRedirects = true
        connectTimeout = 15000
        readTimeout = 25000
        setRequestProperty("User-Agent", headers["User-Agent"] ?: MOBILE_CHROME_UA)
        headers.forEach { (k, v) ->
          if (!k.equals("User-Agent", ignoreCase = true) && v.isNotBlank()) {
            setRequestProperty(k, v)
          }
        }
      }
      if (conn.responseCode !in 200..299) {
        Log.w(TAG, "Descarga directa HTTP devolvió código ${conn.responseCode}")
        return null
      }
      val totalBytes = conn.contentLengthLong
      val outFile = File(tempDir, "$baseName.mp4")
      val startTime = System.currentTimeMillis()
      var downloaded = 0L

      conn.inputStream.use { input ->
        FileOutputStream(outFile).use { output ->
          val buffer = ByteArray(16 * 1024)
          var read: Int
          while (input.read(buffer).also { read = it } != -1) {
            output.write(buffer, 0, read)
            downloaded += read
            val pct = if (totalBytes > 0L) {
              ((downloaded.toDouble() / totalBytes.toDouble()) * 100.0).toFloat().coerceIn(0f, 99f)
            } else {
              50f
            }
            val elapsedSec = ((System.currentTimeMillis() - startTime) / 1000.0).coerceAtLeast(0.5)
            val speed = downloaded / elapsedSec
            val eta = if (totalBytes > 0L && speed > 1.0) {
              ((totalBytes - downloaded) / speed).toLong().coerceAtLeast(0L)
            } else 0L
            onProgress(pct, eta, "Descargando flujo directo...")
          }
        }
      }
      onProgress(100f, 0L, "Descarga completada")
      outFile
    } catch (e: Exception) {
      Log.w(TAG, "Error en descarga directa HTTP: ${e.message}")
      null
    } finally {
      try { conn?.disconnect() } catch (_: Exception) { }
    }
  }

  // Convierte un MP4 local recién descargado a MP3 aprovechando FFmpeg gestionado por yt-dlp
  private fun convertLocalMediaToMp3(
    sourceVideo: File,
    tempDir: File,
    taskId: String,
    audioQuality: String
  ) {
    try {
      val mp3Out = File(tempDir, "${sourceVideo.nameWithoutExtension}.%(ext)s")
      val req = YoutubeDLRequest("file://${sourceVideo.absolutePath}").apply {
        addOption("--enable-file-urls")
        addOption("--no-warnings")
        addOption("-x")
        addOption("--audio-format", "mp3")
        addOption("--audio-quality", audioQuality)
        addOption("-o", mp3Out.absolutePath)
      }
      YoutubeDL.getInstance().execute(req, "${taskId}_mp3")
      val producedMp3 = tempDir.listFiles()?.firstOrNull { it.isFile && it.extension.equals("mp3", ignoreCase = true) }
      if (producedMp3 != null && producedMp3.length() > 0L) {
        sourceVideo.delete()
      }
    } catch (e: Exception) {
      Log.w(TAG, "No se pudo convertir archivo local a MP3 con FFmpeg: ${e.message}")
    }
  }

  private fun findDownloadedTempFile(tempDir: File): File? {
    return tempDir.listFiles()
      ?.filter { f ->
        f.isFile &&
          f.length() > 0L &&
          !f.name.endsWith(".part") &&
          !f.name.endsWith(".ytdl") &&
          !f.name.endsWith(".temp") &&
          !f.name.endsWith(".jpg") &&
          !f.name.endsWith(".jpeg") &&
          !f.name.endsWith(".webp") &&
          !f.name.endsWith(".png")
      }
      ?.sortedByDescending { it.length() }
      ?.firstOrNull()
  }

  private fun mimeTypeForFile(fileName: String, mediaType: String): String {
    val ext = fileName.substringAfterLast('.', "").lowercase(Locale.US)
    return when (ext) {
      "mp3" -> "audio/mpeg"
      "m4a" -> "audio/mp4"
      "opus" -> "audio/opus"
      "ogg" -> "audio/ogg"
      "flac" -> "audio/flac"
      "wav" -> "audio/wav"
      "mp4" -> "video/mp4"
      "mkv" -> "video/x-matroska"
      "webm" -> if (mediaType == "audio") "audio/webm" else "video/webm"
      else -> if (mediaType == "audio") "audio/mpeg" else "video/mp4"
    }
  }

  // Exporta el archivo desde caché temporal usando acceso directo, carpeta SAF (HyperOS) o MediaStore
  private fun exportDownloadedFile(
    context: Context,
    sourceFile: File,
    mediaType: String,
    targetDisplayPath: String
  ): Pair<String, String>? {
    val canUseDirect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
      ) == PackageManager.PERMISSION_GRANTED
    }

    // 1. Acceso directo al sistema de archivos si All Files Access (o Android <=10) está concedido
    if (canUseDirect) {
      try {
        val destDir = resolveTargetDirectory(targetDisplayPath)
        if (destDir.exists() || destDir.mkdirs()) {
          val destFile = resolveUniqueFile(destDir, sourceFile.name)
          FileInputStream(sourceFile).use { input ->
            FileOutputStream(destFile).use { output -> input.copyTo(output) }
          }
          MediaScannerConnection.scanFile(
            context.applicationContext,
            arrayOf(destFile.absolutePath),
            arrayOf(mimeTypeForFile(destFile.name, mediaType)),
            null
          )
          return Pair(destFile.absolutePath, destFile.name)
        }
      } catch (e: Exception) {
        Log.w(TAG, "Fallo escritura directa, intentando SAF/MediaStore: ${e.message}")
      }
    }

    // 2. Escritura vía carpeta SAF autorizada (funciona sin bloqueos en HyperOS y Android 11–15)
    val safTreeUri = getPersistedSafTreeUri(context)
    if (safTreeUri != null) {
      val safResult = exportToSafTree(context, safTreeUri, sourceFile, mediaType, targetDisplayPath)
      if (safResult != null) return safResult
    }

    // 3. Respaldo oficial vía MediaStore en Android 10+ (nunca requiere MANAGE_EXTERNAL_STORAGE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return exportToMediaStore(context, sourceFile, mediaType)
    }

    return null
  }

  private fun resolveUniqueFile(dir: File, originalName: String): File {
    var candidate = File(dir, originalName)
    if (!candidate.exists()) return candidate
    val base = originalName.substringBeforeLast('.', originalName)
    val ext = originalName.substringAfterLast('.', "")
    var index = 1
    while (candidate.exists() && index < 500) {
      val nextName = if (ext.isNotEmpty()) "${base}_($index).$ext" else "${base}_($index)"
      candidate = File(dir, nextName)
      index++
    }
    return candidate
  }

  private fun exportToSafTree(
    context: Context,
    treeUri: Uri,
    sourceFile: File,
    mediaType: String,
    targetDisplayPath: String
  ): Pair<String, String>? {
    return try {
      val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
      val treeTail = rootDocId.substringAfterLast(':').substringAfterLast('/').trim()
      val rawSegments = cleanRelativePath(targetDisplayPath)
        .split('/')
        .map { it.trim() }
        .filter { it.isNotEmpty() }

      // Evita duplicar carpetas si el usuario ya eligió la carpeta raíz (ej. "Snow beats" o "Snow beats audio")
      val matchIdx = rawSegments.indexOfLast { it.equals(treeTail, ignoreCase = true) }
      val subSegments = if (matchIdx >= 0) {
        rawSegments.drop(matchIdx + 1)
      } else {
        // Si el usuario eligió una carpeta genérica (ej. Music), crea una subcarpeta ordenada
        listOf(if (mediaType == "audio") "Snow beats audio" else "Snow beats video")
      }

      var currentParentDocId = rootDocId
      for (seg in subSegments) {
        val nextId = findOrCreateSafSubdir(context, treeUri, currentParentDocId, seg)
        if (nextId != null) {
          currentParentDocId = nextId
        }
      }

      val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, currentParentDocId)
      val mime = mimeTypeForFile(sourceFile.name, mediaType)
      val createdUri = DocumentsContract.createDocument(
        context.contentResolver,
        parentUri,
        mime,
        sourceFile.name
      ) ?: return null

      context.contentResolver.openOutputStream(createdUri)?.use { output ->
        FileInputStream(sourceFile).use { input -> input.copyTo(output) }
      } ?: return null

      // Notifica a MediaStore para que el audio/video aparezca al instante en la biblioteca local
      val createdDocId = try { DocumentsContract.getDocumentId(createdUri) } catch (_: Exception) { null }
      if (createdDocId != null && createdDocId.startsWith("primary:")) {
        val realPath = "/storage/emulated/0/" + createdDocId.removePrefix("primary:")
        MediaScannerConnection.scanFile(
          context.applicationContext,
          arrayOf(realPath),
          arrayOf(mime),
          null
        )
        return Pair(realPath, sourceFile.name)
      }

      Pair(createdUri.toString(), sourceFile.name)
    } catch (e: Exception) {
      Log.w(TAG, "Error exportando a SAF: ${e.message}", e)
      null
    }
  }

  private fun findOrCreateSafSubdir(
    context: Context,
    treeUri: Uri,
    parentDocId: String,
    folderName: String
  ): String? {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
    try {
      context.contentResolver.query(
        childrenUri,
        arrayOf(
          DocumentsContract.Document.COLUMN_DOCUMENT_ID,
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_MIME_TYPE
        ),
        null,
        null,
        null
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val docId = cursor.getString(0)
          val name = cursor.getString(1)
          val mime = cursor.getString(2)
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR &&
            name.equals(folderName, ignoreCase = true)
          ) {
            return docId
          }
        }
      }
    } catch (_: Exception) { }

    return try {
      val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId)
      val createdUri = DocumentsContract.createDocument(
        context.contentResolver,
        parentUri,
        DocumentsContract.Document.MIME_TYPE_DIR,
        folderName
      )
      createdUri?.let { DocumentsContract.getDocumentId(it) }
    } catch (_: Exception) {
      null
    }
  }

  private fun exportToMediaStore(
    context: Context,
    sourceFile: File,
    mediaType: String
  ): Pair<String, String>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return try {
      val mime = mimeTypeForFile(sourceFile.name, mediaType)
      val collection = if (mediaType == "audio") {
        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      } else {
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      }
      val relativeDir = if (mediaType == "audio") {
        "${Environment.DIRECTORY_MUSIC}/Snow beats/Snow beats audio"
      } else {
        "${Environment.DIRECTORY_MOVIES}/Snow beats/Snow beats video"
      }

      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, sourceFile.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

      val insertedUri = context.contentResolver.insert(collection, values) ?: return null
      context.contentResolver.openOutputStream(insertedUri)?.use { output ->
        FileInputStream(sourceFile).use { input -> input.copyTo(output) }
      } ?: return null

      val doneValues = ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }
      context.contentResolver.update(insertedUri, doneValues, null, null)

      Pair("$relativeDir/${sourceFile.name}", sourceFile.name)
    } catch (e: Exception) {
      Log.e(TAG, "Error exportando a MediaStore: ${e.message}", e)
      null
    }
  }

  fun cancelDownload(taskId: String): Boolean {
    return try {
      YoutubeDL.getInstance().destroyProcessById(taskId)
    } catch (_: Exception) {
      false
    }
  }

  // Clasifica cualquier error de yt-dlp / Android en un motivo claro y veraz para el usuario
  private fun classifyError(
    e: Exception,
    context: Context,
    platform: String? = null
  ): Pair<String, String> {
    val fullMsg = buildCauseChain(e)
    val raw = fullMsg.lowercase(Locale.US)
    val platLabel = platform ?: "La plataforma"
    return when {
      raw.contains("libpython.zip.so") || raw.contains("uselegacypackaging") ->
        Pair("INIT_FAILED", fullMsg)

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

      raw.contains("requested format is not available") ->
        Pair("FORMAT_UNAVAILABLE", "La calidad elegida no está disponible para este enlace. Prueba otra opción.")

      raw.contains("403") || raw.contains("forbidden") ->
        Pair(
          "HTTP_403",
          "$platLabel bloqueó temporalmente el flujo (HTTP 403). Intenta de nuevo o prueba otra calidad."
        )

      raw.contains("login required") ||
        raw.contains("empty media response") ||
        raw.contains("confirm you're not a bot") ||
        raw.contains("sign in") ||
        raw.contains("cookies") ->
        Pair(
          "LOGIN_REQUIRED",
          "$platLabel bloqueó el acceso anónimo para este enlace (requiere sesión o límite anti-bot temporal)."
        )

      raw.contains("private video") ||
        raw.contains("video unavailable") ||
        raw.contains("removed") ||
        raw.contains("404") ->
        Pair("PRIVATE_OR_UNAVAILABLE", "El contenido es privado, fue eliminado o no está disponible.")

      raw.contains("429") || raw.contains("too many requests") ->
        Pair("RATE_LIMITED", "$platLabel limitó temporalmente las peticiones (HTTP 429). Intenta más tarde.")

      raw.contains("unsupported url") ->
        Pair("UNSUPPORTED_URL", "URL no soportada por yt-dlp.")

      else ->
        Pair("UNKNOWN", "Error durante el proceso: ${fullMsg.take(220)}")
    }
  }
}
