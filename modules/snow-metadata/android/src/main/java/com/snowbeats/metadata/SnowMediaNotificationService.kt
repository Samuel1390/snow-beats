package com.snowbeats.metadata

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.io.File

// Servicio en primer plano que gestiona el control flotante clásico en la barra de notificaciones
class SnowMediaNotificationService : Service() {

  companion object {
    const val CHANNEL_ID = "snow_beats_media_playback"
    const val NOTIFICATION_ID = 4102

    const val ACTION_UPDATE = "com.snowbeats.action.UPDATE"
    const val ACTION_DISMISS = "com.snowbeats.action.DISMISS"
    const val ACTION_TOGGLE = "com.snowbeats.action.TOGGLE"
    const val ACTION_PREV = "com.snowbeats.action.PREV"
    const val ACTION_NEXT = "com.snowbeats.action.NEXT"
    const val ACTION_FAVORITE = "com.snowbeats.action.FAVORITE"
    const val ACTION_CLOSE = "com.snowbeats.action.CLOSE"

    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_ARTIST = "extra_artist"
    const val EXTRA_ALBUM = "extra_album"
    const val EXTRA_ARTWORK = "extra_artwork"
    const val EXTRA_IS_PLAYING = "extra_is_playing"
    const val EXTRA_IS_FAVORITE = "extra_is_favorite"
    const val EXTRA_POSITION_MS = "extra_position_ms"
    const val EXTRA_DURATION_MS = "extra_duration_ms"
    const val EXTRA_SPEED = "extra_speed"

    @Volatile
    var actionListener: ((String, Double?) -> Unit)? = null

    fun dispatchAction(action: String, positionSec: Double? = null) {
      actionListener?.invoke(action, positionSec)
    }
  }

  private var mediaSession: MediaSessionCompat? = null
  private var lastArtworkUri: String? = null
  private var cachedArtwork: Bitmap? = null

