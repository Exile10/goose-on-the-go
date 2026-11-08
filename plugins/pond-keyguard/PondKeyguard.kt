package io.jarida.pondkeyguard

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The phone's own key to My Pond, sealed by a key in the Android Keystore that opens only after a
 * strong biometric (Class 3: a fingerprint on most phones) or the phone's PIN, pattern or password.
 *
 * expo-secure-store asks for a strong biometric only. A Galaxy's face unlock is Class 2, which the
 * Keystore never accepts for a hardware-bound key, so those phones offered a fingerprint alone and
 * a person with a cut finger had to fetch the admin card. The screen lock is as strong a check as
 * the fingerprint and is accepted by the Keystore, so it is offered beside it, in one prompt.
 *
 * Each read and each save is one use of the key behind a fresh check (timeout 0). A new
 * fingerprint invalidates it, as before, and so does removing the screen lock. Only the sealed
 * bytes are kept, in this app's own preferences; the sealing key never leaves the Keystore.
 */
class PondKeyguardModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PondKeyguard"

  /** Whether this phone can keep the key: a screen lock is set and a check is possible. */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun available(): Boolean {
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!keyguard.isDeviceSecure) return false
    return BiometricManager.from(context).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS
  }

  /** Whether a sealed key is kept in `slot`; asks nothing of the person. */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun has(slot: String): Boolean = prefs().contains(dataName(slot))

  @ReactMethod
  fun save(slot: String, secret: String, title: String, promise: Promise) {
    val cipher = try {
      deleteKey(slot)
      Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, createKey(slot)) }
    } catch (e: Exception) {
      return promise.reject("E_KEYSTORE", "could not make the key: ${e.message}", e)
    }
    authenticate(title, cipher, promise) { unlocked ->
      val sealed = unlocked.doFinal(secret.toByteArray(Charsets.UTF_8))
      prefs().edit()
        .putString(dataName(slot), encode(unlocked.iv) + ":" + encode(sealed))
        .apply()
      promise.resolve(null)
    }
  }

  /** The kept key after the check; null when none is kept. Rejects E_INVALIDATED when it is gone. */
  @ReactMethod
  fun read(slot: String, title: String, promise: Promise) {
    val stored = prefs().getString(dataName(slot), null) ?: return promise.resolve(null)
    val parts = stored.split(":")
    if (parts.size != 2) return invalidated(slot, promise)
    val cipher = try {
      val key = keyStore().getKey(alias(slot), null) as? SecretKey ?: return invalidated(slot, promise)
      Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, decode(parts[0]))) }
    } catch (e: KeyPermanentlyInvalidatedException) {
      return invalidated(slot, promise)
    } catch (e: Exception) {
      return promise.reject("E_KEYSTORE", "could not open the key: ${e.message}", e)
    }
    authenticate(title, cipher, promise) { unlocked ->
      promise.resolve(String(unlocked.doFinal(decode(parts[1])), Charsets.UTF_8))
    }
  }

  @ReactMethod
  fun forget(slot: String, promise: Promise) {
    try {
      deleteKey(slot)
      prefs().edit().remove(dataName(slot)).apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_KEYSTORE", "could not forget the key: ${e.message}", e)
    }
  }

  private fun authenticate(title: String, cipher: Cipher, promise: Promise, then: (Cipher) -> Unit) {
    val activity = reactApplicationContext.currentActivity as? FragmentActivity
      ?: return promise.reject("E_NO_ACTIVITY", "the app is not in the foreground")
    activity.runOnUiThread {
      val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            val unlocked = result.cryptoObject?.cipher
              ?: return promise.reject("E_KEYSTORE", "the check returned no key")
            try {
              then(unlocked)
            } catch (e: Exception) {
              promise.reject("E_KEYSTORE", "the key did not open: ${e.message}", e)
            }
          }

          override fun onAuthenticationError(code: Int, message: CharSequence) {
            // A dismissed prompt reads "cancelled", which the app tells apart from a failure.
            val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED ||
              code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              code == BiometricPrompt.ERROR_CANCELED
            if (cancelled) promise.reject("E_CANCELLED", "cancelled") else promise.reject("E_AUTH", message.toString())
          }
        },
      )
      val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(authenticators())
      // Before Android 11 a key cannot take the screen lock and a fingerprint together, so it
      // asks for the fingerprint alone there, and the prompt needs its own way out.
      if (!withScreenLock()) info.setNegativeButtonText(activity.getString(android.R.string.cancel))
      prompt.authenticate(info.build(), BiometricPrompt.CryptoObject(cipher))
    }
  }

  private fun createKey(slot: String): SecretKey {
    val spec = KeyGenParameterSpec.Builder(alias(slot), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
      .apply {
        if (withScreenLock()) {
          setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        }
      }
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
      init(spec)
      generateKey()
    }
  }

  private fun invalidated(slot: String, promise: Promise) {
    deleteKey(slot)
    prefs().edit().remove(dataName(slot)).apply()
    promise.reject("E_INVALIDATED", "the key was invalidated")
  }

  private fun deleteKey(slot: String) {
    val store = keyStore()
    if (store.containsAlias(alias(slot))) store.deleteEntry(alias(slot))
  }

  private fun withScreenLock() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

  private fun authenticators() = if (withScreenLock()) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG

  private fun keyStore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun alias(slot: String) = "goose.adminKey.$slot"

  private fun dataName(slot: String) = "sealed.$slot"

  private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun decode(text: String) = Base64.decode(text, Base64.NO_WRAP)

  private companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val PREFS = "io.jarida.pondkeyguard"
  }
}

class PondKeyguardPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(PondKeyguardModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
