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
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.PI
import kotlin.math.floor

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

// Motor 100 % On-Device de extracción y descarga por dominio para Snow Beats:
// - Spotify:    spotify-native (embed/oembed -> ytmsearch1/ytsearch1 -> FFmpeg metadata + cover art, SOLO AUDIO)
// - X/Twitter:  http-x (syndication API pública) -> webview-sniffer -> yt-dlp
// - TikTok:     http-tiktok (HTML + rehydration JSON + cookies efímeras) -> webview-sniffer -> yt-dlp
// - IG / FB:    webview-sniffer (interceptación de red + aborto rápido en muro de login) -> yt-dlp
// - YouTube:    yt-dlp (clientes android_vr / tv / safari / ios)
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
    "open.spotify.com",
    "spotify.com",
    "spotify.link",
    "spoti.fi",
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
        Log.w(TAG, "FFmpeg no disponible: ${buildCauseChain(e)}")
      }
      initialized = true

      maybeUpdateYtDlp(appCtx, force = false)
    }
  }

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

  fun getPersistedSafTreeUri(context: Context): Uri? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val saved = prefs.getString(KEY_SAF_TREE_URI, null) ?: return null
    val uri = try { Uri.parse(saved) } catch (_: Exception) { return null }
    val stillGranted = context.contentResolver.persistedUriPermissions.any { perm ->
      perm.uri == uri && perm.isWritePermission
    }
    return if (stillGranted) uri else null
  }

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
      Environment.isExternalStorageManager() || getPersistedSafTreeUri(context) != null
    } else {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
      ) == PackageManager.PERMISSION_GRANTED
    }
  }

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
        host.contains("spotify.com") || host == "spotify.link" || host == "spoti.fi" -> "Spotify"
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

  // Resuelve enlaces cortos y compartidos (TikTok, Facebook, X, Instagram, Spotify)
  private fun resolveShortRedirect(url: String): String {
    val lower = url.lowercase(Locale.US)
    val shouldResolve = lower.contains("vm.tiktok.com") ||
      lower.contains("vt.tiktok.com") ||
      lower.contains("fb.watch") ||
      lower.contains("facebook.com/share/") ||
      lower.contains("fb.com/") ||
      lower.contains("://t.co/") ||
      lower.contains("instagr.am/") ||
      lower.contains("spotify.link") ||
      lower.contains("spoti.fi/")
    if (!shouldResolve) return url

    var current = url
    repeat(6) {
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

  private fun normalizeUrl(rawUrl: String, followShortLinks: Boolean = false): String {
    var current = unwrapGoogleRedirect(rawUrl)
    if (followShortLinks) {
      current = resolveShortRedirect(current)
    }
    return try {
      val uri = Uri.parse(current)
      val host = (uri.host ?: "").lowercase(Locale.US)
      if (host.contains("spotify.com")) {
        val path = (uri.path ?: "").trimEnd('/')
        val match = Regex("/(?:intl-[a-z]{2}/)?(track|album|playlist)/([A-Za-z0-9]+)").find(path)
        if (match != null) {
          return "https://open.spotify.com/${match.groupValues[1]}/${match.groupValues[2]}"
        }
      }
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

  // ==================== FORMATOS ESTÁNDAR Y SPOTIFY ====================

  private fun buildDirectStreamAudioFormats(): List<Map<String, Any?>> = listOf(
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
      "label" to "Alta calidad MP3 (192 kbps)",
      "ext" to "mp3",
      "qualityRank" to 192,
      "audioQuality" to "192K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_320",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "Máxima calidad MP3 (320 kbps)",
      "ext" to "mp3",
      "qualityRank" to 320,
      "audioQuality" to "320K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_m4a",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "AAC / M4A (192 kbps)",
      "ext" to "m4a",
      "qualityRank" to 256,
      "audioQuality" to "192K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "direct_audio_opus",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "OPUS eficiente (160 kbps)",
      "ext" to "opus",
      "qualityRank" to 220,
      "audioQuality" to "160K",
      "filesize" to 0L
    )
  ).sortedBy { (it["qualityRank"] as? Int) ?: 0 }

  private fun buildSpotifyAudioFormats(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "spotify_audio_128",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "MP3 estándar (128 kbps)",
      "ext" to "mp3",
      "qualityRank" to 128,
      "audioQuality" to "128K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "spotify_audio_opus",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "OPUS alta eficiencia (160 kbps)",
      "ext" to "opus",
      "qualityRank" to 160,
      "audioQuality" to "160K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "spotify_audio_192",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "MP3 alta calidad (192 kbps)",
      "ext" to "mp3",
      "qualityRank" to 192,
      "audioQuality" to "192K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "spotify_audio_m4a",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "M4A / AAC nativo (256 kbps)",
      "ext" to "m4a",
      "qualityRank" to 256,
      "audioQuality" to "256K",
      "filesize" to 0L
    ),
    mapOf(
      "id" to "spotify_audio_320",
      "formatId" to "bestaudio/best",
      "mediaType" to "audio",
      "label" to "MP3 máxima calidad (320 kbps)",
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

  // ==================== CAPA 1: SPOTIFY NATIVO (ESTILO spotDL, SOLO AUDIO) ====================

  private fun extractSpotifyMediaInfo(canonicalUrl: String): Map<String, Any?> {
    Log.i(TAG, "[layer=spotify-native] Extrayendo metadatos públicos de Spotify: $canonicalUrl")
    val match = Regex("open\\.spotify\\.com/(track|album|playlist)/([A-Za-z0-9]+)").find(canonicalUrl)
      ?: return mapOf(
        "ok" to false,
        "errorCode" to "UNSUPPORTED_URL",
        "errorMessage" to "Usa un enlace válido de canción, álbum o playlist de Spotify."
      )

    val kind = match.groupValues[1]
    val spotifyId = match.groupValues[2]
    val embedUrl = "https://open.spotify.com/embed/$kind/$spotifyId"

    var entityObj: JSONObject? = null
    var ogTitle: String? = null
    var ogDesc: String? = null
    var ogImage: String? = null

    try {
      val (code, html, _) = httpGetTextWithCookies(
        url = embedUrl,
        headers = mapOf(
          "User-Agent" to MOBILE_CHROME_UA,
          "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language" to "es-ES,es;q=0.9,en;q=0.8"
        )
      )
      if (code in 200..299 && html.isNotBlank()) {
        ogTitle = extractMetaTag(html, "og:title")
        ogDesc = extractMetaTag(html, "og:description")
        ogImage = extractMetaTag(html, "og:image")

        val nextDataRaw = Regex(
          "<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>",
          setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
        ).find(html)?.groupValues?.getOrNull(1)?.trim()

        if (!nextDataRaw.isNullOrBlank()) {
          val nextJson = JSONObject(nextDataRaw)
          entityObj = nextJson
            .optJSONObject("props")
            ?.optJSONObject("pageProps")
            ?.optJSONObject("state")
            ?.optJSONObject("data")
            ?.optJSONObject("entity")
        }

        // Respaldo: esquema legacy <script id="initial-state"> (Base64)
        if (entityObj == null) {
          val initRaw = Regex(
            "<script[^>]+id=\"initial-state\"[^>]*>(.*?)</script>",
            setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
          ).find(html)?.groupValues?.getOrNull(1)?.trim()
          if (!initRaw.isNullOrBlank()) {
            try {
              val decoded = String(android.util.Base64.decode(initRaw, android.util.Base64.DEFAULT))
              val initJson = JSONObject(decoded)
              entityObj = initJson.optJSONObject("data")?.optJSONObject("entity")
            } catch (_: Exception) { }
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "[layer=spotify-native] Fallo lectura de embed: ${e.message}")
    }

    // Respaldo público oficial oEmbed si el embed HTML no trajo __NEXT_DATA__
    if (entityObj == null && ogTitle.isNullOrBlank()) {
      try {
        val oembedUrl = "https://open.spotify.com/oembed?url=${URLEncoder.encode(canonicalUrl, "UTF-8")}"
        val (code, body, _) = httpGetTextWithCookies(
          url = oembedUrl,
          headers = mapOf("User-Agent" to MOBILE_CHROME_UA, "Accept" to "application/json")
        )
        if (code in 200..299 && body.isNotBlank()) {
          val oembed = JSONObject(body)
          ogTitle = oembed.optString("title").takeIf { it.isNotBlank() }
          ogImage = oembed.optString("thumbnail_url").takeIf { it.startsWith("http") } ?: ogImage
        }
      } catch (e: Exception) {
        Log.w(TAG, "[layer=spotify-native] Fallo oEmbed: ${e.message}")
      }
    }

    if (entityObj == null && ogTitle.isNullOrBlank()) {
      return mapOf(
        "ok" to false,
        "errorCode" to "PRIVATE_CONTENT",
        "errorMessage" to "No se pudieron obtener los metadatos públicos de Spotify (puede ser privado o inválido)."
      )
    }

    val coverUrl = extractSpotifyCoverArt(entityObj) ?: ogImage

    // Caso A: Álbum o Playlist de Spotify (solo audio)
    if (kind == "album" || kind == "playlist") {
      val collectionTitle = entityObj?.optString("name")?.takeIf { it.isNotBlank() }
        ?: entityObj?.optString("title")?.takeIf { it.isNotBlank() }
        ?: ogTitle
        ?: "Spotify $kind"
      val collectionOwner = extractSpotifyArtists(entityObj)
        .ifBlank { entityObj?.optString("subtitle")?.trim().orEmpty() }
        .ifBlank { "Spotify" }

      val trackList = entityObj?.optJSONArray("trackList") ?: JSONArray()
      val items = mutableListOf<Map<String, Any?>>()
      for (i in 0 until trackList.length()) {
        val item = trackList.optJSONObject(i) ?: continue
        val rawTrackUri = item.optString("uri", "")
        val tid = rawTrackUri.substringAfterLast(':', "").ifBlank { item.optString("uid", "sp_$i") }
        val itemTitle = item.optString("title").ifBlank { item.optString("name", "Pista ${i + 1}") }.trim()
        val itemArtist = item.optString("subtitle")
          .replace("•", ",")
          .replace("·", ",")
          .trim()
          .ifBlank { collectionOwner }
        val durationMs = item.optLong("duration", 0L)
        val durationSec = if (durationMs > 0L) durationMs / 1000.0 else 0.0
        val trackUrl = if (tid.length >= 10 && !tid.startsWith("sp_")) {
          "https://open.spotify.com/track/$tid"
        } else {
          canonicalUrl
        }
        items.add(
          mapOf(
            "id" to tid,
            "index" to (i + 1),
            "title" to itemTitle,
            "artist" to itemArtist,
            "album" to if (kind == "album") collectionTitle else "",
            "duration" to durationSec,
            "thumbnail" to coverUrl,
            "url" to trackUrl
          )
        )
      }

      if (items.isEmpty()) {
        return mapOf(
          "ok" to false,
          "errorCode" to "PRIVATE_CONTENT",
          "errorMessage" to "La playlist o álbum de Spotify está vacío o es privado."
        )
      }

      Log.i(TAG, "[layer=spotify-native] Colección resuelta: '$collectionTitle' (${items.size} pistas, solo audio)")
      return mapOf(
        "ok" to true,
        "isPlaylist" to true,
        "isAudioOnly" to true,
        "extractionSource" to "spotify-native",
        "title" to collectionTitle,
        "uploader" to collectionOwner,
        "album" to if (kind == "album") collectionTitle else "",
        "domain" to "open.spotify.com",
        "platform" to "Spotify",
        "thumbnail" to coverUrl,
        "duration" to 0.0,
        "url" to canonicalUrl,
        "directStreamUrl" to null,
        "previewStreamUrl" to null,
        "previewHeaders" to emptyMap<String, String>(),
        "entries" to items,
        "audioFormats" to buildSpotifyAudioFormats(),
        "videoFormats" to emptyList<Map<String, Any?>>()
      )
    }

    // Caso B: Canción individual de Spotify (/track/<id>, SOLO AUDIO)
    val trackTitle = entityObj?.optString("name")?.takeIf { it.isNotBlank() }
      ?: entityObj?.optString("title")?.takeIf { it.isNotBlank() }
      ?: ogTitle?.substringBefore(" - song")?.substringBefore(" | Spotify")?.trim()
      ?: "Spotify Track"

    val trackArtist = extractSpotifyArtists(entityObj)
      .ifBlank { entityObj?.optString("subtitle")?.replace("•", ",")?.trim().orEmpty() }
      .ifBlank { parseSpotifyOgArtist(ogDesc) }
      .ifBlank { "Artista desconocido" }

    val trackAlbum = entityObj?.optJSONObject("albumOfTrack")?.optString("name")?.takeIf { it.isNotBlank() }
      ?: entityObj?.optString("albumName")?.takeIf { it.isNotBlank() }
      ?: trackTitle

    val durationMs = entityObj?.optLong("duration", 0L) ?: 0L
    val durationSec = if (durationMs > 0L) durationMs / 1000.0 else 0.0
    val audioPreviewUrl = entityObj?.optJSONObject("audioPreview")?.optString("url")?.takeIf { it.startsWith("http") }

    Log.i(TAG, "[layer=spotify-native] Pista resuelta: '$trackArtist - $trackTitle' (album='$trackAlbum', ${durationSec}s)")
    return mapOf(
      "ok" to true,
      "isPlaylist" to false,
      "isAudioOnly" to true,
      "extractionSource" to "spotify-native",
      "title" to trackTitle,
      "uploader" to trackArtist,
      "album" to trackAlbum,
      "domain" to "open.spotify.com",
      "platform" to "Spotify",
      "thumbnail" to coverUrl,
      "duration" to durationSec,
      "url" to canonicalUrl,
      "directStreamUrl" to null,
      "previewStreamUrl" to audioPreviewUrl,
      "previewHeaders" to mapOf("User-Agent" to MOBILE_CHROME_UA),
      "entries" to emptyList<Map<String, Any?>>(),
      "audioFormats" to buildSpotifyAudioFormats(),
      "videoFormats" to emptyList<Map<String, Any?>>()
    )
  }

  private fun extractSpotifyArtists(entity: JSONObject?): String {
    if (entity == null) return ""
    val artistsArr = entity.optJSONArray("artists")
    if (artistsArr != null && artistsArr.length() > 0) {
      val names = mutableListOf<String>()
      for (i in 0 until artistsArr.length()) {
        val a = artistsArr.optJSONObject(i) ?: continue
        val n = a.optString("name").trim()
        if (n.isNotEmpty()) names.add(n)
      }
      if (names.isNotEmpty()) return names.joinToString(", ")
    }
    return ""
  }

  private fun extractSpotifyCoverArt(entity: JSONObject?): String? {
    if (entity == null) return null
    fun bestFromArray(arr: JSONArray?): String? {
      if (arr == null || arr.length() == 0) return null
      var bestUrl: String? = null
      var bestWidth = -1
      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val u = obj.optString("url").trim()
        if (!u.startsWith("http")) continue
        val w = obj.optInt("maxWidth", obj.optInt("width", 0))
        if (bestUrl == null || w >= bestWidth) {
          bestWidth = w
          bestUrl = u
        }
      }
      return bestUrl
    }

    return bestFromArray(entity.optJSONObject("visualIdentity")?.optJSONArray("image"))
      ?: bestFromArray(entity.optJSONObject("coverArt")?.optJSONArray("sources"))
      ?: bestFromArray(entity.optJSONObject("albumOfTrack")?.optJSONObject("coverArt")?.optJSONArray("sources"))
  }

  private fun parseSpotifyOgArtist(ogDesc: String?): String {
    if (ogDesc.isNullOrBlank()) return ""
    // Ej: "Listen to Blinding Lights on Spotify. Song · The Weeknd · 2020"
    val parts = ogDesc.split("·").map { it.trim() }.filter { it.isNotEmpty() }
    if (parts.size >= 2) {
      val candidate = parts[1]
      if (!candidate.matches(Regex("^\\d{4}$"))) return candidate
    }
    return ""
  }

  // ==================== CAPA 1: X / TWITTER NATIVO (SYNDICATION API PÚBLICA) ====================

  private fun computeTwitterSyndicationToken(tweetId: String): String {
    val idVal = tweetId.toDoubleOrNull() ?: return "1"
    val value = (idVal / 1e15) * PI
    val base36 = doubleToBase36(value, 14)
    return base36.replace("0", "").replace(".", "").ifBlank { "1" }
  }

  // Convierte un double positivo a base 36 equivalente a Number.prototype.toString(36) en JS
  private fun doubleToBase36(num: Double, fracDigits: Int): String {
    if (num <= 0.0 || num.isNaN() || num.isInfinite()) return "0"
    val alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    val intPart = floor(num).toLong()
    var frac = num - intPart.toDouble()
    val sb = StringBuilder()
    sb.append(intPart.toString(36))
    if (frac > 0.0) {
      sb.append('.')
      repeat(fracDigits) {
        frac *= 36.0
        val digit = floor(frac).toInt().coerceIn(0, 35)
        sb.append(alphabet[digit])
        frac -= digit.toDouble()
      }
    }
    return sb.toString()
  }

  private fun tryXNativeSyndicationExtractor(canonicalUrl: String): Map<String, Any?>? {
    val idMatch = Regex("/status/(\\d+)").find(canonicalUrl) ?: return null
    val tweetId = idMatch.groupValues[1]
    val token = computeTwitterSyndicationToken(tweetId)
    val apiUrl = "https://cdn.syndication.twimg.com/tweet-result?id=$tweetId&lang=en&token=$token"

    Log.i(TAG, "[layer=http-x] Consultando endpoint público syndication para tweetId=$tweetId")
    return try {
      val (code, body, _) = httpGetTextWithCookies(
        url = apiUrl,
        headers = mapOf(
          "User-Agent" to MOBILE_CHROME_UA,
          "Accept" to "application/json, text/plain, */*",
          "Referer" to "https://platform.twitter.com/",
          "Origin" to "https://platform.twitter.com"
        )
      )
      if (code !in 200..299 || body.isBlank()) {
        Log.w(TAG, "[layer=http-x] Syndication devolvió HTTP $code")
        return null
      }

      val root = JSONObject(body)
      val variants = mutableListOf<Pair<Int, String>>() // bitrate -> url
      var thumbUrl: String? = null
      var durationSec = 0.0

      // 1. Busca en mediaDetails (esquema estándar de tweets con video/gif)
      val mediaDetails = root.optJSONArray("mediaDetails")
      if (mediaDetails != null) {
        for (i in 0 until mediaDetails.length()) {
          val m = mediaDetails.optJSONObject(i) ?: continue
          val mThumb = m.optString("media_url_https").takeIf { it.startsWith("http") }
          if (thumbUrl == null && mThumb != null) thumbUrl = mThumb
          val videoInfo = m.optJSONObject("video_info") ?: continue
          val durMs = videoInfo.optLong("duration_millis", 0L)
          if (durMs > 0L) durationSec = durMs / 1000.0
          val vArr = videoInfo.optJSONArray("variants") ?: continue
          for (j in 0 until vArr.length()) {
            val v = vArr.optJSONObject(j) ?: continue
            val contentType = v.optString("content_type", "")
            val u = v.optString("url", "")
            if (contentType.equals("video/mp4", ignoreCase = true) && u.startsWith("http")) {
              variants.add(Pair(v.optInt("bitrate", 0), u))
            }
          }
          if (variants.isNotEmpty()) break
        }
      }

      // 2. Respaldo en campo video.variants (esquema compacto)
      if (variants.isEmpty()) {
        val videoObj = root.optJSONObject("video")
        if (videoObj != null) {
          if (thumbUrl == null) {
            thumbUrl = videoObj.optString("poster").takeIf { it.startsWith("http") }
          }
          val durMs = videoObj.optLong("durationMs", 0L)
          if (durMs > 0L) durationSec = durMs / 1000.0
          val vArr = videoObj.optJSONArray("variants")
          if (vArr != null) {
            for (j in 0 until vArr.length()) {
              val v = vArr.optJSONObject(j) ?: continue
              val type = v.optString("type", "")
              val src = v.optString("src", "")
              if (type.equals("video/mp4", ignoreCase = true) && src.startsWith("http")) {
                val resMatch = Regex("/(\\d+)x(\\d+)/").find(src)
                val score = resMatch?.groupValues?.getOrNull(2)?.toIntOrNull() ?: (j + 1) * 100
                variants.add(Pair(score, src))
              }
            }
          }
        }
      }

      if (variants.isEmpty()) {
        Log.w(TAG, "[layer=http-x] El tweet no expuso variantes MP4 públicas en syndication.")
        return null
      }

      val sortedVariants = variants.sortedByDescending { it.first }
      val bestVideoUrl = sortedVariants.first().second

      val userObj = root.optJSONObject("user")
      val screenName = userObj?.optString("screen_name")?.takeIf { it.isNotBlank() }
      val userName = userObj?.optString("name")?.takeIf { it.isNotBlank() }
      val uploader = if (screenName != null) "@$screenName" else (userName ?: "X")

      val rawText = root.optString("text", "")
        .replace(Regex("https://t\\.co/\\S+"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
      val cleanTitle = rawText.take(90).ifBlank { "Video de $uploader" }

      val xHeaders = mapOf(
        "User-Agent" to MOBILE_CHROME_UA,
        "Referer" to "https://x.com/"
      )

      Log.i(TAG, "[layer=http-x] Video MP4 resuelto (${sortedVariants.size} variantes): ${bestVideoUrl.take(100)}")
      mapOf(
        "ok" to true,
        "isPlaylist" to false,
        "isAudioOnly" to false,
        "extractionSource" to "http-x",
        "title" to cleanTitle,
        "uploader" to uploader,
        "domain" to "x.com",
        "platform" to "X",
        "thumbnail" to thumbUrl,
        "duration" to durationSec,
        "url" to canonicalUrl,
        "directStreamUrl" to bestVideoUrl,
        "previewStreamUrl" to bestVideoUrl,
        "previewHeaders" to xHeaders,
        "entries" to emptyList<Map<String, Any?>>(),
        "audioFormats" to buildDirectStreamAudioFormats(),
        "videoFormats" to buildDirectStreamVideoFormats()
      )
    } catch (e: Exception) {
      Log.w(TAG, "[layer=http-x] Error en extractor nativo de X: ${e.message}")
      null
    }
  }

  // ==================== CAPA 1: TIKTOK NATIVO (HTML + REHYDRATION JSON + COOKIES EFÍMERAS) ====================

  private fun tryTikTokNativeHttpExtractor(canonicalUrl: String): Map<String, Any?>? {
    Log.i(TAG, "[layer=http-tiktok] Extrayendo HTML + cookies efímeras para: $canonicalUrl")
    return try {
      val (code, html, cookies) = httpGetTextWithCookies(
        url = canonicalUrl,
        headers = mapOf(
          "User-Agent" to DESKTOP_CHROME_UA,
          "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language" to "es-ES,es;q=0.9,en;q=0.8",
          "Referer" to "https://www.tiktok.com/"
        )
      )
      if (code !in 200..299 || html.isBlank()) {
        Log.w(TAG, "[layer=http-tiktok] HTTP $code sin HTML utilizable.")
        return null
      }

      var itemStruct: JSONObject? = null

      // 1. __UNIVERSAL_DATA_FOR_REHYDRATION__
      val rehydrationRaw = Regex(
        "<script[^>]+id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"[^>]*>(.*?)</script>",
        setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
      ).find(html)?.groupValues?.getOrNull(1)?.trim()

      if (!rehydrationRaw.isNullOrBlank()) {
        try {
          val root = JSONObject(rehydrationRaw)
          val defaultScope = root.optJSONObject("__DEFAULT_SCOPE__")
          val videoDetail = defaultScope?.optJSONObject("webapp.video-detail")
          itemStruct = videoDetail?.optJSONObject("itemInfo")?.optJSONObject("itemStruct")
        } catch (_: Exception) { }
      }

      // 2. Respaldo SIGI_STATE
      if (itemStruct == null) {
        val sigiRaw = Regex(
          "<script[^>]+id=\"SIGI_STATE\"[^>]*>(.*?)</script>",
          setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
        ).find(html)?.groupValues?.getOrNull(1)?.trim()
        if (!sigiRaw.isNullOrBlank()) {
          try {
            val sigi = JSONObject(sigiRaw)
            val itemModule = sigi.optJSONObject("ItemModule")
            val firstKey = itemModule?.keys()?.let { if (it.hasNext()) it.next() else null }
            if (firstKey != null) {
              itemStruct = itemModule.optJSONObject(firstKey)
            }
          } catch (_: Exception) { }
        }
      }

      if (itemStruct == null) {
        Log.w(TAG, "[layer=http-tiktok] No se encontró JSON de rehidratación en HTML de TikTok.")
        return null
      }

      val videoObj = itemStruct.optJSONObject("video") ?: return null
      var streamUrl = videoObj.optString("playAddr").takeIf { it.startsWith("http") }
        ?: videoObj.optString("downloadAddr").takeIf { it.startsWith("http") }

      if (streamUrl == null) {
        val bitrateInfo = videoObj.optJSONArray("bitrateInfo")
        if (bitrateInfo != null && bitrateInfo.length() > 0) {
          val urlList = bitrateInfo.optJSONObject(0)
            ?.optJSONObject("PlayAddr")
            ?.optJSONArray("UrlList")
          if (urlList != null && urlList.length() > 0) {
            streamUrl = urlList.optString(0).takeIf { it.startsWith("http") }
          }
        }
      }

      if (streamUrl.isNullOrBlank()) {
        Log.w(TAG, "[layer=http-tiktok] itemStruct no contiene URL de video.")
        return null
      }

      val thumbUrl = videoObj.optString("originCover").takeIf { it.startsWith("http") }
        ?: videoObj.optString("cover").takeIf { it.startsWith("http") }
        ?: extractMetaTag(html, "og:image")
      val durationSec = videoObj.optDouble("duration", 0.0).takeIf { !it.isNaN() } ?: 0.0
      val authorObj = itemStruct.optJSONObject("author")
      val uniqueId = authorObj?.optString("uniqueId")?.takeIf { it.isNotBlank() }
        ?: itemStruct.optString("author").takeIf { it.isNotBlank() && !it.startsWith("{") }
      val uploader = if (uniqueId != null) "@$uniqueId" else "TikTok"
      val desc = itemStruct.optString("desc", "").trim()
      val title = desc.take(90).ifBlank { "TikTok · $uploader" }

      val ttHeaders = LinkedHashMap<String, String>().apply {
        put("User-Agent", DESKTOP_CHROME_UA)
        put("Referer", "https://www.tiktok.com/")
        if (cookies.isNotBlank()) {
          put("Cookie", cookies)
        }
      }

      Log.i(TAG, "[layer=http-tiktok] Video resuelto con cookies efímeras (${cookies.length} chars): ${streamUrl.take(100)}")
      mapOf(
        "ok" to true,
        "isPlaylist" to false,
        "isAudioOnly" to false,
        "extractionSource" to "http-tiktok",
        "title" to title,
        "uploader" to uploader,
        "domain" to "tiktok.com",
        "platform" to "TikTok",
        "thumbnail" to thumbUrl,
        "duration" to durationSec,
        "url" to canonicalUrl,
        "directStreamUrl" to streamUrl,
        "previewStreamUrl" to streamUrl,
        "previewHeaders" to ttHeaders,
        "entries" to emptyList<Map<String, Any?>>(),
        "audioFormats" to buildDirectStreamAudioFormats(),
        "videoFormats" to buildDirectStreamVideoFormats()
      )
    } catch (e: Exception) {
      Log.w(TAG, "[layer=http-tiktok] Error en extractor nativo de TikTok: ${e.message}")
      null
    }
  }

  // ==================== UTILIDADES HTTP NATIVAS (CON CAPTURA DE SET-COOKIE) ====================

  private fun httpGetTextWithCookies(
    url: String,
    headers: Map<String, String>
  ): Triple<Int, String, String> {
    var currentUrl = url
    val cookieJar = LinkedHashMap<String, String>()
    var lastCode = 0

    repeat(6) {
      var conn: HttpURLConnection? = null
      try {
        conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          instanceFollowRedirects = false
          connectTimeout = 10_000
          readTimeout = 12_000
          headers.forEach { (k, v) -> setRequestProperty(k, v) }
          if (cookieJar.isNotEmpty()) {
            setRequestProperty("Cookie", cookieJar.entries.joinToString("; ") { "${it.key}=${it.value}" })
          }
        }

        lastCode = conn.responseCode
        // Captura todas las cookies efímeras Set-Cookie de cada salto HTTP
        val setCookies = conn.headerFields?.entries
          ?.filter { it.key != null && it.key.equals("Set-Cookie", ignoreCase = true) }
          ?.flatMap { it.value ?: emptyList() }
          ?: emptyList()
        for (rawCookie in setCookies) {
          val kv = rawCookie.substringBefore(';').trim()
          val eqIdx = kv.indexOf('=')
          if (eqIdx > 0) {
            cookieJar[kv.substring(0, eqIdx).trim()] = kv.substring(eqIdx + 1).trim()
          }
        }

        if (lastCode in 300..399) {
          val loc = conn.getHeaderField("Location")?.trim()
          if (loc.isNullOrBlank()) {
            val cookieStr = cookieJar.entries.joinToString("; ") { "${it.key}=${it.value}" }
            return Triple(lastCode, "", cookieStr)
          }
          currentUrl = if (loc.startsWith("http://") || loc.startsWith("https://")) {
            loc
          } else {
            URL(URL(currentUrl), loc).toString()
          }
        } else {
          val stream = if (lastCode in 200..299) conn.inputStream else conn.errorStream
          val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
          val cookieStr = cookieJar.entries.joinToString("; ") { "${it.key}=${it.value}" }
          return Triple(lastCode, body, cookieStr)
        }
      } finally {
        try { conn?.disconnect() } catch (_: Exception) { }
      }
    }

    val cookieStr = cookieJar.entries.joinToString("; ") { "${it.key}=${it.value}" }
    return Triple(lastCode, "", cookieStr)
  }

  private fun extractMetaTag(html: String, propertyName: String): String? {
    val p1 = Regex(
      "<meta[^>]+(?:property|name)=[\"']${Regex.escape(propertyName)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
      RegexOption.IGNORE_CASE
    )
    val p2 = Regex(
      "<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']${Regex.escape(propertyName)}[\"']",
      RegexOption.IGNORE_CASE
    )
    val raw = p1.find(html)?.groupValues?.getOrNull(1)
      ?: p2.find(html)?.groupValues?.getOrNull(1)
      ?: return null
    return htmlUnescape(raw).trim().takeIf { it.isNotEmpty() }
  }

  private fun htmlUnescape(raw: String): String {
    return raw
      .replace("&amp;", "&")
      .replace("&quot;", "\"")
      .replace("&#39;", "'")
      .replace("&#x27;", "'")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
  }

  // ==================== ESTRATEGIAS yt-dlp POR PLATAFORMA ====================

  private fun buildPlatformStrategies(platform: String?, canonicalUrl: String): List<ExtractionStrategy> {
    return when (platform) {
      "YouTube" -> listOf(
        ExtractionStrategy(name = "yt_android_vr", extractorArgs = "youtube:player_client=android_vr"),
        ExtractionStrategy(name = "yt_tv_android_vr", extractorArgs = "youtube:player_client=tv,android_vr"),
        ExtractionStrategy(name = "yt_tv_simply_safari", extractorArgs = "youtube:player_client=tv_simply,web_safari"),
        ExtractionStrategy(name = "yt_android_ios", extractorArgs = "youtube:player_client=android,ios"),
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
        } catch (_: Exception) { null }
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

  private fun tryInstagramPublicEmbedFallback(canonicalUrl: String): Map<String, Any?>? {
    val match = Regex("instagram\\.com/(reel|p|tv)/([A-Za-z0-9_-]+)").find(canonicalUrl) ?: return null
    val kind = match.groupValues[1]
    val shortcode = match.groupValues[2]
    val embedUrl = "https://www.instagram.com/$kind/$shortcode/embed/captioned/"

    return try {
      val (code, html, _) = httpGetTextWithCookies(
        url = embedUrl,
        headers = mapOf(
          "User-Agent" to MOBILE_CHROME_UA,
          "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language" to "es-ES,es;q=0.9,en;q=0.8"
        )
      )
      if (code !in 200..299 || html.isBlank()) return null

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

      Log.i(TAG, "[layer=embed] Respaldo público Instagram embed resuelto para @$rawAuthor")
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
      Log.w(TAG, "[layer=embed] Respaldo embed de Instagram no disponible: ${e.message}")
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

  // Capa WebView Network Sniffer (retorna mapa ok=true, mapa ok=false con LOGIN_WALL, o null si no encontró flujo)
  private fun tryWebViewSniffer(
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
        Log.w(TAG, "[layer=webview-sniffer] Muro de login confirmado en $platform.")
        return mapOf(
          "ok" to false,
          "errorCode" to "LOGIN_WALL",
          "errorMessage" to "$platform restringe esta publicación (es privada o requiere inicio de sesión)."
        )
      }
      return null
    }

    val hostDomain = try { Uri.parse(canonicalUrl).host ?: platform } catch (_: Exception) { platform }
    val cleanTitle = wv.title?.takeIf { it.isNotBlank() } ?: "Video de $platform"
    Log.i(TAG, "[layer=webview-sniffer] Flujo capturado para $platform: ${streamUrl.take(100)}")
    return mapOf(
      "ok" to true,
      "isPlaylist" to false,
      "isAudioOnly" to false,
      "extractionSource" to "webview-sniffer",
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

  // ==================== ENRUTADOR LIMPIO POR DOMINIO (extractMediaInfo) ====================

  fun extractMediaInfo(context: Context, rawUrl: String): Map<String, Any?> {
    val unwrapped = unwrapGoogleRedirect(rawUrl)
    if (!isAllowedUrl(unwrapped)) {
      return mapOf(
        "ok" to false,
        "errorCode" to "UNSUPPORTED_URL",
        "errorMessage" to "Enlace no compatible. Usa URLs de YouTube, Spotify, Instagram, TikTok, Facebook o X."
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
    Log.i(TAG, "Router extractMediaInfo -> platform=$detectedPlatform url=${url.take(120)}")

    return when (detectedPlatform) {
      // 1. SPOTIFY -> Capa 1: spotify-native (SOLO AUDIO)
      "Spotify" -> extractSpotifyMediaInfo(url)

      // 2. X / TWITTER -> Capa 1: http-x -> Capa 2: webview-sniffer -> Capa 3: yt-dlp
      "X" -> {
        tryXNativeSyndicationExtractor(url)?.let { return it }
        Log.i(TAG, "[router=X] Escalando a layer=webview-sniffer")
        val wv = tryWebViewSniffer(context, url, "X")
        if (wv != null && wv["ok"] == true) return wv
        if (wv != null && wv["errorCode"] == "LOGIN_WALL") return wv
        Log.i(TAG, "[router=X] Escalando a layer=yt-dlp")
        extractViaYtDlp(context, url, "X")
      }

      // 3. TIKTOK -> Capa 1: http-tiktok -> Capa 2: webview-sniffer -> Capa 3: yt-dlp
      "TikTok" -> {
        tryTikTokNativeHttpExtractor(url)?.let { return it }
        Log.i(TAG, "[router=TikTok] Escalando a layer=webview-sniffer")
        val wv = tryWebViewSniffer(context, url, "TikTok")
        if (wv != null && wv["ok"] == true) return wv
        if (wv != null && wv["errorCode"] == "LOGIN_WALL") return wv
        Log.i(TAG, "[router=TikTok] Escalando a layer=yt-dlp")
        extractViaYtDlp(context, url, "TikTok")
      }

      // 4. INSTAGRAM & FACEBOOK -> Capa 1: webview-sniffer -> (IG embed rápido) -> Capa 2: yt-dlp
      "Instagram", "Facebook" -> {
        Log.i(TAG, "[router=$detectedPlatform] Capa 1 -> layer=webview-sniffer")
        val wv = tryWebViewSniffer(context, url, detectedPlatform)
        if (wv != null && wv["ok"] == true) return wv
        if (wv != null && wv["errorCode"] == "LOGIN_WALL") return wv

        if (detectedPlatform == "Instagram") {
          tryInstagramPublicEmbedFallback(url)?.let { return it }
        }

        Log.i(TAG, "[router=$detectedPlatform] Escalando a Capa 2 -> layer=yt-dlp")
        extractViaYtDlp(context, url, detectedPlatform)
      }

      // 5. YOUTUBE (y genéricos) -> Capa 1: yt-dlp
      else -> {
        Log.i(TAG, "[router=${detectedPlatform ?: "Generic"}] Capa 1 -> layer=yt-dlp")
        extractViaYtDlp(context, url, detectedPlatform)
      }
    }
  }

  // Capa yt-dlp con inspección completa de resolución y tamaños
  private fun extractViaYtDlp(
    context: Context,
    url: String,
    detectedPlatform: String?
  ): Map<String, Any?> {
    return try {
      ensureInitialized(context)

      val strategies = buildPlatformStrategies(detectedPlatform, url)
      var rawOut = ""
      var bestMaxHeight = -1
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
            if (detectedPlatform == "YouTube") {
              val (isPl, maxH) = inspectJsonResolution(out)
              if (isPl || maxH >= 720) {
                rawOut = out
                bestMaxHeight = maxH
                lastException = null
                break
              }
              if (maxH > bestMaxHeight || rawOut.isBlank()) {
                rawOut = out
                bestMaxHeight = maxH
                lastException = null
              }
              Log.i(TAG, "[layer=yt-dlp] YouTube strategy=${strategy.name} solo devolvió ${maxH}p, probando siguiente cliente HD...")
            } else {
              rawOut = out
              lastException = null
              break
            }
          }
        } catch (e: Exception) {
          if (rawOut.isBlank()) lastException = e
          Log.w(TAG, "[layer=yt-dlp] fallo (platform=$detectedPlatform, strategy=${strategy.name}): ${buildCauseChain(e)}")
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
        if (lastException != null) {
          val (code, msg) = classifyError(lastException, context, detectedPlatform)
          return mapOf("ok" to false, "errorCode" to code, "errorMessage" to msg)
        }
        return mapOf(
          "ok" to false,
          "errorCode" to "EMPTY_RESPONSE",
          "errorMessage" to "No se obtuvo información multimedia pública para este enlace."
        )
      }

      val jsonLine = rawOut.lineSequence().lastOrNull { it.trim().startsWith("{") } ?: rawOut
      val root = JSONObject(jsonLine)
      val type = root.optString("_type", "video")
      val platform = detectedPlatform ?: root.optString("extractor_key", "Web")
      val hostDomain = Uri.parse(url).host ?: platform

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
              "album" to "",
              "duration" to entryDuration,
              "thumbnail" to thumb,
              "url" to entryUrl
            )
          )
        }

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
          "audioFormats" to buildStandardPlaylistAudioFormats(),
          "videoFormats" to buildStandardPlaylistVideoFormats()
        )
      }

      val parsedFormats = parseFormats(root)
      val previewInfo = pickPreviewStream(root)

      Log.i(TAG, "[layer=yt-dlp] Extracción exitosa platform=$platform")
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
      mapOf("ok" to false, "errorCode" to code, "errorMessage" to msg)
    }
  }

  private fun inspectJsonResolution(rawOut: String): Pair<Boolean, Int> {
    return try {
      val jsonLine = rawOut.lineSequence().lastOrNull { it.trim().startsWith("{") } ?: rawOut
      val root = JSONObject(jsonLine)
      val type = root.optString("_type", "video")
      if (type == "playlist" || root.has("entries")) {
        return Pair(true, 0)
      }
      var maxH = root.optInt("height", 0)
      val formats = root.optJSONArray("formats")
      if (formats != null) {
        for (i in 0 until formats.length()) {
          val f = formats.optJSONObject(i) ?: continue
          val vcodec = f.optString("vcodec", "none")
          if (vcodec != "none") {
            val h = f.optInt("height", 0)
            if (h > maxH) maxH = h
          }
        }
      }
      Pair(false, maxH)
    } catch (_: Exception) {
      Pair(false, 0)
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

  private fun pickPreviewStream(root: JSONObject): PreviewStreamSelection {
    val rootHeaders = parseHttpHeadersJson(root.optJSONObject("http_headers"))
    val formats = root.optJSONArray("formats")
    if (formats == null || formats.length() == 0) {
      val direct = root.optString("url").takeIf { it.startsWith("http") }
      val vcodec = root.optString("vcodec", "none")
      return PreviewStreamSelection(vcodec == "none", direct, rootHeaders)
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

    if (bestProgressiveVideo != null) return PreviewStreamSelection(false, bestProgressiveVideo, bestProgressiveHeaders)
    if (bestAnyVideo != null) return PreviewStreamSelection(false, bestAnyVideo, bestAnyVideoHeaders)
    if (bestAudioOnly != null) return PreviewStreamSelection(true, bestAudioOnly, bestAudioHeaders)

    val fallback = root.optString("url").takeIf { it.startsWith("http") }
    return PreviewStreamSelection(false, fallback, rootHeaders)
  }

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
          val selector = if (height >= 480) {
            "bestvideo[height<=${height}][height>=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}][height>=480]+bestaudio/best[height<=${height}][height>=480]"
          } else {
            "bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best"
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

  // ==================== DESCARGA UNIFICADA POR PLATAFORMA (downloadMedia) ====================

  fun downloadMedia(
    context: Context,
    taskId: String,
    rawUrl: String,
    formatId: String,
    mediaType: String,
    audioQuality: String?,
    audioFormat: String? = null,
    targetDisplayPath: String,
    headers: Map<String, String>? = null,
    directStreamUrl: String? = null,
    metadataTitle: String? = null,
    metadataArtist: String? = null,
    metadataAlbum: String? = null,
    metadataArtworkUrl: String? = null,
    onProgress: (Float, Long, String) -> Unit
  ): Map<String, Any?> {
    val url = normalizeUrl(rawUrl, followShortLinks = true)
    val detectedPlatform = detectPlatform(url) ?: detectPlatform(rawUrl)
    val effectiveMediaType = if (detectedPlatform == "Spotify") "audio" else mediaType
    val normalizedAudioFormat = when (audioFormat?.lowercase(Locale.US)?.trim()) {
      "m4a" -> "m4a"
      "opus" -> "opus"
      else -> "mp3"
    }

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

      // ===== RUTA SPOTIFY (SOLO AUDIO + METADATOS Y CARÁTULA SPOTIFY) =====
      if (detectedPlatform == "Spotify") {
        val spResult = downloadSpotifyTrack(
          context = context,
          canonicalUrl = url,
          tempDir = tempDir,
          taskId = taskId,
          audioFormat = normalizedAudioFormat,
          audioQuality = audioQuality ?: "192K",
          metadataTitle = metadataTitle,
          metadataArtist = metadataArtist,
          metadataAlbum = metadataAlbum,
          metadataArtworkUrl = metadataArtworkUrl,
          onProgress = onProgress
        )
        if (spResult != null) return spResult
      } else {
        // ===== RUTA REDES SOCIALES Y YOUTUBE =====
        var lastError: Exception? = null
        var didForceUpdate = false
        var succeeded = false

        val initialDirectUrl = directStreamUrl?.takeIf { it.startsWith("http") }
        val activeHeaders = headers ?: emptyMap()

        // 1. Si tenemos un flujo directo capturado por http-x / http-tiktok / webview-sniffer / embed:
        //    - Si es progresivo (.mp4 / stream directo): descarga HTTP directa rápida con cookies/headers capturados
        //    - Si es manifiesto (.m3u8 / .mpd): ensamblado local vía yt-dlp + FFmpeg con los headers capturados
        if (initialDirectUrl != null && detectedPlatform != "YouTube") {
          val lowerStream = initialDirectUrl.lowercase(Locale.US)
          val isManifest = lowerStream.contains(".m3u8") || lowerStream.contains(".mpd")
          tempDir.listFiles()?.forEach { it.deleteRecursively() }

          if (!isManifest) {
            Log.i(TAG, "[download=$detectedPlatform] Descargando flujo progresivo directo vía HTTP con headers capturados")
            val baseName = sanitizeFileName(metadataTitle ?: "snow_beats_${System.currentTimeMillis()}")
            val directFile = downloadDirectStreamViaHttp(
              streamUrl = initialDirectUrl,
              headers = activeHeaders,
              tempDir = tempDir,
              baseName = baseName,
              onProgress = onProgress
            )
            if (directFile != null && directFile.exists() && directFile.length() > 0L) {
              if (effectiveMediaType == "audio") {
                convertLocalMediaToAudio(
                  sourceVideo = directFile,
                  tempDir = tempDir,
                  taskId = taskId,
                  audioFormat = normalizedAudioFormat,
                  audioQuality = audioQuality ?: "192K"
                )
              }
              succeeded = findDownloadedTempFile(tempDir) != null
            }
          }

          if (!succeeded) {
            try {
              Log.i(TAG, "[download=$detectedPlatform] Procesando flujo directo/manifiesto con yt-dlp + FFmpeg")
              tempDir.listFiles()?.forEach { it.deleteRecursively() }
              runYtDlpDownloadRequest(
                targetUrl = initialDirectUrl,
                tempDir = tempDir,
                taskId = taskId,
                formatId = if (effectiveMediaType == "audio") "bestaudio/best" else "best",
                mediaType = effectiveMediaType,
                audioFormat = normalizedAudioFormat,
                audioQuality = audioQuality,
                outputTemplate = metadataTitle?.let { "${sanitizeFileName(it)}.%(ext)s" },
                strategy = null,
                customHeaders = activeHeaders,
                onProgress = onProgress
              )
              succeeded = findDownloadedTempFile(tempDir) != null
            } catch (e: Exception) {
              lastError = e
              val rawErr = buildCauseChain(e).lowercase(Locale.US)
              if (rawErr.contains("canceled") || rawErr.contains("cancelled") || rawErr.contains("destroyed")) {
                throw e
              }
              Log.w(TAG, "[download=$detectedPlatform] Flujo directo falló ($rawErr), intentando respaldo...")
            }
          }
        }

        // 2. Cascada de estrategias yt-dlp (capa primaria para YouTube, respaldo para redes sociales)
        if (!succeeded) {
          val strategies = buildPlatformStrategies(detectedPlatform, url)
          var idx = 0
          while (idx < strategies.size) {
            val strategy = strategies[idx]
            val attemptUrl = strategy.overrideUrl ?: url
            tempDir.listFiles()?.forEach { it.deleteRecursively() }

            try {
              Log.i(TAG, "[layer=yt-dlp] Descargando platform=$detectedPlatform strategy=${strategy.name}")
              runYtDlpDownloadRequest(
                targetUrl = attemptUrl,
                tempDir = tempDir,
                taskId = taskId,
                formatId = formatId,
                mediaType = effectiveMediaType,
                audioFormat = normalizedAudioFormat,
                audioQuality = audioQuality,
                outputTemplate = null,
                strategy = strategy,
                customHeaders = activeHeaders,
                onProgress = onProgress
              )
              succeeded = true
              lastError = null
              break
            } catch (e: Exception) {
              lastError = e
              val rawErr = buildCauseChain(e).lowercase(Locale.US)
              Log.w(TAG, "[layer=yt-dlp] downloadMedia fallo (platform=$detectedPlatform, strategy=${strategy.name}): $rawErr")
              if (rawErr.contains("canceled") || rawErr.contains("cancelled") || rawErr.contains("destroyed")) {
                throw e
              }

              val allowBestDowngrade = detectedPlatform != "YouTube" || idx == strategies.lastIndex
              if (allowBestDowngrade && rawErr.contains("requested format is not available")) {
                try {
                  tempDir.listFiles()?.forEach { it.deleteRecursively() }
                  runYtDlpDownloadRequest(
                    targetUrl = attemptUrl,
                    tempDir = tempDir,
                    taskId = taskId,
                    formatId = if (effectiveMediaType == "audio") "bestaudio/best" else "best",
                    mediaType = effectiveMediaType,
                    audioFormat = normalizedAudioFormat,
                    audioQuality = audioQuality,
                    outputTemplate = null,
                    strategy = strategy,
                    customHeaders = activeHeaders,
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

        // 3. Último recurso para redes sociales: refrescar stream fresco vía WebView Sniffer
        if (!succeeded && detectedPlatform != null && detectedPlatform != "YouTube") {
          val wv = SnowHiddenWebViewExtractor.extract(context, url, detectedPlatform, 14_000L)
          val freshStream = wv.streamUrl
          if (!freshStream.isNullOrBlank()) {
            val freshHeaders = wv.headers
            val isManifest = freshStream.lowercase(Locale.US).let { it.contains(".m3u8") || it.contains(".mpd") }
            tempDir.listFiles()?.forEach { it.deleteRecursively() }

            if (isManifest) {
              try {
                runYtDlpDownloadRequest(
                  targetUrl = freshStream,
                  tempDir = tempDir,
                  taskId = taskId,
                  formatId = if (effectiveMediaType == "audio") "bestaudio/best" else "best",
                  mediaType = effectiveMediaType,
                  audioFormat = normalizedAudioFormat,
                  audioQuality = audioQuality,
                  outputTemplate = metadataTitle?.let { "${sanitizeFileName(it)}.%(ext)s" },
                  strategy = null,
                  customHeaders = freshHeaders,
                  onProgress = onProgress
                )
                succeeded = findDownloadedTempFile(tempDir) != null
              } catch (e: Exception) {
                lastError = e
              }
            } else {
              val baseName = sanitizeFileName(metadataTitle ?: wv.title ?: "snow_beats_${System.currentTimeMillis()}")
              val directFile = downloadDirectStreamViaHttp(
                streamUrl = freshStream,
                headers = freshHeaders,
                tempDir = tempDir,
                baseName = baseName,
                onProgress = onProgress
              )
              if (directFile != null && directFile.exists() && directFile.length() > 0L) {
                if (effectiveMediaType == "audio") {
                  convertLocalMediaToAudio(
                    sourceVideo = directFile,
                    tempDir = tempDir,
                    taskId = taskId,
                    audioFormat = normalizedAudioFormat,
                    audioQuality = audioQuality ?: "192K"
                  )
                }
                succeeded = findDownloadedTempFile(tempDir) != null
              }
            }
          } else if (wv.requiresLogin) {
            return mapOf(
              "ok" to false,
              "errorCode" to "LOGIN_WALL",
              "errorMessage" to "$detectedPlatform requiere inicio de sesión o la publicación es privada."
            )
          }
        }

        if (!succeeded && lastError != null) {
          throw lastError
        }
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
        mediaType = effectiveMediaType,
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
      mapOf("ok" to false, "errorCode" to code, "errorMessage" to msg)
    } finally {
      try {
        tempDir.deleteRecursively()
      } catch (_: Exception) { }
    }
  }

  // ==================== DESCARGA SPOTIFY NATIVA (ytmsearch1 + METADATOS Y CARÁTULA) ====================

  private fun downloadSpotifyTrack(
    context: Context,
    canonicalUrl: String,
    tempDir: File,
    taskId: String,
    audioFormat: String,
    audioQuality: String,
    metadataTitle: String?,
    metadataArtist: String?,
    metadataAlbum: String?,
    metadataArtworkUrl: String?,
    onProgress: (Float, Long, String) -> Unit
  ): Map<String, Any?>? {
    var title = metadataTitle?.trim().orEmpty()
    var artist = metadataArtist?.trim().orEmpty()
    var album = metadataAlbum?.trim().orEmpty()
    var artworkUrl = metadataArtworkUrl?.trim()

    // Si faltan metadatos (p. ej. descarga directa o reintento), extráelos del embed público de Spotify
    if (title.isBlank() || artist.isBlank() || artworkUrl.isNullOrBlank()) {
      val info = extractSpotifyMediaInfo(canonicalUrl)
      if (info["ok"] == true && info["isPlaylist"] != true) {
        if (title.isBlank()) title = (info["title"] as? String).orEmpty()
        if (artist.isBlank()) artist = (info["uploader"] as? String).orEmpty()
        if (album.isBlank()) album = (info["album"] as? String).orEmpty()
        if (artworkUrl.isNullOrBlank()) artworkUrl = info["thumbnail"] as? String
      }
    }

    if (title.isBlank()) {
      return mapOf(
        "ok" to false,
        "errorCode" to "SPOTIFY_NOT_FOUND",
        "errorMessage" to "No se pudieron resolver los metadatos de la pista de Spotify."
      )
    }
    if (artist.isBlank()) artist = "Artista desconocido"
    if (album.isBlank()) album = title

    val cleanBaseName = sanitizeFileName("$artist - $title")
    val searchQueries = listOf(
      "ytmsearch1:$artist - $title",
      "ytsearch1:$artist - $title official audio"
    )

    var lastErr: Exception? = null
    var downloaded = false

    for ((idx, query) in searchQueries.withIndex()) {
      tempDir.listFiles()?.forEach { it.deleteRecursively() }
      try {
        Log.i(TAG, "[layer=spotify-native] Resolviendo audio (${idx + 1}/${searchQueries.size}): $query")
        onProgress(5f, 0L, "Buscando audio oficial...")
        val request = YoutubeDLRequest(query).apply {
          addOption("--no-playlist")
          addOption("--no-warnings")
          addOption("--no-check-certificates")
          addOption("--geo-bypass")
          addOption("--retries", "3")
          addOption("--newline")
          addOption("--extractor-args", "youtube:player_client=android_vr,tv")
          addOption("-f", "bestaudio[ext=m4a]/bestaudio/best")
          addOption("-x")
          addOption("--audio-format", audioFormat)
          addOption("--audio-quality", audioQuality)
          // Si no descargamos carátula Spotify manual, conserva thumbnail de YouTube Music como respaldo
          if (artworkUrl.isNullOrBlank()) {
            addOption("--embed-thumbnail")
          }
          addOption("--add-metadata")
          addOption("-o", File(tempDir, "$cleanBaseName.%(ext)s").absolutePath)
        }
        YoutubeDL.getInstance().execute(request, taskId) { progress, etaInSeconds, line ->
          onProgress((progress * 0.92f).coerceIn(0f, 92f), etaInSeconds, line)
        }
        if (findDownloadedTempFile(tempDir) != null) {
          downloaded = true
          lastErr = null
          break
        }
      } catch (e: Exception) {
        lastErr = e
        val raw = buildCauseChain(e).lowercase(Locale.US)
        if (raw.contains("canceled") || raw.contains("cancelled") || raw.contains("destroyed")) {
          throw e
        }
        Log.w(TAG, "[layer=spotify-native] Búsqueda '$query' falló: $raw")
      }
    }

    if (!downloaded) {
      if (lastErr != null) throw lastErr
      return mapOf(
        "ok" to false,
        "errorCode" to "SPOTIFY_NOT_FOUND",
        "errorMessage" to "No se encontró una fuente de audio pública para \"$artist - $title\"."
      )
    }

    // Incrusta metadatos reales de Spotify (título, artista, álbum) y carátula HD usando FFmpeg local
    val audioFile = findDownloadedTempFile(tempDir)
    if (audioFile != null) {
      onProgress(95f, 0L, "Aplicando metadatos y carátula de Spotify...")
      embedSpotifyTagsAndCover(
        context = context,
        audioFile = audioFile,
        tempDir = tempDir,
        title = title,
        artist = artist,
        album = album,
        artworkUrl = artworkUrl
      )
      onProgress(100f, 0L, "Descarga completada")
    }
    return null // Continúa con la exportación estándar en downloadMedia()
  }

  // Incrusta etiquetas limpias de Spotify y carátula HD con el binario FFmpeg empaquetado localmente
  private fun embedSpotifyTagsAndCover(
    context: Context,
    audioFile: File,
    tempDir: File,
    title: String,
    artist: String,
    album: String,
    artworkUrl: String?
  ) {
    val ffmpegBin = locateBundledFfmpeg(context) ?: return
    val coverFile = if (!artworkUrl.isNullOrBlank() && artworkUrl.startsWith("http")) {
      downloadCoverToFile(artworkUrl, File(tempDir, "spotify_cover.jpg"))
    } else null

    val ext = audioFile.extension.lowercase(Locale.US)
    val taggedFile = File(tempDir, "${audioFile.nameWithoutExtension}_tagged.$ext")

    try {
      val cmd = mutableListOf(ffmpegBin.absolutePath, "-y", "-i", audioFile.absolutePath)
      val supportsAttachedPic = ext == "mp3" || ext == "m4a"
      if (coverFile != null && coverFile.exists() && coverFile.length() > 0L && supportsAttachedPic) {
        cmd.addAll(listOf("-i", coverFile.absolutePath))
        cmd.addAll(listOf("-map", "0:a:0", "-map", "1:v:0", "-c:a", "copy"))
        if (ext == "mp3") {
          cmd.addAll(listOf("-c:v", "mjpeg", "-id3v2_version", "3", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"))
        } else {
          // m4a / mp4 container
          cmd.addAll(listOf("-c:v", "mjpeg", "-disposition:v:0", "attached_pic"))
        }
      } else {
        cmd.addAll(listOf("-map", "0:a:0", "-c:a", "copy"))
      }

      cmd.addAll(
        listOf(
          "-metadata", "title=$title",
          "-metadata", "artist=$artist",
          "-metadata", "album=$album",
          taggedFile.absolutePath
        )
      )

      val pb = ProcessBuilder(cmd).redirectErrorStream(true)
      // Asegura LD_LIBRARY_PATH con nativeLibraryDir para que libffmpeg.so resuelva dependencias nativas
      val nativeDir = context.applicationInfo.nativeLibraryDir
      val currentLd = pb.environment()["LD_LIBRARY_PATH"].orEmpty()
      pb.environment()["LD_LIBRARY_PATH"] = if (currentLd.isBlank()) nativeDir else "$nativeDir:$currentLd"

      val proc = pb.start()
      proc.inputStream.bufferedReader().use { it.readText() }
      val exitCode = proc.waitFor()
      if (exitCode == 0 && taggedFile.exists() && taggedFile.length() > 0L) {
        audioFile.delete()
        taggedFile.renameTo(audioFile)
        Log.i(TAG, "[layer=spotify-native] Metadatos y carátula Spotify incrustados correctamente.")
      } else {
        taggedFile.delete()
        Log.w(TAG, "[layer=spotify-native] FFmpeg tagging retornó código $exitCode (se conserva audio descargado).")
      }
    } catch (e: Exception) {
      taggedFile.delete()
      Log.w(TAG, "[layer=spotify-native] No se pudo re-etiquetar con FFmpeg local: ${e.message}")
    } finally {
      try { coverFile?.delete() } catch (_: Exception) { }
    }
  }

  private fun locateBundledFfmpeg(context: Context): File? {
    val candidates = listOf(
      File(context.applicationInfo.nativeLibraryDir, "libffmpeg.so"),
      File(context.noBackupFilesDir, "youtubedl-android/packages/ffmpeg/usr/bin/ffmpeg"),
      File(context.filesDir, "youtubedl-android/packages/ffmpeg/usr/bin/ffmpeg")
    )
    return candidates.firstOrNull { it.exists() && it.canExecute() }
  }

  private fun downloadCoverToFile(url: String, dest: File): File? {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        instanceFollowRedirects = true
        connectTimeout = 8000
        readTimeout = 8000
        setRequestProperty("User-Agent", MOBILE_CHROME_UA)
      }
      if (conn.responseCode !in 200..299) return null
      conn.inputStream.use { input ->
        FileOutputStream(dest).use { output -> input.copyTo(output) }
      }
      if (dest.exists() && dest.length() > 0L) dest else null
    } catch (_: Exception) {
      null
    } finally {
      try { conn?.disconnect() } catch (_: Exception) { }
    }
  }

  private fun sanitizeFileName(raw: String): String {
    val clean = raw
      .replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]+"), " ")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(96)
    return clean.ifBlank { "snow_beats_${System.currentTimeMillis()}" }
  }

  private fun runYtDlpDownloadRequest(
    targetUrl: String,
    tempDir: File,
    taskId: String,
    formatId: String,
    mediaType: String,
    audioFormat: String,
    audioQuality: String?,
    outputTemplate: String?,
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
      val outName = outputTemplate ?: "%(title).110B.%(ext)s"
      addOption("-o", File(tempDir, outName).absolutePath)

      if (mediaType == "audio") {
        addOption("-f", formatId.ifBlank { "bestaudio[ext=m4a]/bestaudio/best" })
        addOption("-x")
        addOption("--audio-format", audioFormat)
        addOption("--audio-quality", audioQuality ?: "128K")
        if (audioFormat != "opus") {
          addOption("--embed-thumbnail")
        }
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

  private fun convertLocalMediaToAudio(
    sourceVideo: File,
    tempDir: File,
    taskId: String,
    audioFormat: String,
    audioQuality: String
  ) {
    try {
      val audioOut = File(tempDir, "${sourceVideo.nameWithoutExtension}.%(ext)s")
      val req = YoutubeDLRequest("file://${sourceVideo.absolutePath}").apply {
        addOption("--enable-file-urls")
        addOption("--no-warnings")
        addOption("-x")
        addOption("--audio-format", audioFormat)
        addOption("--audio-quality", audioQuality)
        addOption("-o", audioOut.absolutePath)
      }
      YoutubeDL.getInstance().execute(req, "${taskId}_audio")
      val produced = tempDir.listFiles()?.firstOrNull {
        it.isFile && it.extension.equals(audioFormat, ignoreCase = true)
      }
      if (produced != null && produced.length() > 0L) {
        sourceVideo.delete()
      }
    } catch (e: Exception) {
      Log.w(TAG, "No se pudo convertir archivo local a $audioFormat con FFmpeg: ${e.message}")
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

    val safTreeUri = getPersistedSafTreeUri(context)
    if (safTreeUri != null) {
      val safResult = exportToSafTree(context, safTreeUri, sourceFile, mediaType, targetDisplayPath)
      if (safResult != null) return safResult
    }

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

      val matchIdx = rawSegments.indexOfLast { it.equals(treeTail, ignoreCase = true) }
      val subSegments = if (matchIdx >= 0) {
        rawSegments.drop(matchIdx + 1)
      } else {
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
          "LOGIN_WALL",
          "$platLabel restringe este contenido (privado o requiere inicio de sesión)."
        )

      raw.contains("private video") ||
        raw.contains("video unavailable") ||
        raw.contains("removed") ||
        raw.contains("404") ->
        Pair("PRIVATE_CONTENT", "El contenido es privado, fue eliminado o no está disponible.")

      raw.contains("429") || raw.contains("too many requests") ->
        Pair("RATE_LIMITED", "$platLabel limitó temporalmente las peticiones (HTTP 429). Intenta más tarde.")

      raw.contains("unsupported url") ->
        Pair("UNSUPPORTED_URL", "URL no soportada.")

      else ->
        Pair("UNKNOWN", "Error durante el proceso: ${fullMsg.take(220)}")
    }
  }
}
