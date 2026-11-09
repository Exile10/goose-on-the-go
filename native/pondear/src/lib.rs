//! JNI for `io.jarida.pondwake.PondEar`, the Pond's ear on the phone, in two parts:
//!
//! - the streaming "hey goose" detector (`pond_ear::wake::detector::Detector`), with the model
//!   embedded in pond-ear (`pond_ear::wake::hey_goose`) and its shipped threshold;
//! - for any other phrase, the speech segments the ear cuts for Whisper: Silero VAD v5 through
//!   pond-ear's endpointer and segmenter (`pond_ear::ear::endpoint`), which the phone sends to its
//!   Pond to match against the household's phrase.
//!
//! Audio is 16 kHz mono PCM16, converted to [-1, 1] the way pond-ear's WAV reader does.

use std::ffi::CString;

use jni_sys::{jclass, jfloat, jint, jlong, jshort, jshortArray, jsize, jstring, JNIEnv};
use pond_ear::ear::endpoint::{Endpoint, Endpointer, Segmenter};
use pond_ear::engine::kernels::Rung;
use pond_ear::engine::model::Arch;
use pond_ear::engine::silero;
use pond_ear::wake::detector::Detector;
use pond_ear::wake::{hey_goose, HEY_GOOSE_THRESHOLD};
use pond_ear::ModelFile;

/// Silero VAD v5, the revision the Pond downloads (`model_download.rs`, `SILERO_REVISION`),
/// fetched and checked by scripts/build-embedded-ear.sh. MIT, snakers4/silero-vad.
const SILERO_ONNX: &[u8] = include_bytes!("../models/silero_vad.onnx");
/// Audio kept for segments: the ear's 8 s cap, its 200 ms pre-roll and a margin.
const KEEP_SAMPLES: usize = 16_000 * 10;

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

/// Reads `count` samples of `pcm` as [-1, 1] floats.
///
/// # Safety
/// `env` and `pcm` must be the calling thread's JNI environment and a live short array.
unsafe fn samples(env: *mut JNIEnv, pcm: jshortArray, count: jint) -> Vec<f32> {
    let mut raw = vec![0 as jshort; count as usize];
    let get = (**env).v1_1.GetShortArrayRegion;
    get(env, pcm, 0, count, raw.as_mut_ptr());
    raw.iter().map(|&s| s as f32 / 32768.0).collect()
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
    let (_, triggers) = detector.push(&samples(env, pcm, count));
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

/// The ear's speech segments, outside any turn: what a phone sends its Pond to match.
struct Segments {
    vad: ModelFile,
    rung: Rung,
    state: silero::State,
    scratch: Box<silero::Scratch>,
    endpoint: Endpoint,
    endpointer: Endpointer,
    segmenter: Segmenter,
    /// The last [`KEEP_SAMPLES`] of audio; `base` is the absolute index of its first sample.
    audio: Vec<f32>,
    base: usize,
    /// Absolute index where the next Silero chunk starts.
    next: usize,
}

impl Segments {
    fn open() -> Option<Segments> {
        let vad = ModelFile::from_onnx(SILERO_ONNX).ok()?;
        let model = vad.model();
        if model.arch != Arch::Vad || model.w32.len() < silero::offsets().1 {
            return None;
        }
        let endpoint = Endpoint::default();
        Some(Segments {
            vad,
            rung: Rung::fastest(),
            state: silero::State::new(),
            scratch: Box::new(silero::Scratch::new()),
            endpoint,
            endpointer: Endpointer::new(endpoint),
            segmenter: Segmenter::default(),
            audio: Vec::with_capacity(KEEP_SAMPLES + silero::CHUNK * 4),
            base: 0,
            next: 0,
        })
    }

    /// Adds audio; returns the first segment it finished, as PCM16.
    fn push(&mut self, pcm: &[f32]) -> Option<Vec<i16>> {
        self.audio.extend_from_slice(pcm);
        let mut done = None;
        while self.next + silero::CHUNK <= self.base + self.audio.len() {
            let from = self.next - self.base;
            let model = self.vad.model();
            let p = silero::step(
                self.rung,
                model.w32,
                &mut self.state,
                &mut self.scratch,
                &self.audio[from..from + silero::CHUNK],
            );
            self.next += silero::CHUNK;
            self.endpointer.vad(self.next, p);
            let speaking = self.endpointer.speaking();
            if let Some((start, end, _)) = self.segmenter.step(&self.endpoint, self.next, speaking) {
                if done.is_none() {
                    let s = start.max(self.base) - self.base;
                    let e = end.max(self.base) - self.base;
                    done = Some(
                        self.audio[s..e.min(self.audio.len())]
                            .iter()
                            .map(|x| (x.clamp(-1.0, 1.0) * 32767.0) as i16)
                            .collect(),
                    );
                }
            }
        }
        if self.audio.len() > KEEP_SAMPLES + silero::CHUNK * 2 {
            let drop = self.audio.len() - KEEP_SAMPLES;
            self.audio.drain(..drop);
            self.base += drop;
        }
        done
    }
}

/// A new segmenter, as a handle for `nativeSegment`; 0 when the embedded VAD would not convert.
#[no_mangle]
pub extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpenSegments(_env: *mut JNIEnv, _class: jclass) -> jlong {
    Segments::open().map_or(0, |s| Box::into_raw(Box::new(s)) as jlong)
}

/// Feeds `count` samples of `pcm`; returns a finished speech segment as PCM16, or null.
///
/// # Safety
/// `handle` must come from `nativeOpenSegments` and not yet be closed; one thread at a time.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeSegment(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    pcm: jshortArray,
    count: jint,
) -> jshortArray {
    if handle == 0 || count <= 0 {
        return std::ptr::null_mut();
    }
    let segments = &mut *(handle as *mut Segments);
    let Some(segment) = segments.push(&samples(env, pcm, count)) else {
        return std::ptr::null_mut();
    };
    let len = segment.len() as jsize;
    let array = ((**env).v1_1.NewShortArray)(env, len);
    if array.is_null() {
        return array;
    }
    ((**env).v1_1.SetShortArrayRegion)(env, array, 0, len, segment.as_ptr());
    array
}

/// Frees the segmenter.
///
/// # Safety
/// `handle` must come from `nativeOpenSegments`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeCloseSegments(_env: *mut JNIEnv, _class: jclass, handle: jlong) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Segments));
    }
}
