package io.jarida.pondtls

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

/**
 * Keeps the embedded node's network access while the app is backgrounded.
 *
 * The name is the important part, because the obvious reading is wrong. This does not keep
 * the node's *process* alive: the process was never the thing dying. Observed on a Galaxy
 * A57 on 2026-09-22, the app was backgrounded, the coordinator marked the node offline
 * within forty-five seconds, and the process kept running and logging under the same pid
 * throughout -- then recovered by itself once the device became active again. What Doze
 * withdraws is network access, and a foreground service is the supported way to keep it.
 *
 * That distinction decides whether this file is worth having at all. A service that merely
 * held a process up would address nothing here.
 *
 * The notification is not a formality to satisfy the platform. It is the only outward sign
 * that the app is holding a connection open on the user's behalf, so it says what the
 * connection is actually doing and opens the app when tapped. A permanent notification
 * that reads "Goose is running" would be a cost with no return. What it says comes from
 * [RemoteNotice]: connecting, connected only once the Pond has answered, or unable to reach
 * it, and [refresh] keeps it current as requests to the Pond succeed and fail.
 */
class PondNetworkService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    nodeState = intent?.getStringExtra(EXTRA_STATE) ?: STATE_CONNECTING
    // Set before the notice is built, so an answer recorded meanwhile reaches it through
    // [refresh] rather than falling between the two.
    running = this
    val notification = synchronized(Companion) {
      val notice = current()
      shown = notice
      build(this, notice)
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: IllegalStateException) {
      // ForegroundServiceStartNotAllowedException (API 31) is an IllegalStateException. It is
      // raised here, on the main thread, not where the service was started: on 2026-10-22 the
      // A57 crashed three times inside this call, once with "Time limit already exhausted for
      // foreground service type dataSync" and twice with "Service.startForeground() not
      // allowed" after the app had left the foreground. The try in [start] cannot see either.
      refuse(REFUSED_START, error)
      return START_NOT_STICKY
    } catch (error: SecurityException) {
      // Android 14 raises this when the type's prerequisite permission is missing.
      refuse(REFUSED_START, error)
      return START_NOT_STICKY
    }
    refusal = null
    }
    refusal = null
    // The node is restarted by PondNetwork, not by the system: a service recreated without
    // its node would show a notification claiming a connection that does not exist.
    return START_NOT_STICKY
  }

  /**
   * Android 15 calls this when a time-limited foreground service type has used its allowance.
   *
   * connectedDevice has no such limit today, so this should never run. It is here because the
   * alternative is fatal: a service still running a few seconds after this call is torn down
   * with ForegroundServiceDidNotStopInTimeException, which is how the dataSync version of this
   * service crashed the app in the background twice on 2026-10-22, six hours into a day of
   * remote access. Stopping is the only answer the platform accepts.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    android.util.Log.w("PondNetwork", "kind=foreground_service_timeout type=$fgsType: stopping; remote access pauses while the app is in the background")
    refusal = REFUSED_TIMEOUT
    stopSelf()
  }

  /**
   * Leave the foreground without crashing, and say so where the app can read it.
   *
   * The node keeps running: it lives in the app process, not in this service, so remote access
   * still works while the app is open. What is lost is network access once the app is in the
   * background, which is what [refusal] reports through `PondNetwork.status()`.
   */
  private fun refuse(reason: String, error: Exception) {
    android.util.Log.w("PondNetwork", "kind=foreground_service_refused reason=$reason error=${error.javaClass.simpleName}: ${error.message}")
    refusal = reason
    stopSelf()
  }

  override fun onDestroy() {
    running = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "pond-remote-access"
    private const val NOTIFICATION_ID = 0x9005
    private const val EXTRA_STATE = "state"

    const val STATE_RUNNING = "Running"
    const val STATE_CONNECTING = "Connecting"

    private const val REFUSED_START = "start_refused"
    private const val REFUSED_TIMEOUT = "timeout"

    /**
     * Why the platform last refused to keep this service in the foreground, or null while it
     * holds the foreground (or has not been asked to). Written on the main thread by the
     * service and read by `PondNetwork` on its own executor.
     */
    @Volatile var refusal: String? = null
      private set

    /** The service while it holds the foreground, so [refresh] never posts a notice without it. */
    @Volatile private var running: PondNetworkService? = null

    /** The node state [PondNetwork] last handed over. */
    @Volatile private var nodeState = STATE_CONNECTING

    /** What the notification says now, so an unchanged notice is not re-posted. */
    private var shown: RemoteNotice? = null

    private fun current() = RemoteNotice.of(nodeState == STATE_RUNNING, PondNetwork.answers())

    /**
     * Re-post the notification if what it should say has changed: whether the Pond answers
     * moves with every request, which is far more often than the node's state.
     *
     * A notify on the service's own id, which Android documents as the way to change a
     * foreground service's notification, rather than another [start]: most of these changes
     * happen with the app in the background, where Android 12 and later refuse a start. The
     * channel is low importance and the notice alerts only once, so an update never sounds.
     * Does nothing while the service is not running.
     */
    fun refresh() {
      val service = running ?: return
      val notice = synchronized(this) {
        val next = current()
        if (next == shown) return
        shown = next
        next
      }
      service.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(service, notice))
      android.util.Log.i("PondNetwork", "kind=remote_notice state=${notice.name}")
    }

    /**
     * Start or update the service.
     *
     * Deliberately swallows a refusal. Android 12 forbids starting a foreground service
     * from the background, and while remote access is always enabled from the screen --
     * so the app is foreground at that moment -- a restart triggered by a network change
     * need not be. Losing the service costs background survival; letting the exception out
     * would take the node down with it, which is strictly worse than the problem.
     *
     * A refusal can also arrive later, from `startForeground` inside [onStartCommand]; that
     * one is handled there. Both are recorded in [refusal].
     */
    fun start(context: Context, state: String) {
      val intent = Intent(context, PondNetworkService::class.java).putExtra(EXTRA_STATE, state)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (error: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException on API 31+, and the background-start
        // IllegalStateException that startService raises on older releases.
        android.util.Log.w("PondNetwork", "kind=foreground_service_refused reason=$REFUSED_START error=${error.javaClass.simpleName}: ${error.message}")
        refusal = REFUSED_START
      } catch (error: SecurityException) {
        android.util.Log.w("PondNetwork", "kind=foreground_service_refused reason=$REFUSED_START error=${error.javaClass.simpleName}: ${error.message}")
        refusal = REFUSED_START
      }
    }

    fun stop(context: Context) {
      // No node, so nothing is waiting on the background exemption.
      refusal = null
      try {
        context.stopService(Intent(context, PondNetworkService::class.java))
      } catch (error: Exception) {
        android.util.Log.i("PondNetwork", "foreground service stop failed: ${error.javaClass.simpleName}")
      }
    }

    /**
     * The status-bar silhouette expo-notifications installs from app.json's `icon` (prebuild
     * writes it as `drawable/notification_icon`), so this notice wears the same icon as every
     * other one the app posts. It used to pass the launcher icon, which Android flattens to a
     * faint white blob, so the status bar switched between that and the bold icon as this
     * notification and the others came and went.
     *
     * Looked up by name, because a build without that config has no such resource; the
     * launcher icon is then the fallback, as in `PondPresence`.
     */
    @SuppressLint("DiscouragedApi") // A name lookup is the point: see above.
    private fun smallIcon(context: Context): Int {
      val installed = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
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

    private fun build(context: Context, notice: RemoteNotice): Notification {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
        // Low importance: this is a status line, not an interruption. It cannot be
        // dismissed while the service runs, so it must not also make a sound.
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL, "Remote access", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while your phone is holding a connection to your Pond."
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
        .setContentTitle(notice.title)
        .setContentText(notice.body)
        .setSmallIcon(smallIcon(context))
        .also { accent(context)?.let(it::setColor) }
        // Not marked ongoing, so nothing here asks the platform to pin it.
        //
        // That is as far as an app can go. NotificationManagerService owns the flags on a
        // foreground-service notification: it sets FOREGROUND_SERVICE and NO_CLEAR itself
        // and drops AUTO_CANCEL, so setAutoCancel(true) is silently discarded -- confirmed
        // on Android 16, where the posted notification came back
        // ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE with no AUTO_CANCEL. Tapping it
        // cannot clear it.
        //
        // From Android 13 the user can still swipe it away, because System UI allows that
        // for foreground-service notifications despite NO_CLEAR. The service keeps running
        // when they do: remote access depends on the service holding the app out of Doze's
        // network restrictions, not on the notification being on screen.
        //
        // Clearing it on tap would mean calling stopForeground, which surrenders exactly
        // the exemption this service exists to hold. The notification is the price of the
        // feature, and the honest thing is to say so rather than fake a dismissal.
        .setOnlyAlertOnce(true)
        .also { if (pending != null) it.setContentIntent(pending) }
        .build()
    }
  }
}
