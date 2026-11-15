package io.jarida.pondassist

import android.app.Activity
import android.app.KeyguardManager
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.RemoteException
import android.provider.Settings
import android.view.WindowManager
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.uimanager.ViewManager
import expo.modules.ReactActivityDelegateWrapper
import java.lang.ref.WeakReference

private const val TAG = "PondAssist"

/**
 * What makes Goose On The Go a candidate for Settings > Apps > Default apps > Digital assistant
 * app. Android lists an app there when it declares a VoiceInteractionService whose
 * `android.voice_interaction` meta-data names a session service (`res/xml/goose_interaction_service.xml`).
 *
 * A third-party assistant cannot listen for a hotword through it: `HotwordDetectionService` and
 * the always-on detector are reserved for preinstalled apps, so "Hey Goose" comes from this app's
 * own foreground service (`plugins/pond-wake/PondWake.kt`). What the role does give is the
 * system's assist gesture (holding the side key, or a swipe up from a bottom corner), which reaches
 * [GooseSession], and [showOverlay], the same session on request.
 */
class GooseInteractionService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    ready = this
  }

  override fun onShutdown() {
    if (ready === this) ready = null
    super.onShutdown()
  }

  companion object {
    /** The service while Android has it bound as the phone's assistant. */
    @Volatile private var ready: GooseInteractionService? = null

    /**
     * Open the voice orb as the assist gesture does, through [GooseSession]. Showing its own
     * session is what the active assistant may do from the background, so this works over any
     * app. False when Goose is not the phone's assistant now. Main thread only.
     */
    fun showOverlay(): Boolean {
      val service = ready ?: return false
      service.showSession(Bundle(), 0)
      Log.i(TAG, "assist session requested by the wake word")
      return true
    }

    /**
     * Whether this app holds the assistant role, or null below Android 10, where there is no
     * role to ask about. Not the same as [showOverlay] working: Android binds the service a
     * moment after the app's process starts, and may unbind it briefly, while the role stays put.
     */
    fun holdsRole(context: Context): Boolean? {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
      val roles = context.getSystemService(RoleManager::class.java)
      return roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
    }
  }
}

/** Hands Android a [GooseSession] each time the assist gesture is made. */
class GooseSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = GooseSession(this)
}

/**
 * One press of the assist gesture. It draws nothing of its own: it opens [AssistActivity], where
 * the app's voice orb runs in React Native, and stays shown for as long as that overlay does.
 *
 * Its own window is turned off before it is created ([setUiEnabled], Android 8 and later),
 * because an empty session window sits above every activity and would take the touches meant
 * for the overlay. On Android 7 there is no such switch, so the session hides itself as soon as
 * the overlay is started.
 */
class GooseSession(context: Context) : VoiceInteractionSession(context) {
  override fun onPrepareShow(args: Bundle?, showFlags: Int) {
    super.onPrepareShow(args, showFlags)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setUiEnabled(false)
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    current = WeakReference(this)
    val overlay = Intent(context, AssistActivity::class.java)
    try {
      // The assistant's own way in: Android puts the activity in an assistant task, over
      // whatever app is open, and sets FLAG_ACTIVITY_NEW_TASK itself.
      startAssistantActivity(overlay)
      Log.i(TAG, "assist overlay started for showFlags=$showFlags")
    } catch (error: RuntimeException) {
      // A session the system no longer counts as shown refuses. The holder of the assistant
      // role is exempt from the background activity start limits, so a plain start still works.
      Log.w(TAG, "startAssistantActivity refused (${error.javaClass.simpleName}); starting the overlay directly")
      context.startActivity(overlay.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) hide()
  }

  override fun onHide() {
    if (current?.get() === this) current = null
    super.onHide()
  }

  companion object {
    /** The session behind the overlay on screen, so the overlay can end it when it closes. */
    private var current: WeakReference<GooseSession>? = null

    /**
     * Hide the session that opened the overlay, so the next assist gesture shows a fresh one
     * instead of being read as a second press that dismisses it. Main thread only.
     */
    fun end() {
      current?.get()?.hide()
    }
  }
}

/**
 * Declared because Android asks every voice interaction service to name a recognition service
 * (`android:recognitionService`), and some settings pages, Samsung's among them, will not list an
 * assistant without one. It does not recognise speech for other apps and says so: every request
 * ends at once with [SpeechRecognizer.ERROR_CLIENT], and nothing is recorded.
 *
 * From Android 12 the attribute does nothing, so choosing Goose as the assistant leaves the
 * phone's speech recogniser where it was. On Android 11 and earlier the platform also makes this
 * service the system recogniser when Goose becomes the assistant, and apps that ask the default
 * `SpeechRecognizer` for dictation get the error until another assistant is chosen. That is
 * written down in docs/ASSISTANT.md. `selectableAsDefault="false"` keeps it out of the separate
 * Voice input picker on every version.
 */
class GooseRecognitionService : RecognitionService() {
  override fun onStartListening(recognizerIntent: Intent?, listener: RecognitionService.Callback) {
    Log.i(TAG, "speech recognition requested by another app; this app does not offer it")
    try {
      listener.error(SpeechRecognizer.ERROR_CLIENT)
    } catch (error: RemoteException) {
      Log.w(TAG, "recognition caller went away before it heard the refusal", error)
    }
  }

  override fun onStopListening(listener: RecognitionService.Callback) = Unit

