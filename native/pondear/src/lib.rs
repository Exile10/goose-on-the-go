//! JNI for `io.jarida.pondwake.PondEar`, the Pond's ear on the phone, in two parts:
//!
//! - the streaming "hey goose" detector (`pond_ear::wake::detector::Detector`), with the model
//!   embedded in pond-ear (`pond_ear::wake::hey_goose`) and its shipped threshold;
//! - for any other phrase, the speech segments the ear cuts for Whisper: Silero VAD v5 through
//!   pond-ear's endpointer and segmenter (`pond_ear::ear::endpoint`), which the phone sends to its
//!   Pond to match against the household's phrase;
//! - the second check on what was heard ([`verify`]): the Pond's speaker model, enrolment takes,
//!   the thresholds they set, and the decision for each candidate.
//!
//! Audio is 16 kHz mono PCM16, converted to [-1, 1] the way pond-ear's WAV reader does.

mod verify;

use std::ffi::CString;

use jni_sys::{
    jclass, jfloat, jfloatArray, jint, jintArray, jlong, jshort, jshortArray, jsize, jstring,
    JNIEnv,
};
use pond_ear::ear::endpoint::{Endpoint, Endpointer, Segmenter};
use pond_ear::engine::kernels::Rung;
use pond_ear::engine::model::Arch;
use pond_ear::engine::silero;
use pond_ear::ModelFile;
use verify::{Decision, Heard, Listener, Speaker, Take, Thresholds, Verifier};

/// Silero VAD v5, the revision the Pond downloads (`model_download.rs`, `SILERO_REVISION`),
/// fetched and checked by scripts/build-embedded-ear.sh. MIT, snakers4/silero-vad.
const SILERO_ONNX: &[u8] = include_bytes!("../models/silero_vad.onnx");
/// Audio kept for segments: the ear's 8 s cap, its 200 ms pre-roll and a margin.
const KEEP_SAMPLES: usize = 16_000 * 10;

/// What `nativePush` returns when nothing in the chunk crossed the threshold.
const NO_TRIGGER: jfloat = -1.0;

/// The listener at `threshold` (personal, or the CNN's own), as a handle for `nativePush`; 0 when
/// the embedded model would not convert, which the caller reports and does not retry.
#[no_mangle]
pub extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpen(
    _env: *mut JNIEnv,
    _class: jclass,
    threshold: jfloat,
) -> jlong {
    match Listener::new(threshold) {
        Ok(listener) => Box::into_raw(Box::new(Listening {
            listener,
            heard: None,
        })) as jlong,
        Err(_) => 0,
    }
}

/// A listener and the last candidate it heard, which `nativeHeard` hands over.
struct Listening {
    listener: Listener,
    heard: Option<Heard>,
}

/// The name of the kernels the detector runs on ("neon-f32", "scalar-f32", ...), for the
/// service's log line.
///
/// # Safety
/// `env` must be the JNI environment of the calling thread.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeRung(
    env: *mut JNIEnv,
    _class: jclass,
) -> jstring {
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

/// Feeds `count` samples of `pcm`. Returns a candidate's probability, at its peak, when one was
/// heard (its speech then waits for `nativeHeard`), otherwise `NO_TRIGGER`.
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
    let listening = &mut *(handle as *mut Listening);
    match listening.listener.push(&samples(env, pcm, count)) {
        Some(heard) => {
            let p = heard.p;
            listening.heard = Some(heard);
            p
        }
        None => NO_TRIGGER,
    }
}

/// The speech of the candidate `nativePush` last reported, as PCM16, once; null when none waits.
///
/// # Safety
/// `handle` must come from `nativeOpen` and not yet be closed; same thread as `nativePush`.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeHeard(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
) -> jshortArray {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    let listening = &mut *(handle as *mut Listening);
    match listening.heard.take() {
        Some(heard) => short_array(env, &heard.audio),
        None => std::ptr::null_mut(),
    }
}

/// Frees the listener.
///
/// # Safety
/// `handle` must come from `nativeOpen`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeClose(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Listening));
    }
}