  private var currentTitle: String = "Snow Beats"
  private var currentArtist: String = ""
  private var currentAlbum: String = ""
  private var currentIsPlaying: Boolean = false
  private var currentIsFavorite: Boolean = false
  private var currentPositionMs: Long = 0L
  private var currentDurationMs: Long = 0L
  private var currentSpeed: Float = 1.0f

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    setupMediaSession()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Reproducción de Snow Beats",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Controles multimedia de Snow Beats en la barra de notificaciones"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }
  }

  private fun setupMediaSession() {
    val session = MediaSessionCompat(this, "SnowBeatsMediaSession")
    session.setCallback(object : MediaSessionCompat.Callback() {
      override fun onPlay() {
        dispatchAction("play")
      }

      override fun onPause() {
        dispatchAction("pause")
      }

      override fun onSkipToNext() {
        dispatchAction("next")
      }

      override fun onSkipToPrevious() {
        dispatchAction("previous")
      }

      override fun onSeekTo(pos: Long) {
        dispatchAction("seek", pos / 1000.0)
      }

      override fun onStop() {
        dispatchAction("close")
        dismissSelf()
      }

      override fun onCustomAction(action: String?, extras: android.os.Bundle?) {
        when (action) {
          ACTION_FAVORITE -> dispatchAction("favorite")
          ACTION_CLOSE -> {
            dispatchAction("close")
            dismissSelf()
          }
        }
      }
    })
    session.isActive = true
    mediaSession = session
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action ?: return START_NOT_STICKY

    when (action) {
      ACTION_UPDATE -> {
        currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: "Snow Beats"
        currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: ""
        currentAlbum = intent.getStringExtra(EXTRA_ALBUM) ?: ""
        currentIsPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false)
        currentIsFavorite = intent.getBooleanExtra(EXTRA_IS_FAVORITE, false)
        currentPositionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L)
        currentDurationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
        currentSpeed = intent.getFloatExtra(EXTRA_SPEED, 1.0f)

        val artworkUri = intent.getStringExtra(EXTRA_ARTWORK)
        if (artworkUri != lastArtworkUri) {
          lastArtworkUri = artworkUri
          cachedArtwork = loadArtworkBitmap(artworkUri)
        }

        updateSessionMetadataAndState()
        val notification = buildNotification()
        publishNotification(notification)
      }

      ACTION_TOGGLE -> dispatchAction("toggle")
      ACTION_PREV -> dispatchAction("previous")
      ACTION_NEXT -> dispatchAction("next")
      ACTION_FAVORITE -> dispatchAction("favorite")
      ACTION_CLOSE -> {
        currentIsPlaying = false
        dispatchAction("close")
        dismissSelf()
      }

      ACTION_DISMISS -> {
        currentIsPlaying = false
        dismissSelf()
      }
    }

    return if (currentIsPlaying) START_STICKY else START_NOT_STICKY
  }

  private fun updateSessionMetadataAndState() {
    val session = mediaSession ?: return

    val metaBuilder = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)

    cachedArtwork?.let { bmp ->
      metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
      metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bmp)
    }
    session.setMetadata(metaBuilder.build())

    val stateCode = if (currentIsPlaying) {
      PlaybackStateCompat.STATE_PLAYING
    } else {
      PlaybackStateCompat.STATE_PAUSED
    }

    val supportedActions =
      PlaybackStateCompat.ACTION_PLAY or
        PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or
        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
        PlaybackStateCompat.ACTION_SEEK_TO or
        PlaybackStateCompat.ACTION_STOP

    val favIcon = if (currentIsFavorite) R.drawable.ic_snow_heart_filled else R.drawable.ic_snow_heart_outline

    // Acciones personalizadas para Android 13-15 (Corazón a la izquierda y Cerrar X a la derecha)
    val stateBuilder = PlaybackStateCompat.Builder()
      .setActions(supportedActions)
      .setState(
        stateCode,
        currentPositionMs,
        if (currentIsPlaying) currentSpeed else 0f,
        SystemClock.elapsedRealtime()
      )
      .addCustomAction(
        PlaybackStateCompat.CustomAction.Builder(ACTION_FAVORITE, "Favorito", favIcon).build()
      )
      .addCustomAction(
        PlaybackStateCompat.CustomAction.Builder(ACTION_CLOSE, "Cerrar", R.drawable.ic_snow_close).build()
      )

    session.setPlaybackState(stateBuilder.build())
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentPi = PendingIntent.getActivity(
      this,
      100,
      launchIntent ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val favIcon = if (currentIsFavorite) R.drawable.ic_snow_heart_filled else R.drawable.ic_snow_heart_outline
    val playPauseIcon = if (currentIsPlaying) R.drawable.ic_snow_pause else R.drawable.ic_snow_play
    val playPauseLabel = if (currentIsPlaying) "Pausar" else "Reproducir"

    val mediaStyle = MediaStyle()
      .setMediaSession(mediaSession?.sessionToken)
      .setShowActionsInCompactView(1, 2, 3)

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_snow_note)
      .setContentTitle(currentTitle)
      .setContentText(currentArtist)
      .setSubText(if (currentAlbum.isNotBlank()) currentAlbum else null)
      .setContentIntent(contentPi)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(currentIsPlaying)
      .setShowWhen(false)
      .setStyle(mediaStyle)
      // Orden clásico: Corazón | Anterior | Play/Pause | Siguiente | Cerrar
      .addAction(favIcon, "Favorito", serviceActionPendingIntent(ACTION_FAVORITE, 1))
      .addAction(R.drawable.ic_snow_prev, "Anterior", serviceActionPendingIntent(ACTION_PREV, 2))
      .addAction(playPauseIcon, playPauseLabel, serviceActionPendingIntent(ACTION_TOGGLE, 3))
      .addAction(R.drawable.ic_snow_next, "Siguiente", serviceActionPendingIntent(ACTION_NEXT, 4))
      .addAction(R.drawable.ic_snow_close, "Cerrar", serviceActionPendingIntent(ACTION_CLOSE, 5))

    cachedArtwork?.let { builder.setLargeIcon(it) }
    return builder.build()
  }

  private fun publishNotification(notification: Notification) {
    try {
      if (currentIsPlaying) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
          )
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }
      } else {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(STOP_FOREGROUND_DETACH)
        } else {
          @Suppress("DEPRECATION")
          stopForeground(false)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
      }
    } catch (_: Exception) {
      try {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
      } catch (_: Exception) { }
    }
  }

  private fun serviceActionPendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, SnowMediaNotificationService::class.java).apply {
      this.action = action
    }
    return PendingIntent.getService(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun loadArtworkBitmap(uriText: String?): Bitmap? {
    if (!uriText.isNullOrBlank()) {
      try {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        if (uriText.startsWith("file://")) {
          val file = File(Uri.parse(uriText).path ?: "")
          if (file.exists()) {
            BitmapFactory.decodeFile(file.absolutePath, opts)
            opts.inSampleSize = calcSampleSize(opts.outWidth, opts.outHeight, 320)
            opts.inJustDecodeBounds = false
            BitmapFactory.decodeFile(file.absolutePath, opts)?.let { return it }
          }
        } else if (uriText.startsWith("content://")) {
          contentResolver.openInputStream(Uri.parse(uriText))?.use { stream ->
            BitmapFactory.decodeStream(stream)?.let { return it }
          }
        }
      } catch (_: Exception) { }
    }

    // Fallback al icono de Snow Beats cuando la canción no tiene carátula embebida
    return try {
      val drawable = packageManager.getApplicationIcon(packageName)
      val size = 256
      val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val canvas = android.graphics.Canvas(bmp)
      drawable.setBounds(0, 0, size, size)
      drawable.draw(canvas)
      bmp
    } catch (_: Exception) {
      null
    }
  }

  private fun calcSampleSize(width: Int, height: Int, maxDim: Int): Int {
    var sample = 1
    var w = width
    var h = height
    while (w / 2 >= maxDim && h / 2 >= maxDim) {
      w /= 2
      h /= 2
      sample *= 2
    }
    return sample
  }

  private fun dismissSelf() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(NOTIFICATION_ID)
    } catch (_: Exception) { }
    stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // No detenemos el servicio ni la música al quitar la ventana de Recientes o si el sistema cierra la actividad:
    // la reproducción y la notificación deben continuar hasta que el usuario cierre explícitamente desde la notificación
    // o elija otra canción al volver a abrir Snow Beats.
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    try {
      mediaSession?.isActive = false
      mediaSession?.release()
      mediaSession = null
    } catch (_: Exception) { }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