  override fun onCancel(listener: RecognitionService.Callback) = Unit
}

/**
 * The overlay the assist gesture opens: a translucent activity that renders the JavaScript
 * component registered as [COMPONENT] (`index.ts`), which draws the voice orb over a dimmed view
 * of whatever app was open.
 *
 * It has its own task affinity and is kept out of Recents, so it never mixes with the app's main
 * task: closing it returns to the app that was open, and opening the app from it starts
 * MainActivity in the app's own task. It shares the React host with MainActivity, so a running
 * app's JavaScript, its Pond connection included, is reused rather than started twice.
 *
 * The wake word opens it the same way as the gesture, through [GooseInteractionService.showOverlay].
 *
 * It shows over the lock screen and turns the screen on, so "Hey Goose" works on a locked phone.
 * There the overlay's turns ask the Pond as a locked phone (`device_locked`), which answers with
 * no personal data or tools, until [PondAssistModule.unlock] dismisses the lock screen.
 */
class AssistActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    // Nothing is restored: a recreated overlay starts a new conversation, as a new gesture would.
    super.onCreate(null)
    Log.i(TAG, "assist overlay created locked=${locked(this)}")
  }

  override fun getMainComponentName(): String = COMPONENT

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(this, object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {})

  /**
   * An overlay nobody can see closes. Home, another app, or the screen going off stops the
   * activity, and an invisible overlay would otherwise still hold the microphone. A permission
   * prompt over it only pauses it, so asking for the microphone does not close it.
   */
  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations && !isFinishing) {
      Log.i(TAG, "assist overlay hidden; closing it")
      finish()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    if (!isChangingConfigurations) GooseSession.end()
  }

  companion object {
    /** The name `index.ts` registers the overlay's root component under. */
    const val COMPONENT = "assist"

    /** Whether the lock screen is up, so the overlay's turns must ask as a locked phone. */
    fun locked(context: Context) = context.getSystemService(KeyguardManager::class.java).isKeyguardLocked
  }
}

/** Whether Goose is the phone's assistant, the way to choose it, and closing the overlay. */
class PondAssistModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PondAssist"

  /**
   * Whether the window manager blurs what is behind the overlay now (`Theme.GooseAssist` asks
   * for it from Android 12). Many phones never do -- the compositor has no blur, as on the
   * Galaxy A57 -- and the rest stop in battery saver, so the panel reads this as it opens and
   * makes its glass denser when nothing behind it is blurred.
   */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun blursBehind(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    val blurs = reactApplicationContext.getSystemService(WindowManager::class.java).isCrossWindowBlurEnabled
    Log.i(TAG, "kind=assist_glass blurs_behind=$blurs")
    return blurs
  }

  /**
   * Resolves whether this app holds the assistant role, or null below Android 10, where there is
   * no role to ask about and the setting that records the assistant is not public.
   */
  @ReactMethod
  fun isAssistant(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve(null)
      return
    }
    try {
      promise.resolve(GooseInteractionService.holdsRole(reactApplicationContext))
    } catch (error: Exception) {
      promise.reject("E_ASSIST_ROLE", error.javaClass.simpleName, error)
    }
  }

  /**
   * Open the system screen where the assistant is chosen. Resolves true when one opened.
   *
   * Not `RoleManager.createRequestRoleIntent(ROLE_ASSISTANT)`: the assistant role is not
   * requestable, and that intent returns RESULT_CANCELED without showing anything. The voice
   * input settings action opens "Digital assistant app" on current Android; the default apps
   * list is the fallback for a build that does not resolve it.
   */
  @ReactMethod
  fun chooseAssistant(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    for (action in listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) {
      val intent = Intent(action)
      try {
        if (activity != null) activity.startActivity(intent)
        else reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        Log.i(TAG, "opened $action to choose the assistant")
        promise.resolve(true)
        return
      } catch (error: ActivityNotFoundException) {
        Log.w(TAG, "$action does not resolve on this phone")
      }
    }
    promise.resolve(false)
  }

  /** Whether the phone is locked now: the overlay asks the Pond as a locked phone while it is. */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun locked(): Boolean = AssistActivity.locked(reactApplicationContext)

  /**
   * Ask for the lock screen to be dismissed over the overlay (fingerprint, face or PIN). Resolves
   * true once the phone is unlocked, false when the person backs out or nothing could be asked.
   */
  @ReactMethod
  fun unlock(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity: Activity? = reactApplicationContext.currentActivity
      if (!AssistActivity.locked(reactApplicationContext)) {
        promise.resolve(true)
        return@runOnUiThread
      }
      if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        Log.w(TAG, "kind=assist_unlock_unavailable activity=${activity != null} sdk=${Build.VERSION.SDK_INT}")
        promise.resolve(false)
        return@runOnUiThread
      }
      activity.getSystemService(KeyguardManager::class.java).requestDismissKeyguard(
        activity,
        object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() {
            Log.i(TAG, "kind=assist_unlocked")
            promise.resolve(true)
          }

          override fun onDismissCancelled() {
            Log.i(TAG, "kind=assist_unlock_cancelled")
            promise.resolve(false)
          }

          override fun onDismissError() {
            Log.w(TAG, "kind=assist_unlock_failed")
            promise.resolve(false)
          }
        },
      )
    }
  }

  /** Close the assist overlay. Resolves false when the activity in front is not the overlay. */
  @ReactMethod
  fun close(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val overlay = reactApplicationContext.currentActivity as? AssistActivity
      overlay?.finish()
      promise.resolve(overlay != null)
    }
  }
}

class PondAssistPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(PondAssistModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
