//! JNI for `io.jarida.pondwake.PondEar`: the Pond's streaming "hey goose" detector
//! (`pond_ear::wake::detector::Detector`) behind three calls, open, push and close.
//!
//! The detector is the one the Pond's own ear is measured against, with the model embedded in
//! pond-ear (`pond_ear::wake::hey_goose`) and its shipped threshold. Audio is 16 kHz mono PCM16,
//! converted to [-1, 1] the way pond-ear's WAV reader does.

use std::ffi::CString;

use jni_sys::{jclass, jfloat, jint, jlong, jshort, jshortArray, jstring, JNIEnv};
use pond_ear::engine::kernels::Rung;
use pond_ear::wake::detector::Detector;
use pond_ear::wake::{hey_goose, HEY_GOOSE_THRESHOLD};

/// What `nativePush` returns when nothing in the chunk crossed the threshold.
const NO_TRIGGER: jfloat = -1.0;

/// A new detector on the fastest kernels this CPU has, as a handle for `nativePush`; 0 when the
/// embedded model would not convert, which the caller reports and does not retry.
#[no_mangle]
pub extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpen(_env: *mut JNIEnv, _class: jclass) -> jlong {
    match hey_goose().and_then(|model| Detector::new(model, Rung::fastest(), HEY_GOOSE_THRESHOLD)) {
        Ok(detector) => Box::into_raw(Box::new(detector)) as jlong,
        Err(_) => 0,
    }
}

/// The name of the kernels the detector runs on ("neon-f32", "scalar-f32", ...), for the
/// service's log line.
///
/// # Safety
/// `env` must be the JNI environment of the calling thread.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeRung(env: *mut JNIEnv, _class: jclass) -> jstring {
    let name = CString::new(Rung::fastest().name()).unwrap_or_default();
    let new_string = (**env).v1_1.NewStringUTF;
    new_string(env, name.as_ptr())
}

/// Feeds `count` samples of `pcm`. Returns the trigger's probability when "hey goose" was heard
/// in them (the detector's own two-second cooldown applies), otherwise `NO_TRIGGER`.
///
/// # Safety
/// `handle` must come from `nativeOpen` and not yet be closed; the Kotlin side owns it and calls
/// this from one thread.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativePush(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    pcm: jshortArray,
    count: jint,
) -> jfloat {
    if handle == 0 || count <= 0 {
        return NO_TRIGGER;
    }
    let detector = &mut *(handle as *mut Detector);
    let mut samples = vec![0 as jshort; count as usize];
    let get = (**env).v1_1.GetShortArrayRegion;
    get(env, pcm, 0, count, samples.as_mut_ptr());
    let audio: Vec<f32> = samples.iter().map(|&s| s as f32 / 32768.0).collect();
    let (_, triggers) = detector.push(&audio);
    triggers.iter().map(|t| t.p).fold(NO_TRIGGER, f32::max)
}

/// Frees the detector.
///
/// # Safety
/// `handle` must come from `nativeOpen`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeClose(_env: *mut JNIEnv, _class: jclass, handle: jlong) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Detector));
    }
}
