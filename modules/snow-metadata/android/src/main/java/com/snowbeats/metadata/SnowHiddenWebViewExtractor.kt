package com.snowbeats.metadata

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class WebViewExtractionResult(
  val streamUrl: String? = null,
  val headers: Map<String, String> = emptyMap(),
  val title: String? = null,
  val thumbnail: String? = null,
  val requiresLogin: Boolean = false,
  val errorDetail: String? = null
)

// Extractor nativo WebView Network Sniffer (layer=webview-sniffer):
// intercepta tráfico real de video/manifiestos, inyecta sonda ligera DOM/OG,
// detecta muros de login para abortar rápido y propaga headers + cookies efímeras.
object SnowHiddenWebViewExtractor {
  private const val TAG = "SnowHiddenWebView"

  // User-Agent móvil real de Chrome Android (sin el token "; wv" para evitar detección anti-bot)
  const val MOBILE_CHROME_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36"

  private val ignoredExtensions = listOf(
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico",
    ".css", ".js", ".mjs", ".woff", ".woff2", ".ttf", ".otf", ".json", ".vtt", ".srt"
  )

  private val ignoredPathKeywords = listOf(
    "doubleclick", "googlesyndication", "google-analytics", "analytics",
    "pixel", "tracking", "telemetry", "storyboard", "sprite", "mosaic",
    "avatar", "profile_pic", "rsrc.php", "static.cdninstagram.com/rsrc",
    "favicon", "manifest.json", "service-worker", "ads/", "/ad/",
    "ad_break", "sponsored", "thumbnail", "thumb_", "preview_sprite"
  )

  private val knownVideoCdnHosts = listOf(
    "cdninstagram.com",
    "fbcdn.net",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokcdn-eu.com",
    "tiktokv.com",
    "video.twimg.com",
    "twimg.com"
  )

