//! Whether what the phone heard was the household's wake phrase, said by a voice taught on it.
//!
//! The "hey goose" CNN alone misses most real voices at its shipped threshold (it was trained on
//! synthetic voices only, `pond-ear/models/hey-goose.md`) and still takes its near misses. So it
//! listens at a lower threshold set from this phone's own enrolment takes, and each candidate is
//! checked twice before the orb opens:
//!
//! 1. **The voice.** The candidate's segment through the Pond's speaker model (WeSpeaker
//!    ResNet34-LM, fetched from the Pond), scored against the voices taught on this phone exactly
//!    as the Pond scores Voice Match (`pond_ear::score::Print::raw`). A voice clearly not taught here
//!    is ignored.
//! 2. **The words.** A taught voice with the CNN sure of itself wakes at once; anything less is sent
//!    to the Pond, whose Whisper must hear the whole phrase (`phrase_only`).
//!
//! Everything that decides lives here, so the listening service and the phone's wake test run the
//! same code. Nothing here records or keeps audio beyond the segment being decided.

use pond_ear::engine::exec;
use pond_ear::engine::fbank::{self, FRAME, NUM_BINS, SHIFT};
use pond_ear::engine::model::Arch;
use pond_ear::score::{normalized, Print};
use pond_ear::wake::detector::Detector;
use pond_ear::wake::{hey_goose, HEY_GOOSE_THRESHOLD};
use pond_ear::{ModelFile, Rung};

/// The CNN's own threshold: sure enough that a taught voice wakes without asking the Pond.
pub const STRICT: f32 = HEY_GOOSE_THRESHOLD;
/// The lowest personal threshold, however quietly the takes scored.
pub const CNN_FLOOR: f32 = 0.5;
/// After the first crossing, windows (80 ms each) to wait for the phrase to finish and take the
/// highest: the first crossing at a lower threshold is often before the phrase has ended.
pub const PEAK_WINDOWS: usize = 3;
/// No second wake within this long of the first.
pub const COOLDOWN_SECONDS: f64 = 2.0;
/// The longest span the speaker model sees, as the room's Voice Match.
pub const SPEAKER_MAX_SECONDS: f32 = 3.0;
/// With no taught voice to measure, the Pond's own Voice Match bar.
pub const DEFAULT_ACCEPT: f32 = 0.5;
/// Below a voice's own spread, how far a candidate may fall and still be taken as that voice.
pub const ACCEPT_MARGIN: f32 = 0.05;
/// Below the accept line, how far before a voice is clearly someone else.
pub const UNSURE_BAND: f32 = 0.15;

/// Audio past the take, so its last window is scored.
const TAIL_SAMPLES: usize = 8_000;

/// One window over the threshold: its probability and the speech it holds, as stream samples.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidate {
    pub t: f64,
    pub p: f32,
    pub start: usize,
    pub end: usize,
}

/// The highest window among the first crossing and the [`PEAK_WINDOWS`] after it.
#[derive(Debug, Default)]
pub struct Peak {
    best: Option<Candidate>,
    after: usize,
}

impl Peak {
    /// One scored window: `Some` when it crossed the threshold. Returns the peak once
    /// [`PEAK_WINDOWS`] windows have followed the first crossing.
    pub fn step(&mut self, window: Option<Candidate>) -> Option<Candidate> {
        match (&mut self.best, window) {
            (None, None) => None,
            (None, Some(c)) => {
                self.best = Some(c);
                self.after = 0;
                None
            }
            (Some(best), w) => {
                if let Some(c) = w {
                    if c.p > best.p {
                        *best = c;
                    }
                }
                self.after += 1;
                if self.after >= PEAK_WINDOWS {
                    self.after = 0;
                    self.best.take()
                } else {
                    None
                }
            }
        }
    }
}

/// What the listener heard: the peak window and its speech.
#[derive(Debug, Clone)]
pub struct Heard {
    pub p: f32,
    pub audio: Vec<f32>,
}

