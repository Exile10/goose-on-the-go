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
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import io.jarida.pondassist.GooseInteractionService
import java.io.File

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
  @JvmStatic external fun nativeOpenSegments(): Long
  /** A finished speech segment as PCM16, or null while speech goes on or none was heard. */
  @JvmStatic external fun nativeSegment(handle: Long, pcm: ShortArray, count: Int): ShortArray?
  @JvmStatic external fun nativeCloseSegments(handle: Long)
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
 * It listens in one of two ways ([MODE_HEY_GOOSE], [MODE_POND]), which the app sets from the
 * household's phrase (`configure`):
 *
 * - "hey goose": the Pond's own detector runs here. Audio never leaves the phone and is never
 *   written anywhere; each 80 ms is scored and dropped, beyond the last 20 seconds the detector
 *   keeps in memory to find the phrase.
 * - any other phrase: only the Pond knows it and the pronunciations it has learned, so the phone
 *   cuts what it hears into speech segments as the Pond's ear does (Silero VAD), and the app sends
 *   each one to the Pond (`POST /voice/wake/check`), which answers whether it opened with the
 *   phrase. A segment is a temporary file in the app's cache until the app has sent it, then
 *   deleted; at most [MAX_PENDING] wait at once, and the rest are dropped.
 *
 * Starting it needs the app in front (Android 14 refuses a microphone foreground service started
 * from the background), so it is started from the settings switch and resumed each time the app
 * opens; it is not restarted by the system or after a reboot.
 */
