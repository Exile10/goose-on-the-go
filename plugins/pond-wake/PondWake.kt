package io.jarida.pondwake

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ViewManager
import io.jarida.pondassist.GooseInteractionService

private const val TAG = "PondWake"

/**
 * The Pond's own "hey goose" detector (`native/pondear`, built from the Pond's `pond-ear` crate),
 * loaded once. [loaded] is false where the library is missing for this CPU, which the settings row
 * reports rather than offering a switch that cannot work.
 */
object PondEar {
  val loaded: Boolean = try {
    System.loadLibrary("pondear")
    true
  } catch (error: UnsatisfiedLinkError) {
    Log.w(TAG, "kind=wake_library_missing abi=${Build.SUPPORTED_ABIS.firstOrNull()} error=${error.message}")
    false
  }

  @JvmStatic external fun nativeOpen(): Long
  @JvmStatic external fun nativeRung(): String
  @JvmStatic external fun nativePush(handle: Long, pcm: ShortArray, count: Int): Float
  @JvmStatic external fun nativeClose(handle: Long)
}

/**
 * Listens for "Hey Goose" and opens the assistant's voice orb, as holding the side key does.
 *
 * Android gives a third-party assistant no hotword path (docs/ASSISTANT.md), so this is the app's
 * own foreground service, of type microphone, with a notification that says it is listening and
 * stops it. It listens only while it could do something useful and nothing else is better placed:
 *
 * - the screen is on and the phone unlocked: the overlay does not open over the lock screen;
 * - no screen of this app is in front: the app has its own voice mode, and the overlay records
 *   with its own microphone, so the service lets go of the microphone while either is showing.
 *
 * Audio never leaves the phone and is never written anywhere: each 80 ms is scored by the detector
 * and dropped, except the last 20 seconds the detector keeps in memory to find the phrase.
 *
 * Starting it needs the app in front (Android 14 refuses a microphone foreground service started
 * from the background), so it is started from the settings switch and resumed each time the app
 * opens; it is not restarted by the system or after a reboot.
 */