/// The CNN at a threshold, reporting each wake candidate at its peak, with a cooldown.
pub struct Listener {
    detector: Detector,
    peak: Peak,
    quiet_until: f64,
}

impl Listener {
    pub fn new(threshold: f32) -> Result<Listener, String> {
        let model = hey_goose().map_err(|e| format!("the wake model: {e}"))?;
        let mut detector = Detector::new(model, Rung::fastest(), threshold)
            .map_err(|e| format!("the wake detector: {e}"))?;
        // Every window over the threshold is reported; the cooldown is this listener's, after the peak.
        detector.cooldown_s = 0.0;
        Ok(Listener {
            detector,
            peak: Peak::default(),
            quiet_until: 0.0,
        })
    }

    /// Adds audio; returns the first candidate it finished, if any.
    pub fn push(&mut self, pcm: &[f32]) -> Option<Heard> {
        let (scores, triggers) = self.detector.push(pcm);
        let mut heard = None;
        let mut over = triggers.iter().peekable();
        for score in scores {
            let window = match over.peek() {
                Some(t) if t.t == score.t => over.next().map(|t| Candidate {
                    t: t.t,
                    p: t.p,
                    start: t.start,
                    end: t.end,
                }),
                _ => None,
            };
            if score.t < self.quiet_until {
                continue;
            }
            if let Some(peak) = self.peak.step(window) {
                self.quiet_until = peak.t + COOLDOWN_SECONDS;
                if heard.is_none() {
                    heard = Some(Heard {
                        p: peak.p,
                        audio: self.detector.audio(peak.start, peak.end),
                    });
                }
            }
        }
        heard
    }
}

/// The Pond's speaker model on the phone, embedding one span at a time.
pub struct Speaker {
    file: ModelFile,
    arena: Vec<f32>,
    feats: Vec<f32>,
    emb: Vec<f32>,
    max_frames: usize,
}

impl Speaker {
    /// The ResNet34-LM ONNX the Pond serves; the caller checks its checksum first.
    pub fn open(onnx: &[u8]) -> Result<Speaker, String> {
        let file = ModelFile::from_onnx(onnx).map_err(|e| format!("the speaker model: {e}"))?;
        let model = file.model();
        if model.arch != Arch::ResNet || model.frontend != 0 {
            return Err("the speaker model is not WeSpeaker's ResNet on fbank".into());
        }
        let max_frames = (SPEAKER_MAX_SECONDS * 100.0) as usize;
        let plan = exec::plan(&model, max_frames)
            .map_err(|e| format!("planning the speaker model: {e:?}"))?;
        let emb = vec![0f32; model.emb_dim];
        Ok(Speaker {
            arena: vec![0f32; plan.arena],
            feats: vec![0f32; max_frames * NUM_BINS],
            emb,
            max_frames,
            file,
        })
    }

    /// The unit embedding of `pcm` (16 kHz, [-1, 1]); its newest [`SPEAKER_MAX_SECONDS`] when longer.
    /// Mean-normalised over the span, as Voice Match was trained (`ear::parts::SpeakerNet::embed`).
    pub fn embed(&mut self, pcm: &[f32]) -> Result<Vec<f32>, String> {
        let longest = FRAME + (self.max_frames - 1) * SHIFT;
        let pcm = &pcm[pcm.len().saturating_sub(longest)..];
        let n = fbank::num_frames(pcm.len());
        for i in 0..n {
            fbank::frame(
                &pcm[i * SHIFT..],
                &mut self.feats[i * NUM_BINS..(i + 1) * NUM_BINS],
            );
        }
        fbank::cmn(&mut self.feats, n);
        let model = self.file.model();
        let plan =
            exec::plan(&model, n).map_err(|e| format!("the span is too short to embed: {e:?}"))?;
        exec::run(
            &model,
            &plan,
            Rung::fastest(),
            &self.feats[..n * NUM_BINS],
            &mut self.arena[..plan.arena],
            &mut self.emb,
            None,
        )
        .map_err(|e| format!("running the speaker model: {e:?}"))?;
        Ok(normalized(&self.emb))
    }
}