class GooseWakeService : Service() {
  private val main = Handler(Looper.getMainLooper())
  /** The mode the listening thread was started in; a change restarts it. */
  private var listeningMode = MODE_HEY_GOOSE
  private var listener: Thread? = null
  @Volatile private var listening = false
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
    running = this
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
    if (running === this) running = null
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
    listening = true
    listeningMode = mode(this)
    val pond = listeningMode == MODE_POND
    lateinit var thread: Thread
    thread = Thread({ ended(thread, if (pond) segment() else listen()) }, "goose-wake")
    listener = thread
    thread.start()
    Log.i(TAG, "kind=wake_listening state=on mode=$listeningMode why=$why")
  }

  /** Main thread: listen again in the mode the app has just set, if it changed. */
  private fun modeChanged() {
    if (listener == null || listeningMode == mode(this)) return
    stopListening("the household's phrase changed")
    update("the household's phrase changed")
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
    listening = false
    listener = null
    thread.join(JOIN_MS)
    Log.i(TAG, "kind=wake_listening state=off why=$why")
  }

  /** The listening thread for "hey goose": 80 ms at a time into the detector until [listening] is cleared. */
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
      while (listening) {
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
   * The listening thread for any other phrase: speech segments, each handed to the app to ask the
   * Pond (see the class comment), until [listening] is cleared or the Pond says it heard the phrase.
   */
  @SuppressLint("MissingPermission") // Checked first; the service is not started without it.
  private fun segment(): End {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      Log.w(TAG, "kind=wake_refused reason=$REFUSED_MICROPHONE")
      refusal = REFUSED_MICROPHONE
      return End.REFUSED
    }
    val segments = PondEar.nativeOpenSegments()
    if (segments == 0L) {
      Log.e(TAG, "kind=wake_refused reason=$REFUSED_MODEL: the embedded voice activity model did not convert")
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
      Log.i(TAG, "kind=wake_segmenter rung=${PondEar.nativeRung()}")
      val chunk = ShortArray(HOP)
      while (listening) {
        val read = record.read(chunk, 0, HOP)
        if (read < 0) {
          Log.w(TAG, "kind=wake_microphone_unavailable read=$read")
          return End.MICROPHONE
        }
        PondEar.nativeSegment(segments, chunk, read)?.let(::handOver)
      }
      return End.STOPPED
    } finally {
      record.release()
      PondEar.nativeCloseSegments(segments)
    }
  }

  /** Listening thread: write a segment for the app to send, unless too many already wait. */
  private fun handOver(pcm: ShortArray) {
    val seconds = pcm.size.toFloat() / RATE
    if (pending.get() >= MAX_PENDING) {
      Log.i(TAG, "kind=wake_segment_dropped reason=busy seconds=$seconds")
      return
    }
    val file = File(segmentDir(this), "segment-${System.nanoTime()}.wav")
    try {
      file.writeBytes(wav(pcm))
    } catch (error: java.io.IOException) {
      Log.w(TAG, "kind=wake_segment_dropped reason=write_failed error=${error.message}")
      return
    }
    pending.incrementAndGet()
    main.post {
      if (!PondWakeModule.offer(file.absolutePath)) {
        Log.i(TAG, "kind=wake_segment_dropped reason=app_not_running seconds=$seconds")
        release(file.absolutePath)
        return@post
      }
      // An answer that never comes (the app's runtime went away mid-send) must not hold a place.
      main.postDelayed({
        if (File(file.absolutePath).exists()) Log.i(TAG, "kind=wake_segment_dropped reason=unanswered seconds=$seconds")
        release(file.absolutePath)
      }, ANSWER_MS)
    }
  }

  /** Main thread: the Pond heard the phrase in a segment; let go of the microphone and open the orb. */
  private fun heardByPond() {
    stopListening("the Pond heard the phrase")
    heard()
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
    private const val KEY_MODE = "mode"
    /** Segments waiting for the app to send them; more are dropped until one is answered. */
    private const val MAX_PENDING = 2
    /** How long a segment waits for the app's answer before it is deleted unanswered. */
    private const val ANSWER_MS = 30_000L

    /** The household's phrase is "hey goose": the detector here hears it. */
    const val MODE_HEY_GOOSE = "hey_goose"
    /** Any other phrase: the Pond hears it in the segments the phone sends. */
    const val MODE_POND = "pond"

    const val REFUSED_START = "start_refused"
    const val REFUSED_MICROPHONE = "no_microphone"
    const val REFUSED_MODEL = "model_failed"
    const val REFUSED_NOT_ASSISTANT = "not_assistant"

    /** Whether the service holds the foreground now. */
    @Volatile var active = false
      private set

    /** The running service, for the module's calls. Main thread. */
    private var running: GooseWakeService? = null

    private val pending = java.util.concurrent.atomic.AtomicInteger(0)

    /** Why the service last stopped without being asked to, or null. Read by the settings row. */
    @Volatile var refusal: String? = null
      private set

    fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether the person has turned listening on; kept across restarts of the app. */
    fun chosen(context: Context) = prefs(context).getBoolean(KEY_ON, false)

    fun mode(context: Context): String = prefs(context).getString(KEY_MODE, MODE_HEY_GOOSE) ?: MODE_HEY_GOOSE

    /**
     * Main thread: listen in `mode` from now on, with the notification's new words (they name the
     * phrase). A running service re-words its notification and, if the mode changed, restarts.
     */
    fun configure(context: Context, mode: String, words: Map<String, String>) {
      val edit = prefs(context).edit().putString(KEY_MODE, if (mode == MODE_POND) MODE_POND else MODE_HEY_GOOSE)
      words.forEach { (key, value) -> edit.putString(key, value) }
      edit.apply()
      val service = running ?: return
      service.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(service))
      service.modeChanged()
    }

    /** Main thread: the app's answer from the Pond for one segment was a wake. */
    fun heardByPond(): Boolean {
      val service = running ?: return false
      Log.i(TAG, "kind=wake_heard by=pond")
      service.heardByPond()
      return true
    }

    /** Delete a segment the app has sent or given up on. */
    fun release(path: String) {
      val file = File(path)
      // Only this service's own segments: the path comes back over the bridge.
      if (file.parentFile?.name == SEGMENT_DIR && file.delete()) pending.decrementAndGet()
    }

    private const val SEGMENT_DIR = "wake-segments"

    private fun segmentDir(context: Context) = File(context.cacheDir, SEGMENT_DIR).apply { mkdirs() }

    /** PCM16 mono 16 kHz as a WAV file's bytes, as the Pond's routes read them. */
    private fun wav(pcm: ShortArray): ByteArray {
      val data = pcm.size * 2
      val out = java.nio.ByteBuffer.allocate(44 + data).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      out.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
      out.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(RATE).putInt(RATE * 2).putShort(2).putShort(16)
      out.put("data".toByteArray()).putInt(data)
      pcm.forEach { out.putShort(it) }
      return out.array()
    }

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
    live = this
  }

  override fun getName() = "PondWake"

  override fun invalidate() {
    if (live === this) live = null
    super.invalidate()
  }

  companion object {
    /** JavaScript's event for a segment to send: its file's path (services/phone-wake.ts). */
    private const val SEGMENT_EVENT = "PondWakeSegment"

    /** The module the app's JavaScript is running, for the service to hand segments to. */
    @Volatile private var live: PondWakeModule? = null

    /** Main thread: give a segment's file to the app's JavaScript; false when no app is running. */
    fun offer(path: String): Boolean {
      val module = live ?: return false
      val context = module.reactApplicationContext
      if (!context.hasActiveReactInstance()) return false
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(SEGMENT_EVENT, path)
      return true
    }
  }

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

  /** Listen for the household's phrase in `mode` ("hey_goose" or "pond"); `words` name it. */
  @ReactMethod
  fun configure(mode: String, words: ReadableMap) {
    val copy = GooseWakeService.WORD_KEYS.filter { words.hasKey(it) }.associateWith { words.getString(it).orEmpty() }
    reactApplicationContext.runOnUiQueueThread { GooseWakeService.configure(reactApplicationContext, mode, copy) }
  }

  /** The app has sent a segment, or given up on it: delete it. */
  @ReactMethod
  fun done(path: String) {
    GooseWakeService.release(path)
  }

  /** The Pond heard the phrase in a segment: open the orb. Resolves whether the service was there. */
  @ReactMethod
  fun heard(promise: Promise) {
    reactApplicationContext.runOnUiQueueThread { promise.resolve(GooseWakeService.heardByPond()) }
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