/// `pcm` in [-1, 1] as a new Java short array of PCM16; null if the VM could not make one.
///
/// # Safety
/// `env` must be the calling thread's JNI environment.
unsafe fn short_array(env: *mut JNIEnv, pcm: &[f32]) -> jshortArray {
    let out: Vec<i16> = pcm
        .iter()
        .map(|x| (x.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();
    let len = out.len() as jsize;
    let array = ((**env).v1_1.NewShortArray)(env, len);
    if !array.is_null() {
        ((**env).v1_1.SetShortArrayRegion)(env, array, 0, len, out.as_ptr());
    }
    array
}

/// `values` as a new Java float array; null if the VM could not make one.
///
/// # Safety
/// `env` must be the calling thread's JNI environment.
unsafe fn float_array(env: *mut JNIEnv, values: &[f32]) -> jfloatArray {
    let len = values.len() as jsize;
    let array = ((**env).v1_1.NewFloatArray)(env, len);
    if !array.is_null() {
        ((**env).v1_1.SetFloatArrayRegion)(env, array, 0, len, values.as_ptr());
    }
    array
}

/// A Java float array's contents.
///
/// # Safety
/// `env` and `array` must be the calling thread's JNI environment and a live float array.
unsafe fn floats(env: *mut JNIEnv, array: jfloatArray) -> Vec<f32> {
    if array.is_null() {
        return Vec::new();
    }
    let len = ((**env).v1_1.GetArrayLength)(env, array);
    let mut out = vec![0f32; len.max(0) as usize];
    ((**env).v1_1.GetFloatArrayRegion)(env, array, 0, len, out.as_mut_ptr());
    out
}

/// A Java int array's contents.
///
/// # Safety
/// `env` and `array` must be the calling thread's JNI environment and a live int array.
unsafe fn ints(env: *mut JNIEnv, array: jintArray) -> Vec<i32> {
    if array.is_null() {
        return Vec::new();
    }
    let len = ((**env).v1_1.GetArrayLength)(env, array);
    let mut out = vec![0i32; len.max(0) as usize];
    ((**env).v1_1.GetIntArrayRegion)(env, array, 0, len, out.as_mut_ptr());
    out
}

/// Takes as the app keeps them: for each person `counts[i]` takes, each `[peak, embedding...]`,
/// one after another in `flat`. Empty when the shapes do not agree.
fn people(flat: &[f32], counts: &[i32]) -> Vec<Vec<Take>> {
    let total: i32 = counts.iter().sum();
    if total <= 0 || !flat.len().is_multiple_of(total as usize) {
        return Vec::new();
    }
    let width = flat.len() / total as usize;
    if width < 2 {
        return Vec::new();
    }
    let mut takes = flat.chunks(width).map(|t| Take {
        peak: t[0],
        emb: t[1..].to_vec(),
    });
    counts
        .iter()
        .map(|&n| takes.by_ref().take(n.max(0) as usize).collect())
        .collect()
}

/// The Pond's speaker model from the ONNX at `path` (the app checked its checksum), as a handle;
/// 0 when it cannot be read or converted.
///
/// # Safety
/// `env` and `path` must be the calling thread's JNI environment and a live string.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpenSpeaker(
    env: *mut JNIEnv,
    _class: jclass,
    path: jstring,
) -> jlong {
    let chars = ((**env).v1_1.GetStringUTFChars)(env, path, std::ptr::null_mut());
    if chars.is_null() {
        return 0;
    }
    let file = std::ffi::CStr::from_ptr(chars)
        .to_string_lossy()
        .into_owned();
    ((**env).v1_1.ReleaseStringUTFChars)(env, path, chars);
    match std::fs::read(file)
        .map_err(|e| e.to_string())
        .and_then(|onnx| Speaker::open(&onnx))
    {
        Ok(speaker) => Box::into_raw(Box::new(speaker)) as jlong,
        Err(_) => 0,
    }
}

/// The unit embedding of `pcm`; null when the span is too short to embed.
///
/// # Safety
/// `handle` must come from `nativeOpenSpeaker` and not yet be closed; one thread at a time.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeEmbed(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    pcm: jshortArray,
) -> jfloatArray {
    if handle == 0 || pcm.is_null() {
        return std::ptr::null_mut();
    }
    let speaker = &mut *(handle as *mut Speaker);
    let count = ((**env).v1_1.GetArrayLength)(env, pcm);
    match speaker.embed(&samples(env, pcm, count)) {
        Ok(emb) => float_array(env, &emb),
        Err(_) => std::ptr::null_mut(),
    }
}

/// One teach take: `[peak, embedding...]`, scored and embedded as the service will hear it; null
/// when the take is too short.
///
/// # Safety
/// `handle` must come from `nativeOpenSpeaker` and not yet be closed; one thread at a time.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeEnrol(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    pcm: jshortArray,
) -> jfloatArray {
    if handle == 0 || pcm.is_null() {
        return std::ptr::null_mut();
    }
    let speaker = &mut *(handle as *mut Speaker);
    let count = ((**env).v1_1.GetArrayLength)(env, pcm);
    match verify::enrol(speaker, &samples(env, pcm, count)) {
        Ok(take) => float_array(env, &[&[take.peak][..], &take.emb].concat()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Frees the speaker model.
///
/// # Safety
/// `handle` must come from `nativeOpenSpeaker`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeCloseSpeaker(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Speaker));
    }
}

/// The thresholds the takes set (see [`people`] for their layout): `[cnn, accept, reject]`.
///
/// # Safety
/// `env` must be the calling thread's JNI environment, and both arrays live.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeCalibrate(
    env: *mut JNIEnv,
    _class: jclass,
    flat: jfloatArray,
    counts: jintArray,
) -> jfloatArray {
    let t = verify::calibrate(&people(&floats(env, flat), &ints(env, counts)));
    float_array(env, &[t.cnn, t.accept, t.reject])
}

