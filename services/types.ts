/**
 * Wire types for the Pond REST API.
 *
 * Ported from `pond-desktop/src/api/types.ts` in the goose-in-a-pond repo, which
 * is the reference client for this same backend. Keeping the two in step matters
 * more than keeping either tidy: a field that drifts here is a field the server
 * sends and this app silently ignores.
 *
 * These are the shapes on the wire, in the server's own snake_case. They are
 * deliberately separate from the display-shaped types in `models/`, which carry
 * pre-rendered strings like `time: '2 days ago'` for the UI. Reconciling those
 * two is the subject of issues #12, #14 and #15, not this file.
 */

// ── Devices ───────────────────────────────────────────────────

export interface Device {
  id: string;
  name: string;
  device_type?: string;
  hostname?: string;
  room?: string;
  is_online: boolean;
  last_seen?: string;
  /**
   * What the device can be told to do, in `set_device_state`'s verbs — `power`,
   * `brightness`, `fan_speed` and the rest.
   *
   * This is what gates the UI. A contact sensor's list is empty, and that is the
   * fact that stops it being offered a power button. An unmapped device arrives
   * typed `matter` with nothing here, which means show no controls, not an error.
   */
  capabilities?: string[];
  ip_address?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateDeviceRequest {
  id?: string;
  name: string;
  device_type: string;
  hostname?: string;
  capabilities?: string[];
  room?: string;
}

export interface UpdateDeviceRequest {
  name: string;
  hostname?: string;
  room?: string;
}

export interface CommissionDeviceRequest {
  /** QR payload (`MT:…`), an 11/21-digit manual code, or a bare 8-digit passcode. */
  code: string;
  name?: string;
}

export interface CommissionDeviceResponse {
  id: string;
  name: string;
  node_id: string;
}

/**
 * A device-state change, in `set_device_state`'s own field names.
 *
 * Deliberately a flat optional-field struct rather than `{verb, value}`. The
 * verb/value model is the controller-facing WebSocket protocol between the Pond
 * and its Matter sidecar; a client never speaks it.
 *
 * Every field is a GIAP unit, not a device one — the controller converts, and
 * reads back what the device actually did.
 */
export interface DeviceStatePatch {
  /** 0-100 percent. */
  brightness?: number;
  /** Degrees Celsius. */
  target_temp?: number;
  locked?: boolean;
  power?: boolean;
  /** Hue degrees 0-360. */
  hue?: number;
  /** 0-100 percent. */
  saturation?: number;
  /** Kelvin, roughly 2000 (warm) to 6500 (daylight). Not the same control as hue. */
  color_temp?: number;
  /** 0-100 percent. */
  volume?: number;
  /** 0-100 percent. */
  fan_speed?: number;
  /** off, low, medium, high, on, auto, smart. Preferred when a mode is named. */
  fan_mode?: string;
  /** 0-100 percent open, where 100 is fully open. */
  position?: number;
  /** Slat angle 0-100. Distinct from position: a blind can be down with slats open. */
  tilt?: number;
  /** Open or shut a valve. Not `power` — a valve has no on/off switch. */
  valve?: boolean;
}

/**
 * What `POST /tools/invoke` answers.
 *
 * Deliberately untyped beyond this: an MCP tool result carries text, because
 * its first consumer is a language model. A client reading state out of it is
 * parsing prose, which is why only the narrowest possible field is read.
 */
export interface ToolCallResult {
  content: string;
  success: boolean;
}

export interface MatterStatus {
  enabled: boolean;
  url: string;
  /** `connecting` can last minutes on first use while the controller installs itself. */
  state: 'disabled' | 'connecting' | 'connected' | 'unreachable';
  /** Present only when `state` is `unreachable`. */
  error?: string;
}

// ── Sessions ──────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  title?: string;
  /** How the conversation opened, for a history card. Absent on older servers. */
  preview?: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  model_name?: string;
}

export interface SessionMessageToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Persisted image on a message. `url` is relative to the API base. */
export interface SessionMessageImage {
  id: string;
  mime_type: string;
  byte_size: number;
  url: string;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: string;
  /** Present on `assistant` messages that invoked tools. */
  tool_calls?: SessionMessageToolCall[];
  /** Present on `tool` messages — links back to the tool_call id. */
  tool_call_id?: string;
  images?: SessionMessageImage[];
  /**
   * Reasoning passages, in emission order. Absent rather than `[]` when nothing
   * was kept, so a turn that was never recorded stays distinguishable from one
   * that thought nothing.
   */
  thinking?: string[];
  /** `true` liked, `false` disliked, absent/null no vote. */
  liked?: boolean | null;
}

export interface UsageSummary {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  session_count: number;
}

// ── Memory ────────────────────────────────────────────────────

export type MemoryTier = 'short' | 'long' | 'permanent';
export type MemoryLifecycle = 'active' | 'archived' | 'merged';