class GooseWakeService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var listener: Thread? = null
  @Volatile private var running = false
  private var appScreens = 0

  private val screenEvents = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      update("screen ${intent.action?.substringAfterLast('.')}")
    }
  }

  private val screens = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
      appScreens += 1
      update("app screen shown")
    }

    override fun onActivityStopped(activity: Activity) {
      appScreens = (appScreens - 1).coerceAtLeast(0)
      update("app screen hidden")
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    // The service is started from a screen of the app, which is therefore in front already and
    // was started before the callbacks below could count it.
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    appScreens = if (state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) 1 else 0
    application.registerActivityLifecycleCallbacks(screens)
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    registerReceiver(screenEvents, filter)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      Log.i(TAG, "kind=wake_stopped by=notification")
      prefs(this).edit().putBoolean(KEY_ON, false).apply()
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION_ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification(this))
      }
    } catch (error: IllegalStateException) {
      // ForegroundServiceStartNotAllowedException (API 31) is an IllegalStateException, raised
      // here when the app had left the front before the service started.
      return refuse(REFUSED_START, error)
    } catch (error: SecurityException) {
      // Android 14 raises this when the microphone permission is missing.
      return refuse(REFUSED_START, error)
    }
    refusal = null
    active = true
    update("started")
    return START_NOT_STICKY
  }

  private fun refuse(reason: String, error: Exception): Int {
    Log.w(TAG, "kind=wake_refused reason=$reason error=${error.javaClass.simpleName}: ${error.message}")
    refusal = reason
    stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    active = false
    main.removeCallbacksAndMessages(null)
    application.unregisterActivityLifecycleCallbacks(screens)
    unregisterReceiver(screenEvents)
    stopListening("service stopped")
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /** Whether listening could open the overlay now (see the class comment). */
  private fun shouldListen(): Boolean {
    val interactive = getSystemService(PowerManager::class.java).isInteractive
    val unlocked = !getSystemService(KeyguardManager::class.java).isKeyguardLocked
    return active && interactive && unlocked && appScreens == 0
  }

  /** Main thread: start or stop the microphone to match [shouldListen]. */
  private fun update(why: String) {
    if (shouldListen()) startListening(why) else stopListening(why)
  }

  private fun startListening(why: String) {
    if (listener != null) return
    running = true
    lateinit var thread: Thread
    thread = Thread({ ended(thread, listen()) }, "goose-wake")
    listener = thread
    thread.start()
    Log.i(TAG, "kind=wake_listening state=on why=$why")
  }

  /** Main thread, from a listening thread that ended by itself: what to do about how it ended. */
  private fun ended(thread: Thread, end: End) {
    main.post {
      if (listener !== thread) return@post
      listener = null
      when (end) {
        End.HEARD -> heard()
        // A call or another app holding the microphone: try again shortly, if still wanted.
        End.MICROPHONE -> main.postDelayed({ update("retry after the microphone was unavailable") }, RETRY_MS)
        End.REFUSED -> stopSelf()
        End.STOPPED -> Unit
      }
    }
  }

  /** How a listening thread ended. */
  private enum class End { HEARD, MICROPHONE, REFUSED, STOPPED }

  private fun stopListening(why: String) {
    val thread = listener ?: return
    running = false
    listener = null
    thread.join(JOIN_MS)
    Log.i(TAG, "kind=wake_listening state=off why=$why")
  }

  /** The listening thread: 80 ms at a time into the detector until [running] is cleared. */
  @SuppressLint("MissingPermission") // Checked first; the service is not started without it.
  private fun listen(): End {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      Log.w(TAG, "kind=wake_refused reason=$REFUSED_MICROPHONE")
      refusal = REFUSED_MICROPHONE
      return End.REFUSED
    }
    val detector = PondEar.nativeOpen()
    if (detector == 0L) {
      Log.e(TAG, "kind=wake_refused reason=$REFUSED_MODEL: the embedded model did not convert")
      refusal = REFUSED_MODEL
      return End.REFUSED
    }
    val minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minimum, HOP * 2 * 4),
    )
    try {
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        Log.w(TAG, "kind=wake_microphone_unavailable state=${record.state}")
        return End.MICROPHONE
      }
      record.startRecording()
      Log.i(TAG, "kind=wake_detector rung=${PondEar.nativeRung()}")
      val chunk = ShortArray(HOP)
      while (running) {
        val read = record.read(chunk, 0, HOP)
        if (read < 0) {
          Log.w(TAG, "kind=wake_microphone_unavailable read=$read")
          return End.MICROPHONE
        }
        val p = PondEar.nativePush(detector, chunk, read)
        if (p >= 0f) {
          Log.i(TAG, "kind=wake_heard p=$p")
          return End.HEARD
        }
      }
      return End.STOPPED
    } finally {
      record.release()
      PondEar.nativeClose(detector)
    }
  }

  /**
   * Main thread, once the thread that heard it has let go of the microphone: open the overlay
   * through the assistant. The overlay counts as an app screen while it shows, so listening
   * resumes when it closes; the check after [OVERLAY_MS] resumes it if the overlay never came.
   */
  private fun heard() {
    if (GooseInteractionService.showOverlay()) {
      main.postDelayed({ update("after the overlay was asked for") }, OVERLAY_MS)
      return
    }
    Log.w(TAG, "kind=wake_refused reason=$REFUSED_NOT_ASSISTANT: Goose is not the phone's assistant now")
    refusal = REFUSED_NOT_ASSISTANT
    prefs(this).edit().putBoolean(KEY_ON, false).apply()
    stopSelf()
  }

  companion object {
    private const val CHANNEL = "goose-wake"
    private const val NOTIFICATION_ID = 0x9006
    private const val ACTION_STOP = "io.jarida.pondwake.STOP"
    private const val PREFS = "io.jarida.pondwake"
    private const val KEY_ON = "on"
    private const val KEY_TITLE = "title"
    private const val KEY_BODY = "body"
    private const val KEY_STOP = "stop"
    private const val KEY_CHANNEL = "channel"
    private const val RATE = 16_000
    /** 80 ms: the detector scores a window every 8 frames of 10 ms. */
    private const val HOP = 1_280
    private const val JOIN_MS = 500L
    private const val RETRY_MS = 5_000L
    private const val OVERLAY_MS = 3_000L

    const val REFUSED_START = "start_refused"
    const val REFUSED_MICROPHONE = "no_microphone"
    const val REFUSED_MODEL = "model_failed"
    const val REFUSED_NOT_ASSISTANT = "not_assistant"

    /** Whether the service holds the foreground now. */
    @Volatile var active = false
      private set

    /** Why the service last stopped without being asked to, or null. Read by the settings row. */
    @Volatile var refusal: String? = null
      private set

    fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether the person has turned listening on; kept across restarts of the app. */
    fun chosen(context: Context) = prefs(context).getBoolean(KEY_ON, false)

    /**
     * Turn listening on with the notification's words, which come from the app's translations,
     * or off. On starts the service and reports whether Android accepted the start.
     */
    fun choose(context: Context, on: Boolean, words: Map<String, String>?): Boolean {
      val edit = prefs(context).edit().putBoolean(KEY_ON, on)
      words?.forEach { (key, value) -> edit.putString(key, value) }
      edit.apply()
      // A new choice answers the last refusal, whichever way it goes.
      refusal = null
      return if (on) start(context) else {
        context.stopService(Intent(context, GooseWakeService::class.java))
        true
      }
    }

    /** Start the service if listening is chosen and it is not running. Android 8 or later. */
    fun start(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      if (!chosen(context) || active) return active
      return try {
        context.startForegroundService(Intent(context, GooseWakeService::class.java))
        true
      } catch (error: IllegalStateException) {
        Log.w(TAG, "kind=wake_refused reason=$REFUSED_START error=${error.javaClass.simpleName}: ${error.message}")
        refusal = REFUSED_START
        false
      } catch (error: SecurityException) {
        Log.w(TAG, "kind=wake_refused reason=$REFUSED_START error=${error.javaClass.simpleName}: ${error.message}")
        refusal = REFUSED_START
        false
      }
    }

    @SuppressLint("DiscouragedApi") // As PondNetworkService: the icon expo-notifications installs.
    private fun smallIcon(context: Context): Int {
      val installed = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      return if (installed != 0) installed else context.applicationInfo.icon
    }

    /** Android 8 or later, as [start] is the only way the service runs. */
    @SuppressLint("NewApi")
    private fun notification(context: Context): Notification {
      val words = prefs(context)
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL) == null) {
        // Low importance: a status line that must not sound, shown for as long as it listens.
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL, words.getString(KEY_CHANNEL, null) ?: "Hey Goose", NotificationManager.IMPORTANCE_LOW)
            .apply { setShowBadge(false) },
        )
      }
      val stop = PendingIntent.getService(
        context,
        0,
        Intent(context, GooseWakeService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE,
      )
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
      }
      return Notification.Builder(context, CHANNEL)
        .setSmallIcon(smallIcon(context))
        .setContentTitle(words.getString(KEY_TITLE, null) ?: "Hey Goose")
        .setContentText(words.getString(KEY_BODY, null))
        .setOnlyAlertOnce(true)
        .also { if (open != null) it.setContentIntent(open) }
        .addAction(Notification.Action.Builder(null, words.getString(KEY_STOP, null) ?: "Stop", stop).build())
        .build()
    }

    /** The keys [choose] accepts for the notification's words. */
    val WORD_KEYS = setOf(KEY_TITLE, KEY_BODY, KEY_STOP, KEY_CHANNEL)
  }
}

