package io.jarida.pondpresence

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * Holds this app's process at foreground priority so the notification stream to the Pond keeps
 * running after the user leaves the app.
 *
 * The stream itself is JavaScript (`services/notification-stream.ts`), owned by
 * `services/background-connection.ts`, and it runs in the same process as this service. The
 * service does no networking of its own: what it buys is that Android treats the process as
 * user-visible work instead of a cached app it may freeze or reclaim. When Android stops it
 * anyway -- the user force-stops the app, the system is short of memory, Doze still defers the
 * socket -- the Pond's push wake-up (`services/notification-wake.ts`) delivers instead.
 *
 * The type is remoteMessaging: the connection exists to receive messages the Pond sends to this
 * phone. dataSync would also be accepted today, but from Android 15 it is capped at six hours in
 * any 24, which is the wrong shape for a connection meant to stay open.
 *
 * Every user-visible string comes from JavaScript, so it is translated with the rest of the app.
 * JavaScript also decides what the notice says: whether the stream is connecting, connected,
 * or cannot reach the Pond (`presenceNotice` in `services/background-connection.ts`), and
 * re-posts it through [PondPresenceModule.update] as that changes.
 */
class PondPresenceService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(this, Texts.from(intent))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    running = true
    // Not sticky: a service recreated by the system after the process died has no JavaScript
    // stream behind it, and its notification would claim a connection that does not exist.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /** What the ongoing notification and its channel say, handed over from JavaScript. */
  data class Texts(val title: String, val body: String, val channelName: String, val channelDescription: String) {
    fun into(intent: Intent): Intent = intent
      .putExtra(EXTRA_TITLE, title)
      .putExtra(EXTRA_BODY, body)
      .putExtra(EXTRA_CHANNEL_NAME, channelName)
      .putExtra(EXTRA_CHANNEL_DESCRIPTION, channelDescription)

    companion object {
      fun from(intent: Intent?) = Texts(
        intent?.getStringExtra(EXTRA_TITLE).orEmpty(),
        intent?.getStringExtra(EXTRA_BODY).orEmpty(),
        intent?.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty(),
        intent?.getStringExtra(EXTRA_CHANNEL_DESCRIPTION).orEmpty(),
      )
    }
  }

  companion object {
    private const val CHANNEL = "pond-background-connection"
    private const val NOTIFICATION_ID = 0x9006
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_CHANNEL_NAME = "channelName"
    private const val EXTRA_CHANNEL_DESCRIPTION = "channelDescription"
    private const val NOTIFICATION_ICON = "notification_icon"

    /**
     * Whether the service holds the foreground, so [update] never posts an ongoing notice with
     * no service behind it. Written on the main thread, read from the bridge's.
     */
    @Volatile private var running = false

    /**
     * Re-post the running service's notification with new text: a notify on the same id,
     * which Android documents as the way to change a foreground service's notification. A
     * second startForegroundService would do it too, but Android 12 and later refuse that from
     * the background, which is where the connection mostly changes. Returns false, posting
     * nothing, when the service is not running.
     */
    fun update(context: Context, texts: Texts): Boolean {
      if (!running) return false
      context.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(context, texts))
      return true
    }

    /**
     * The silhouette expo-notifications installs from app.json's `icon` (prebuild writes it as
     * `drawable/notification_icon`), so this ongoing notice wears the same status-bar icon as
     * every other one. Looked up by name because a build without that config has no such
     * resource; the launcher icon is the fallback, which Android draws as a white blob.
     */
    @SuppressLint("DiscouragedApi") // A name lookup is the point: see above.
    private fun smallIcon(context: Context): Int {
      val installed = context.resources.getIdentifier(NOTIFICATION_ICON, "drawable", context.packageName)
      return if (installed != 0) installed else context.applicationInfo.icon
    }

    /**
     * The brand colour expo-notifications writes beside that icon (`color/notification_icon_color`,
     * from app.json's `color`), or null where the build has none, which leaves the system tint.
     */
    @SuppressLint("DiscouragedApi")
    private fun accent(context: Context): Int? {
      val id = context.resources.getIdentifier("notification_icon_color", "color", context.packageName)
      return if (id != 0) context.getColor(id) else null
    }

    private fun build(context: Context, texts: Texts): Notification {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        // Low importance: a status line, not an interruption. Recreated on every start so a
        // change of language reaches the channel's name in system settings.
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL, texts.channelName, NotificationManager.IMPORTANCE_LOW).apply {
            description = texts.channelDescription
            setShowBadge(false)
          }
        )
      }
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val pending = open?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
                    else @Suppress("DEPRECATION") Notification.Builder(context)
      return builder
        .setContentTitle(texts.title)
        .setContentText(texts.body)
        .setSmallIcon(smallIcon(context))
        .also { notice -> accent(context)?.let(notice::setColor) }
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .also { if (pending != null) it.setContentIntent(pending) }
        .build()
    }
  }
}

/** Starts and stops [PondPresenceService] for `services/background-connection.ts`. */
class PondPresenceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PondPresence"

  /**
   * Start the service, or refresh its notification when it is already running.
   *
   * Rejects rather than swallowing a refusal. Android 12 and later refuse to start a foreground
   * service while the app is in the background, and the caller logs that and leaves delivery to
   * the push wake-up; a refusal it never heard about would leave the setting reading "on" with
   * nothing behind it.
   */
  @ReactMethod
  fun start(title: String, body: String, channelName: String, channelDescription: String, promise: Promise) {
    val intent = PondPresenceService.Texts(title, body, channelName, channelDescription)
      .into(Intent(context, PondPresenceService::class.java))
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_PRESENCE_START", error.javaClass.simpleName, error)
    }
  }

  /**
   * Change what the running service's notification says, as the connection to the Pond comes
   * and goes. Resolves false when the service is not running; JavaScript logs that.
   */
  @ReactMethod
  fun update(title: String, body: String, channelName: String, channelDescription: String, promise: Promise) {
    try {
      promise.resolve(PondPresenceService.update(context, PondPresenceService.Texts(title, body, channelName, channelDescription)))
    } catch (error: Exception) {
      promise.reject("E_PRESENCE_UPDATE", error.javaClass.simpleName, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      context.stopService(Intent(context, PondPresenceService::class.java))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_PRESENCE_STOP", error.javaClass.simpleName, error)
    }
  }
}

class PondPresencePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(PondPresenceModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