/// The range a personal "hey goose" threshold may take, `[floor, strict]`: the wake test listens
/// at the floor to see every near miss, and a threshold it proposes stays inside the range.
///
/// # Safety
/// `env` must be the calling thread's JNI environment.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeLimits(
    env: *mut JNIEnv,
    _class: jclass,
) -> jfloatArray {
    float_array(env, &[verify::CNN_FLOOR, verify::STRICT])
}

/// The voices taught here and the lines to judge by, as a handle for `nativeVoice` and the decisions.
///
/// # Safety
/// `env` must be the calling thread's JNI environment, and both arrays live.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpenVerifier(
    env: *mut JNIEnv,
    _class: jclass,
    flat: jfloatArray,
    counts: jintArray,
    cnn: jfloat,
    accept: jfloat,
    reject: jfloat,
) -> jlong {
    let verifier = Verifier::new(
        &people(&floats(env, flat), &ints(env, counts)),
        Thresholds {
            cnn,
            accept,
            reject,
        },
    );
    Box::into_raw(Box::new(verifier)) as jlong
}

/// The best match for `emb` among the taught voices, on the Pond's scale; -1 with nobody taught.
///
/// # Safety
/// `handle` must come from `nativeOpenVerifier` and not yet be closed.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeVoice(
    env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    emb: jfloatArray,
) -> jfloat {
    if handle == 0 {
        return -1.0;
    }
    (*(handle as *const Verifier)).voice(&floats(env, emb))
}

/// What to do with a "hey goose" candidate: 1 wake, 2 ask the Pond, 0 ignore. `voice` is NaN when
/// it could not be scored.
///
/// # Safety
/// `handle` must come from `nativeOpenVerifier` and not yet be closed.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeDecide(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    p: jfloat,
    voice: jfloat,
) -> jint {
    if handle == 0 {
        return 0;
    }
    code((*(handle as *const Verifier)).decide(p, Some(voice).filter(|v| !v.is_nan())))
}

/// What to do with a speech segment for another phrase: 2 ask the Pond, 0 ignore.
///
/// # Safety
/// `handle` must come from `nativeOpenVerifier` and not yet be closed.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeDecideSegment(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
    voice: jfloat,
) -> jint {
    if handle == 0 {
        return 2;
    }
    code((*(handle as *const Verifier)).decide_segment(Some(voice).filter(|v| !v.is_nan())))
}

fn code(decision: Decision) -> jint {
    match decision {
        Decision::Ignore => 0,
        Decision::Wake => 1,
        Decision::AskPond => 2,
    }
}

/// Frees the verifier.
///
/// # Safety
/// `handle` must come from `nativeOpenVerifier`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeCloseVerifier(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Verifier));
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
            if let Some((start, end, _)) = self.segmenter.step(&self.endpoint, self.next, speaking)
            {
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
pub extern "system" fn Java_io_jarida_pondwake_PondEar_nativeOpenSegments(
    _env: *mut JNIEnv,
    _class: jclass,
) -> jlong {
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
    if !array.is_null() {
        ((**env).v1_1.SetShortArrayRegion)(env, array, 0, len, segment.as_ptr());
    }
    array
}

/// Frees the segmenter.
///
/// # Safety
/// `handle` must come from `nativeOpenSegments`, and is never used again.
#[no_mangle]
pub unsafe extern "system" fn Java_io_jarida_pondwake_PondEar_nativeCloseSegments(
    _env: *mut JNIEnv,
    _class: jclass,
    handle: jlong,
) {
    if handle != 0 {
        drop(Box::from_raw(handle as *mut Segments));
    }
}

#[cfg(test)]
mod tests {
    use super::people;

    #[test]
    fn takes_are_read_back_as_the_app_lays_them_out() {
        // Two people: two takes, then one; each take a peak and a three-number embedding.
        let flat = [0.9, 1.0, 0.0, 0.0, 0.8, 0.0, 1.0, 0.0, 0.7, 0.0, 0.0, 1.0];
        let read = people(&flat, &[2, 1]);
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].len(), 2);
        assert_eq!(read[1][0].peak, 0.7);
        assert_eq!(read[1][0].emb, vec![0.0, 0.0, 1.0]);
        // Shapes that do not agree read as nobody, never as a garbled print.
        assert!(people(&flat[..11], &[2, 1]).is_empty());
        assert!(people(&flat, &[]).is_empty());
    }
}
