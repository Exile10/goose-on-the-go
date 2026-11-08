package io.jarida.pondassist

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.RemoteException
import android.provider.Settings
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
 * The service itself does nothing. A third-party assistant cannot listen for a hotword through
 * it: `HotwordDetectionService` and the always-on detector are reserved for preinstalled apps,
 * so "Hey Goose" has to come from this app's own foreground service, a later phase. What the
 * role does give is the system's assist gesture (holding the side key, or a swipe up from a
 * bottom corner), which reaches [GooseSession].
 */
class GooseInteractionService : VoiceInteractionService()

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
 * Anything that can start an activity can start this one by class name, which leaves room for a
 * later wake-word service to open the same overlay.
 */
class AssistActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Nothing is restored: a recreated overlay starts a new conversation, as a new gesture would.
    super.onCreate(null)
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
  }
}

/** Whether Goose is the phone's assistant, the way to choose it, and closing the overlay. */
class PondAssistModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PondAssist"

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
      val roles = reactApplicationContext.getSystemService(RoleManager::class.java)
      promise.resolve(roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT))
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