/// One enrolment take, as the phone keeps it: how sure the CNN was, and the phrase's voice.
#[derive(Debug, Clone)]
pub struct Take {
    pub peak: f32,
    pub emb: Vec<f32>,
}

/// A teach take through the same listener and speaker model the service uses: the highest CNN
/// window anywhere in it, and the embedding of that window's speech.
pub fn enrol(speaker: &mut Speaker, pcm: &[f32]) -> Result<Take, String> {
    let model = hey_goose().map_err(|e| format!("the wake model: {e}"))?;
    let mut detector = Detector::new(model, Rung::fastest(), 0.0)
        .map_err(|e| format!("the wake detector: {e}"))?;
    detector.cooldown_s = 0.0;
    let mut best: Option<Candidate> = None;
    for chunk in [pcm, &[0.0; TAIL_SAMPLES][..]] {
        for t in detector.push(chunk).1 {
            if best.is_none_or(|b| t.p > b.p) {
                best = Some(Candidate {
                    t: t.t,
                    p: t.p,
                    start: t.start,
                    end: t.end,
                });
            }
        }
    }
    let best = best.ok_or("the take is too short to score")?;
    let emb = speaker.embed(&detector.audio(best.start, best.end))?;
    Ok(Take { peak: best.p, emb })
}

/// The lines a candidate is judged by, set from the takes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thresholds {
    /// The CNN's threshold for a candidate.
    pub cnn: f32,
    /// A taught voice at or above this.
    pub accept: f32,
    /// Below this, clearly not a taught voice.
    pub reject: f32,
}

/// Thresholds for the voices taught on this phone, one `Vec<Take>` per person.
///
/// The CNN listens at 80% of the quietest take's peak, between [`CNN_FLOOR`] and [`STRICT`]. A
/// voice is accepted down to its own spread: each take scored against the person's other takes
/// (leave one out), the lowest of those, less [`ACCEPT_MARGIN`].
pub fn calibrate(people: &[Vec<Take>]) -> Thresholds {
    // A take the detector did not hear as the phrase at all says nothing about either line: its
    // window may hold no phrase. The app does not keep one; this guards takes kept before that.
    let people: Vec<Vec<&Take>> = people
        .iter()
        .map(|takes| takes.iter().filter(|t| t.peak >= CNN_FLOOR).collect())
        .collect();
    let quietest = people
        .iter()
        .flatten()
        .map(|t| t.peak)
        .fold(f32::INFINITY, f32::min);
    let cnn = if quietest.is_finite() {
        (0.8 * quietest).clamp(CNN_FLOOR, STRICT)
    } else {
        STRICT
    };
    let mut lowest = f32::INFINITY;
    for takes in people.iter().filter(|t| t.len() >= 2) {
        for (i, take) in takes.iter().enumerate() {
            let others = Print {
                id: String::new(),
                name: String::new(),
                embs: takes
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, t)| t.emb.clone())
                    .collect(),
            };
            lowest = lowest.min(others.raw(&take.emb));
        }
    }
    let accept = if lowest.is_finite() {
        (lowest - ACCEPT_MARGIN).clamp(0.3, 0.8)
    } else {
        DEFAULT_ACCEPT
    };
    Thresholds {
        cnn,
        accept,
        reject: accept - UNSURE_BAND,
    }
}

/// What to do with a candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Open the orb.
    Wake,
    /// Send the segment to the Pond, which must hear the whole phrase.
    AskPond,
    /// Not the phrase, or not a voice taught here.
    Ignore,
}

/// The voices taught on this phone and the lines to judge by.
pub struct Verifier {
    prints: Vec<Print>,
    pub thresholds: Thresholds,
}