  @SuppressLint("SetJavaScriptEnabled")
  fun extract(
    context: Context,
    pageUrl: String,
    platform: String,
    timeoutMs: Long = 14_000L
  ): WebViewExtractionResult {
    Log.i(TAG, "[layer=webview-sniffer] Iniciando extracción para platform=$platform url=${pageUrl.take(120)}")
    val mainHandler = Handler(Looper.getMainLooper())
    val latch = CountDownLatch(1)
    val completed = AtomicBoolean(false)

    val capturedStream = AtomicReference<String?>(null)
    val capturedPriority = AtomicReference<Int>(0)
    val capturedHeaders = AtomicReference<Map<String, String>>(emptyMap())
    val capturedTitle = AtomicReference<String?>(null)
    val capturedThumb = AtomicReference<String?>(null)
    val loginWallDetected = AtomicBoolean(false)
    val webViewRef = AtomicReference<WebView?>(null)
    val scheduledRunnables = mutableListOf<Runnable>()

    fun finishEarly() {
      if (completed.compareAndSet(false, true)) {
        latch.countDown()
      }
    }

    fun scheduleTask(delayMs: Long, block: () -> Unit) {
      val task = Runnable { block() }
      synchronized(scheduledRunnables) { scheduledRunnables.add(task) }
      mainHandler.postDelayed(task, delayMs)
    }

    fun recordCandidate(url: String, priority: Int, headers: Map<String, String>) {
      val currentPriority = capturedPriority.get()
      if (capturedStream.get() == null || priority > currentPriority) {
        capturedStream.set(url)
        capturedPriority.set(priority)
        capturedHeaders.set(headers)
      }
      // Stream de alta confianza capturado: deja 650ms para que el DOM entregue título/miniatura y termina pronto
      if (priority >= 3) {
        scheduleTask(650L) { finishEarly() }
      } else if (priority >= 2) {
        scheduleTask(1200L) { finishEarly() }
      }
    }

    // Sonda JS ligera: lee <video>, <source>, OpenGraph y detecta muros de login/cuenta privada
    val probeJs = """
      (function() {
        try {
          var result = { videoUrl: null, title: null, image: null, loginWall: false, reason: null };
          var ogVideo = document.querySelector('meta[property="og:video:secure_url"], meta[property="og:video"], meta[name="twitter:player:stream"]');
          if (ogVideo && ogVideo.content && ogVideo.content.indexOf('http') === 0) {
            result.videoUrl = ogVideo.content;
          }
          var ogTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
          result.title = (ogTitle && ogTitle.content) ? ogTitle.content : (document.title || null);
          var ogImg = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
          if (ogImg && ogImg.content && ogImg.content.indexOf('http') === 0) {
            result.image = ogImg.content;
          }
          var videos = document.querySelectorAll('video');
          for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            try {
              v.muted = true;
              v.playsInline = true;
              var p = v.play();
              if (p && p.catch) p.catch(function(){});
            } catch (e) {}
            var src = v.currentSrc || v.src || '';
            if (!src) {
              var s = v.querySelector('source[src]');
              if (s) src = s.src || '';
            }
            if (src && src.indexOf('http') === 0 && src.indexOf('blob:') !== 0) {
              result.videoUrl = src;
              break;
            }
          }
          var href = (window.location && window.location.href ? window.location.href : '').toLowerCase();
          var bodyTxt = (document.body && document.body.innerText ? document.body.innerText.slice(0, 1200) : '').toLowerCase();
          var hasVideoNode = videos.length > 0 || !!result.videoUrl;
          var isLoginPath =
            href.indexOf('/accounts/login') !== -1 ||
            href.indexOf('/login.php') !== -1 ||
            href.indexOf('/checkpoint/') !== -1 ||
            href.indexOf('/challenge/') !== -1 ||
            href.indexOf('i/flow/login') !== -1;
          var hasLoginCopy =
            bodyTxt.indexOf('log in to instagram') !== -1 ||
            bodyTxt.indexOf('inicia sesión en instagram') !== -1 ||
            bodyTxt.indexOf('inicia sesión para continuar') !== -1 ||
            bodyTxt.indexOf('log in to continue') !== -1 ||
            bodyTxt.indexOf('log into facebook') !== -1 ||
            bodyTxt.indexOf('inicia sesión en facebook') !== -1 ||
            bodyTxt.indexOf('you must log in') !== -1 ||
            bodyTxt.indexOf('debes iniciar sesión') !== -1 ||
            bodyTxt.indexOf('esta cuenta es privada') !== -1 ||
            bodyTxt.indexOf('this account is private') !== -1 ||
            bodyTxt.indexOf("this content isn't available") !== -1 ||
            bodyTxt.indexOf('este contenido no está disponible') !== -1 ||
            bodyTxt.indexOf("sorry, this page isn't available") !== -1;

          if (isLoginPath || (!hasVideoNode && hasLoginCopy)) {
            result.loginWall = true;
            result.reason = isLoginPath ? 'login_redirect' : 'login_wall_text';
          }
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: String(err) });
        }
      })();
    """.trimIndent()

    fun runDomProbe(view: WebView) {
      if (completed.get()) return
      try {
        view.evaluateJavascript(probeJs) { rawJson ->
          if (rawJson.isNullOrBlank() || rawJson == "null") return@evaluateJavascript
          try {
            val decoded = decodeEvaluateJsString(rawJson)
            val obj = JSONObject(decoded)
            val title = obj.optString("title").trim()
            if (title.isNotEmpty() && capturedTitle.get().isNullOrBlank()) {
              capturedTitle.set(title)
            }
            val img = obj.optString("image").trim()
            if (img.startsWith("http") && capturedThumb.get().isNullOrBlank()) {
              capturedThumb.set(img)
            }
            val domVideo = obj.optString("videoUrl").trim()
            if (domVideo.startsWith("http") && !isIgnoredResource(domVideo)) {
              val headers = buildHeadersWithCookies(domVideo, pageUrl, emptyMap())
              Log.i(TAG, "[layer=webview-sniffer] Video detectado en DOM ($platform): ${domVideo.take(120)}")
              recordCandidate(domVideo, priority = 3, headers = headers)
            }
            if (obj.optBoolean("loginWall", false)) {
              loginWallDetected.set(true)
              if (capturedStream.get() == null) {
                val reason = obj.optString("reason", "login_wall")
                Log.w(TAG, "[layer=webview-sniffer] Muro de login detectado ($platform, $reason). Abortando rápido.")
                scheduleTask(250L) {
                  if (capturedStream.get() == null) {
                    finishEarly()
                  }
                }
              }
            }
          } catch (_: Exception) { }
        }
      } catch (_: Exception) { }
    }

    mainHandler.post {
      try {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)

        val webView = WebView(context.applicationContext)
        webViewRef.set(webView)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          mediaPlaybackRequiresUserGesture = false
          mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
          loadsImagesAutomatically = false
          blockNetworkImage = true
          userAgentString = MOBILE_CHROME_UA
          cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webViewClient = object : WebViewClient() {
          override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
          ): WebResourceResponse? {
            if (completed.get() || request == null) return null
            val reqUrl = request.url?.toString() ?: return null
            val reqHeaders = request.requestHeaders ?: emptyMap()
            val priority = scoreCandidateMediaUrl(reqUrl, platform, reqHeaders)
            if (priority > 0) {
              val mergedHeaders = buildHeadersWithCookies(reqUrl, pageUrl, reqHeaders)
              Log.i(
                TAG,
                "[layer=webview-sniffer] Stream interceptado (p=$priority, platform=$platform): ${reqUrl.take(120)}"
              )
              recordCandidate(reqUrl, priority, mergedHeaders)
            }
            return null
          }

          override fun onPageFinished(view: WebView?, url: String?) {
            if (view == null || completed.get()) return
            val lowerFinal = (url ?: "").lowercase(Locale.US)
            if (
              capturedStream.get() == null &&
              (lowerFinal.contains("/accounts/login") ||
                lowerFinal.contains("/login.php") ||
                lowerFinal.contains("/checkpoint/"))
            ) {
              loginWallDetected.set(true)
              Log.w(TAG, "[layer=webview-sniffer] Redirección directa a login ($platform): ${lowerFinal.take(100)}")
              scheduleTask(300L) {
                if (capturedStream.get() == null) finishEarly()
              }
              return
            }

            listOf(400L, 1600L, 3400L).forEach { delay ->
              scheduleTask(delay) { runDomProbe(view) }
            }
          }
        }

        webView.loadUrl(pageUrl)
      } catch (e: Exception) {
        Log.e(TAG, "[layer=webview-sniffer] Error iniciando WebView oculto: ${e.message}", e)
        finishEarly()
      }
    }

    return try {
      latch.await(timeoutMs, TimeUnit.MILLISECONDS)
      val finalStream = capturedStream.get()
      val isLoginLocked = finalStream == null && loginWallDetected.get()
      Log.i(
        TAG,
        "[layer=webview-sniffer] Finalizado platform=$platform foundStream=${finalStream != null} loginWall=$isLoginLocked"
      )
      WebViewExtractionResult(
        streamUrl = finalStream,
        headers = capturedHeaders.get(),
        title = capturedTitle.get(),
        thumbnail = capturedThumb.get(),
        requiresLogin = isLoginLocked,
        errorDetail = if (finalStream == null) {
          if (isLoginLocked) "La publicación requiere inicio de sesión o es privada."
          else "No se detectó ningún flujo multimedia público."
        } else null
      )
    } catch (e: Exception) {
      WebViewExtractionResult(errorDetail = e.message)
    } finally {
      completed.set(true)
      val cleanupLatch = CountDownLatch(1)
      mainHandler.post {
        try {
          synchronized(scheduledRunnables) {
            scheduledRunnables.forEach { mainHandler.removeCallbacks(it) }
            scheduledRunnables.clear()
          }
          webViewRef.getAndSet(null)?.let { wv ->
            wv.stopLoading()
            wv.loadUrl("about:blank")
            wv.clearHistory()
            wv.removeAllViews()
            wv.destroy()
          }
        } catch (_: Exception) {
        } finally {
          cleanupLatch.countDown()
        }
      }
      try {
        cleanupLatch.await(1500L, TimeUnit.MILLISECONDS)
      } catch (_: Exception) { }
    }
  }

  private fun decodeEvaluateJsString(raw: String): String {
    val trimmed = raw.trim()
    return if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      JSONObject("{\"v\":$trimmed}").optString("v", "")
    } else {
      trimmed
    }
  }

  private fun isIgnoredResource(url: String): Boolean {
    val lower = url.lowercase(Locale.US)
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) return true
    val pathOnly = lower.substringBefore('?')
    if (ignoredExtensions.any { pathOnly.endsWith(it) }) return true
    if (ignoredPathKeywords.any { lower.contains(it) }) return true
    return false
  }

  // Puntúa URLs interceptadas:
  // 0 = ignorar (ads/thumbs/estáticos/segmentos corruptos)
  // 1 = candidato byte-range parcial (último recurso)
  // 2 = stream MP4/HLS/DASH genérico
  // 3 = stream óptimo en CDN conocido sin byte-range parcial
  private fun scoreCandidateMediaUrl(
    url: String,
    platform: String,
    requestHeaders: Map<String, String>
  ): Int {
    if (isIgnoredResource(url)) return 0
    val lower = url.lowercase(Locale.US)
    val host = try { (Uri.parse(url).host ?: "").lowercase(Locale.US) } catch (_: Exception) { "" }
    val pathOnly = lower.substringBefore('?')

    // Descarta segmentos individuales HLS/DASH (.ts / .m4s / .cmfv / init segments) para capturar el manifiesto o MP4 completo
    if (pathOnly.endsWith(".ts") || pathOnly.endsWith(".m4s") || pathOnly.endsWith(".cmfv") || pathOnly.endsWith(".cmfa")) {
      return 0
    }

    val isManifest = pathOnly.endsWith(".m3u8") || lower.contains(".m3u8?") ||
      pathOnly.endsWith(".mpd") || lower.contains(".mpd?")
    val acceptHeader = (requestHeaders["Accept"] ?: requestHeaders["accept"] ?: "").lowercase(Locale.US)
    val isVideoAccept = acceptHeader.contains("video/")
    val isMp4 = pathOnly.endsWith(".mp4") || lower.contains(".mp4?") ||
      lower.contains("mime_type=video_mp4") || lower.contains("mime_type=video") ||
      lower.contains("video_mp4")
    val isByteRangeChunk = lower.contains("bytestart=") || lower.contains("byteend=")

    // TikTok sirve flujos progresivos bajo /video/tos/ o /aweme/v1/play
    val isTikTokVideo = (platform == "TikTok" || host.contains("tiktok")) &&
      (lower.contains("/video/tos/") || lower.contains("/aweme/v1/play") || lower.contains("mime_type=video"))

    // Instagram / Facebook sirven video MP4/DASH bajo cdninstagram.com o fbcdn.net
    val isMetaVideo = (host.contains("cdninstagram.com") || host.contains("fbcdn.net")) &&
      (isMp4 || isManifest || lower.contains("/v/t50.") || lower.contains("/v/t2/") || lower.contains("xpv_progressive"))

    // X / Twitter sirve videos en video.twimg.com (.mp4 o .m3u8)
    val isXVideo = host.contains("video.twimg.com") && (isMp4 || isManifest)

    if ((isXVideo || isTikTokVideo || isMetaVideo) && !isByteRangeChunk) {
      return 3
    }
    if ((isMp4 || isManifest) && !isByteRangeChunk) {
      val onKnownCdn = knownVideoCdnHosts.any { host.contains(it) }
      return if (onKnownCdn) 3 else 2
    }
    if (isVideoAccept && knownVideoCdnHosts.any { host.contains(it) } && !isByteRangeChunk) {
      return 2
    }
    // Fragmento byte-range: solo prioridad 1 (reemplazado en cuanto llegue un MP4/manifiesto íntegro)
    if ((isMp4 || isMetaVideo) && isByteRangeChunk) {
      return 1
    }
    return 0
  }

  private fun buildHeadersWithCookies(
    streamUrl: String,
    pageUrl: String,
    requestHeaders: Map<String, String>
  ): Map<String, String> {
    val result = LinkedHashMap<String, String>()
    result["User-Agent"] = requestHeaders["User-Agent"] ?: requestHeaders["user-agent"] ?: MOBILE_CHROME_UA
    val referer = requestHeaders["Referer"] ?: requestHeaders["referer"] ?: pageUrl
    if (referer.startsWith("http")) {
      result["Referer"] = referer
    }
    val origin = requestHeaders["Origin"] ?: requestHeaders["origin"]
    if (!origin.isNullOrBlank()) {
      result["Origin"] = origin
    }
    try {
      val cm = CookieManager.getInstance()
      val streamCookie = cm.getCookie(streamUrl)
      val pageCookie = cm.getCookie(pageUrl)
      val mergedCookies = mergeCookieStrings(pageCookie, streamCookie)
      if (!mergedCookies.isNullOrBlank()) {
        result["Cookie"] = mergedCookies
      }
    } catch (_: Exception) { }
    return result
  }

  private fun mergeCookieStrings(first: String?, second: String?): String? {
    val map = LinkedHashMap<String, String>()
    listOf(first, second).forEach { raw ->
      if (raw.isNullOrBlank()) return@forEach
      raw.split(';').forEach { pair ->
        val trimmed = pair.trim()
        val eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          val k = trimmed.substring(0, eqIdx).trim()
          val v = trimmed.substring(eqIdx + 1).trim()
          if (k.isNotEmpty()) map[k] = v
        }
      }
    }
    if (map.isEmpty()) return null
    return map.entries.joinToString("; ") { "${it.key}=${it.value}" }
  }
}