export interface MemoryFragment {
  id: string;
  content: string;
  source?: string;
  tags?: string[];
  created_at: string;
  importance?: number;
  tier?: MemoryTier;
  lifecycle?: MemoryLifecycle;
  access_count: number;
  last_accessed_at?: string;
  superseded_by?: string;
}

// ── Models ────────────────────────────────────────────────────

export interface ModelEntry {
  id: string;
  provider: string;
  name: string;
  display_name?: string;
  is_active: boolean;
  ram_estimate_mb?: number;
  recommended_role?: string;
  /**
   * Declared context window, from the catalog row the backend persisted. Prefer
   * it over guessing from `name` — that heuristic is a copy of a backend rule
   * which has already moved on.
   */
  context_length?: number;
  quantization?: string;
  downloaded?: boolean;
  description?: string;
  size_mb?: number;
  category?: string;
}

export interface ModelCapabilities {
  thinking: boolean;
  vision: boolean;
  audio_input: boolean;
  context_window_tokens: number;
  structured_output: boolean;
  tool_calling: boolean;
}

export interface ModelActiveRoles {
  [role: string]: string | null;
}

export interface ModelMemoryStatus {
  total_mb: number;
  available_for_llm_mb: number;
  loaded_model: string | null;
}

// ── Schedules ─────────────────────────────────────────────────

export interface Schedule {
  id: string;
  name: string;
  label?: string;
  cron: string;
  /** Set when this is a one-shot: fires once at this instant, then never again. */
  fire_at?: string | null;
  prompt: string;
  enabled: boolean;
  timezone?: string;
  last_run?: string;
  next_run?: string;
  created_at?: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
}

// ── Logs and activity ─────────────────────────────────────────

export interface LogEntry {
  id: number;
  timestamp: string;
  /** INFO | WARN | ERROR */
  level: string;
  source: string;
  message: string;
  /** JSON, as a string. */
  metadata?: string;
}

export type EventCategory =
  | 'agent'
  | 'tool'
  | 'inference'
  | 'sensor'
  | 'camera'
  | 'device'
  | 'auth'
  | 'network'
  | 'system';

export type PrivacySensitivity = 'public' | 'internal' | 'sensitive' | 'secret';

export type AttributeValue =
  | { bool: boolean }
  | { int: number }
  | { float: number }
  | { text: string };

export interface ActivityEvent {
  /**
   * The backend's `Event` has no stable row id, so this is absent more often
   * than not — derive a React key rather than keying on it.
   */
  id?: string;
  timestamp: string;
  category: EventCategory;
  action: string;
  privacy_sensitivity: PrivacySensitivity;
  session_id?: string | null;
  trace_id?: string | null;
  attributes: Record<string, AttributeValue>;
}

export interface ActivityResponse {
  count: number;
  events: ActivityEvent[];
}

export interface ActivitySummary {
  window: string;
  since: string;
  total: number;
  by_category: Record<string, number>;
}

// ── Extensions and the marketplace ────────────────────────────

export interface Extension {
  name: string;
  kind: string;
  description: string;
  tools: string[];
  enabled: boolean;
  /** `connected`, `error`, or `loading`. */
  status?: string;
  last_error?: string | null;
}

export interface SecretRequirement {
  key: string;
  display_name: string;
  description: string;
  required: boolean;
  kind: 'api_key' | 'oauth_flow' | 'generic';
}

export interface MarketplaceExtension {
  id: string;
  name: string;
  description: string;
  kind: string;
  category: string;
  author: string;
  tools: string[];
  featured: boolean;
  required_secrets: SecretRequirement[];
}

// ── OAuth ─────────────────────────────────────────────────────

export interface OAuthProvider {
  id: string;
  display_name: string;
  scopes: string[];
}

// ── Voice ─────────────────────────────────────────────────────

export interface TranscribeResponse {
  text: string;
}

/**
 * Request body for POST /api/v1/chat/stream. Scoped to what the voice
 * pipeline needs — `feat/streaming-chat-v2` has a richer version of this
 * same request (images, canvas_mode, tool_group_allowlist, etc.); reconcile
 * the two when that branch merges.
 */
export interface ChatStreamRequest {
  message: string;
  session_id?: string;
  /** Disables `<think>` capture server-side and injects a spoken-answer system prompt. */
  voice_mode: boolean;
  /** Voice turns don't reattach after backgrounding — always false here. */
  resumable: boolean;
}

/**
 * SSE frames pond-server's `/chat/stream` emits, scoped to the subset the
 * voice pipeline consumes (text tokens, tool calls, and turn end/error).
 */
export type ChatStreamFrame =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; tool: string; id: string }
  | { done: true; session_id: string }
  | { error: string };

// ── Profiles ──────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string;
  avatar_emoji: string;
}