impl Verifier {
    pub fn new(people: &[Vec<Take>], thresholds: Thresholds) -> Verifier {
        // As in `calibrate`: a take the detector did not hear as the phrase is not this voice's.
        let prints = people
            .iter()
            .map(|takes| -> Vec<Vec<f32>> {
                takes
                    .iter()
                    .filter(|t| t.peak >= CNN_FLOOR)
                    .map(|t| t.emb.clone())
                    .collect()
            })
            .filter(|embs| !embs.is_empty())
            .map(|embs| Print {
                id: String::new(),
                name: String::new(),
                embs,
            })
            .collect();
        Verifier { prints, thresholds }
    }

    /// Whether anyone is taught here; with nobody, the phone listens as it always did.
    pub fn taught(&self) -> bool {
        !self.prints.is_empty()
    }

    /// The best match among the taught voices, on the Pond's scale.
    pub fn voice(&self, emb: &[f32]) -> f32 {
        self.prints.iter().map(|p| p.raw(emb)).fold(-1.0, f32::max)
    }

    /// A "hey goose" candidate: the CNN's `p` and, when anyone is taught, its voice's score.
    pub fn decide(&self, p: f32, voice: Option<f32>) -> Decision {
        let Some(voice) = voice.filter(|_| self.taught()) else {
            return if p >= STRICT {
                Decision::Wake
            } else {
                Decision::Ignore
            };
        };
        if voice < self.thresholds.reject {
            Decision::Ignore
        } else if p >= STRICT && voice >= self.thresholds.accept {
            Decision::Wake
        } else {
            Decision::AskPond
        }
    }