/**
 * The settings switch's side: whether it can work, what it is doing, and turning it on and off.
 *
 * It also brings listening back each time the app comes to the front, when it was chosen: the
 * service can only be started from there (see [GooseWakeService]), so a reboot, a force stop or a
 * refusal ends it until the app is next opened. The app touches the module at launch
 * (`resumePhoneWake` in services/phone-wake.ts), which creates it and covers the first time.
 */
class PondWakeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  init {
    context.addLifecycleEventListener(this)
  }

  override fun getName() = "PondWake"

  override fun onHostResume() {
    if (available()) GooseWakeService.start(reactApplicationContext)
  }

  override fun onHostPause() = Unit

  override fun onHostDestroy() = Unit

  /** Whether this build, CPU and Android (8 or later, for the service's notification) can listen. */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun available(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && PondEar.loaded

  /** `{ chosen, listening, refusal }`: the switch, the service, and why it last stopped. */
  @ReactMethod
  fun state(promise: Promise) {
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("chosen", GooseWakeService.chosen(reactApplicationContext))
        putBoolean("active", GooseWakeService.active)
        putString("refusal", GooseWakeService.refusal)
      },
    )
  }

  /** Turn listening on or off; `words` are the notification's, translated by the app. */
  @ReactMethod
  fun choose(on: Boolean, words: ReadableMap, promise: Promise) {
    val copy = GooseWakeService.WORD_KEYS.filter { words.hasKey(it) }.associateWith { words.getString(it).orEmpty() }
    promise.resolve(GooseWakeService.choose(reactApplicationContext, on, copy))
  }

  /** Start the service again if it was chosen; called once at launch. */
  @ReactMethod
  fun resume(promise: Promise) {
    promise.resolve(available() && GooseWakeService.start(reactApplicationContext))
  }
}

class PondWakePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PondWakeModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
