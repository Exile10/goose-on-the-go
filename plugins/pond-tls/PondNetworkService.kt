package io.jarida.pondtls

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
 * that reads "Goose is running" would be a cost with no return.
 */
class PondNetworkService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val state = intent?.getStringExtra(EXTRA_STATE) ?: STATE_CONNECTING
    val notification = build(this, state)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // The node is restarted by PondNetwork, not by the system: a service recreated without
    // its node would show a notification claiming a connection that does not exist.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "pond-remote-access"
    private const val NOTIFICATION_ID = 0x9005
    private const val EXTRA_STATE = "state"

    const val STATE_RUNNING = "Running"
    const val STATE_CONNECTING = "Connecting"

    /**
     * Start or update the service.
     *
     * Deliberately swallows a refusal. Android 12 forbids starting a foreground service
     * from the background, and while remote access is always enabled from the screen --
     * so the app is foreground at that moment -- a restart triggered by a network change
     * need not be. Losing the service costs background survival; letting the exception out
     * would take the node down with it, which is strictly worse than the problem.
     */
    fun start(context: Context, state: String) {
      val intent = Intent(context, PondNetworkService::class.java).putExtra(EXTRA_STATE, state)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (error: Exception) {
        android.util.Log.i("PondNetwork", "foreground service refused: ${error.javaClass.simpleName}")
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, PondNetworkService::class.java))
      } catch (error: Exception) {
        android.util.Log.i("PondNetwork", "foreground service stop failed: ${error.javaClass.simpleName}")
      }
    }

    private fun build(context: Context, state: String): Notification {
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
      val connected = state == STATE_RUNNING
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
                    else @Suppress("DEPRECATION") Notification.Builder(context)
      return builder
        .setContentTitle(if (connected) "Connected to your Pond" else "Reconnecting to your Pond")
        .setContentText(
          if (connected) "Remote access is on, so you can reach your Pond from anywhere."
          else "Remote access is on. Looking for your Pond."
        )
        .setSmallIcon(context.applicationInfo.icon)
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