    /// A speech segment for another phrase, which only the Pond can word: ask it unless the voice
    /// is clearly not one taught here.
    pub fn decide_segment(&self, voice: Option<f32>) -> Decision {
        match voice.filter(|_| self.taught()) {
            Some(v) if v < self.thresholds.reject => Decision::Ignore,
            _ => Decision::AskPond,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(p: f32, t: f64) -> Candidate {
        Candidate {
            t,
            p,
            start: (t * 16_000.0) as usize,
            end: (t * 16_000.0) as usize + 100,
        }
    }

    #[test]
    fn the_peak_is_the_highest_window_once_the_phrase_has_had_time_to_finish() {
        let mut peak = Peak::default();
        assert_eq!(peak.step(None), None);
        assert_eq!(peak.step(Some(cand(0.6, 1.0))), None);
        assert_eq!(peak.step(Some(cand(0.9, 1.08))), None);
        assert_eq!(peak.step(None), None);
        assert_eq!(peak.step(Some(cand(0.7, 1.24))), Some(cand(0.9, 1.08)));
        // And it starts over.
        assert_eq!(peak.step(None), None);
    }

    fn unit(seed: u32) -> Vec<f32> {
        let mut s = seed;
        normalized(
            &(0..32)
                .map(|_| {
                    s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    (s >> 8) as f32 / 16_777_216.0 - 0.5
                })
                .collect::<Vec<_>>(),
        )
    }

    /// A voice: `base` with a little of something else in each take.
    fn takes(base: u32, peaks: &[f32]) -> Vec<Take> {
        let b = unit(base);
        peaks
            .iter()
            .enumerate()
            .map(|(i, &peak)| {
                let n = unit(base * 100 + i as u32);
                Take {
                    peak,
                    emb: normalized(
                        &b.iter()
                            .zip(&n)
                            .map(|(x, y)| x + 0.25 * y)
                            .collect::<Vec<_>>(),
                    ),
                }
            })
            .collect()
    }

    #[test]
    fn the_cnn_listens_below_the_quietest_take_and_never_below_the_floor() {
        let t = calibrate(&[takes(1, &[0.9, 0.8, 0.7])]);
        assert!((t.cnn - 0.56).abs() < 1e-5, "{t:?}");
        // A quiet take the CNN still heard: the line stops at the floor.
        assert_eq!(calibrate(&[takes(1, &[0.55, 0.9])]).cnn, CNN_FLOOR);
        // Takes the CNN was certain of still leave room below them.
        assert!((calibrate(&[takes(1, &[1.0, 1.0])]).cnn - 0.8).abs() < 1e-6);
        assert_eq!(calibrate(&[]).cnn, STRICT);
    }

    #[test]
    fn a_take_the_detector_did_not_hear_moves_neither_line() {
        let heard = takes(1, &[0.9, 0.85, 0.95]);
        let mut with_a_stray = heard.clone();
        with_a_stray.extend(takes(9, &[0.003]));
        assert_eq!(calibrate(&[with_a_stray.clone()]), calibrate(&[heard]));
        // Nor does it make somebody taught.
        let only_strays = vec![takes(9, &[0.003, 0.2])];
        assert!(!Verifier::new(&only_strays, calibrate(&only_strays)).taught());
        assert_eq!(calibrate(&only_strays).cnn, STRICT);
    }

    #[test]
    fn a_voice_is_accepted_down_to_its_own_spread() {
        let t = calibrate(&[takes(1, &[0.9; 5])]);
        assert!(
            t.accept > DEFAULT_ACCEPT,
            "consistent takes set a higher bar than the default: {t:?}"
        );
        assert!((t.accept - t.reject - UNSURE_BAND).abs() < 1e-6);
        // Nobody with two takes: the Pond's own bar.
        assert_eq!(calibrate(&[takes(1, &[0.9])]).accept, DEFAULT_ACCEPT);
    }

    #[test]
    fn only_a_taught_voice_with_a_sure_cnn_wakes_at_once() {
        let people = vec![takes(1, &[0.9; 5])];
        let v = Verifier::new(&people, calibrate(&people));
        let me = v.voice(&takes(1, &[0.9])[0].emb);
        let stranger = v.voice(&unit(7));
        assert!(me >= v.thresholds.accept, "{me} vs {:?}", v.thresholds);
        assert!(
            stranger < v.thresholds.reject,
            "{stranger} vs {:?}",
            v.thresholds
        );

        assert_eq!(v.decide(0.99, Some(me)), Decision::Wake);
        // A lower CNN: the Pond must hear the whole phrase ("OK goose" stops there).
        assert_eq!(v.decide(0.7, Some(me)), Decision::AskPond);
        // Someone not taught here, however sure the CNN.
        assert_eq!(v.decide(0.99, Some(stranger)), Decision::Ignore);
        // Unsure of the voice: ask.
        let unsure = (v.thresholds.accept + v.thresholds.reject) / 2.0;
        assert_eq!(v.decide(0.99, Some(unsure)), Decision::AskPond);
    }

    #[test]
    fn with_nobody_taught_the_phone_listens_as_it_always_did() {
        let v = Verifier::new(&[], calibrate(&[]));
        assert!(!v.taught());
        assert_eq!(v.decide(0.98, None), Decision::Wake);
        assert_eq!(v.decide(0.9, None), Decision::Ignore);
        assert_eq!(v.decide_segment(None), Decision::AskPond);
    }

    #[test]
    fn another_phrase_is_only_sent_to_the_pond_in_a_voice_that_might_be_taught_here() {
        let people = vec![takes(1, &[0.9; 5])];
        let v = Verifier::new(&people, calibrate(&people));
        assert_eq!(
            v.decide_segment(Some(v.voice(&takes(1, &[0.9])[0].emb))),
            Decision::AskPond
        );
        assert_eq!(v.decide_segment(Some(v.voice(&unit(7)))), Decision::Ignore);
    }

    #[test]
    fn a_listener_stays_quiet_on_silence() {
        let mut listener = Listener::new(0.5).expect("the embedded model loads");
        assert!(listener.push(&vec![0.0; 16_000 * 3]).is_none());
    }
}
