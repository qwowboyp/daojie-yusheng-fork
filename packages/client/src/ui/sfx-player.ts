/**
 * 战斗音效（SFX）播放器：基于 WebAudio 的短促合成音，无音频资源文件依赖。
 *
 * 纯客户端表现层：cast_burst 特效枚举 → 合成器 patch，元素只调整基频音色。
 * 浏览器自动播放政策与 BGM 播放器同套路：首次用户交互后才真正解锁 AudioContext。
 * 解鎖必須在同一手勢內 resume；戰鬥觸發時若仍 suspended，保留最後一聲待解鎖後補播。
 * 偏好（开关/音量）持久化在 localStorage，与 BGM 相互独立。
 * 任何播放失败都静默忽略，绝不影响渲染主链路。
 */
import {
  CastBurstTier,
  CastBurstVariant,
  ElementKey,
  SFX_STORAGE_KEY,
  SFX_VOLUME_STORAGE_KEY,
} from '@mud/shared';
import { AUDIO_UNLOCK_EVENTS, resolveAudioContextCtor } from './audio-context-ctor';

/** SFX 预设音量（0~1）。 */
export const DEFAULT_SFX_VOLUME = 0.5;
/** SFX 音量調整刻度（0~1），對應 UI 上的 10%。 */
export const SFX_VOLUME_STEP = 0.1;
/** SFX 音量變更事件名，供設定面板同步顯示。detail 攜帶 { volume }（0~1）。 */
export const SFX_VOLUME_CHANGED_EVENT = 'sfx-player-volume-changed';
/** SFX 实际输出增益系数：UI 音量 100% 对应 60% 输出（短音效比 BGM 穿透力强，略压）。 */
const SFX_OUTPUT_GAIN = 0.6;
/** 同一 variant 的最小重复间隔（毫秒），多人混战时防止音墙。 */
const SFX_VARIANT_THROTTLE_MS = 60;
/** 普攻音效的最小重复间隔（毫秒）；普攻频率高于技能，节流更紧。 */
const SFX_BASIC_ATTACK_THROTTLE_MS = 90;
/** 普攻音效峰值音量（刻意压低，只做轻反馈）。 */
const SFX_BASIC_ATTACK_PEAK_GAIN = 0.36;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = true;
let volume = DEFAULT_SFX_VOLUME;
let initialized = false;
const lastPlayedAtByVariant = new Map<CastBurstVariant, number>();
let lastBasicAttackPlayedAt = 0;

type PendingSfx =
  | {
      readonly kind: 'cast';
      readonly variant: CastBurstVariant;
      readonly element: ElementKey | undefined;
      readonly tier: CastBurstTier | undefined;
    }
  | {
      readonly kind: 'attack';
    };

/** 解鎖完成前最多保留最後一聲，避免戰鬥發生在 resume 完成前被丟棄。 */
let pendingSfx: PendingSfx | null = null;

/** 读取当前 SFX 开启偏好。 */
export function isSfxEnabled(): boolean {
  return enabled;
}

/** 读取当前 SFX 音量（0~1）。 */
export function getSfxVolume(): number {
  return volume;
}

/** 初始化：读取持久化偏好并注册首次交互解锁监听。幂等。 */
export function initializeSfxPlayer(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  enabled = readStoredEnabled();
  volume = readStoredVolume();
  const unlock = () => {
    for (const eventName of AUDIO_UNLOCK_EVENTS) {
      window.removeEventListener(eventName, unlock);
    }
    const audio = ensureAudioContext();
    if (audio && audio.state !== 'running') {
      void resumeContextThenFlush(audio);
    }
  };
  for (const eventName of AUDIO_UNLOCK_EVENTS) {
    window.addEventListener(eventName, unlock);
  }
}

/** 切换 SFX 开关并持久化。 */
export function toggleSfx(): boolean {
  enabled = !enabled;
  persistEnabled(enabled);
  return enabled;
}

/** 设置 SFX 音量（0~1），立即生效并持久化。 */
export function setSfxVolume(value: number): number {
  const normalized = Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_SFX_VOLUME;
  volume = Math.round(normalized * 100) / 100;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(volume * SFX_OUTPUT_GAIN, ctx.currentTime, 0.01);
  }
  persistVolume(volume);
  window.dispatchEvent(new CustomEvent<{ volume: number }>(SFX_VOLUME_CHANGED_EVENT, { detail: { volume } }));
  return volume;
}

/** 播放一个 cast_burst 特效对应的合成音；节流与失败都静默处理。 */
export function playCastBurstSfx(
  variant: CastBurstVariant,
  element?: ElementKey,
  tier?: CastBurstTier,
): void {
  if (!enabled) {
    return;
  }
  const now = performance.now();
  const lastPlayedAt = lastPlayedAtByVariant.get(variant) ?? 0;
  if (now - lastPlayedAt < SFX_VARIANT_THROTTLE_MS) {
    return;
  }
  lastPlayedAtByVariant.set(variant, now);
  try {
    const audio = ensureAudioContext();
    if (!audio) {
      return;
    }
    if (audio.state === 'running') {
      playVariantPatch(audio, variant, element);
      if (tier === 'divine' || tier === 'secret') {
        playBellPatch(audio);
      }
      return;
    }
    pendingSfx = { kind: 'cast', variant, element, tier };
    void resumeContextThenFlush(audio);
  } catch {
    // 音频不可用（无 AudioContext/被策略拦截）时静默跳过
  }
}

/** 播放普攻轻音效（刻意小声：短噪声嗖声 + 低频轻响）。 */
export function playBasicAttackSfx(): void {
  if (!enabled) {
    return;
  }
  const now = performance.now();
  if (now - lastBasicAttackPlayedAt < SFX_BASIC_ATTACK_THROTTLE_MS) {
    return;
  }
  lastBasicAttackPlayedAt = now;
  try {
    const audio = ensureAudioContext();
    if (!audio) {
      return;
    }
    if (audio.state === 'running') {
      playBasicAttackPatch(audio);
      return;
    }
    pendingSfx = { kind: 'attack' };
    void resumeContextThenFlush(audio);
  } catch {
    // 音频不可用时静默跳过
  }
}

/** 懶建立 AudioContext 與主增益；建立當下立刻 resume，避免第一次播放被 suspended 擋掉。 */
function ensureAudioContext(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  }
  const AudioCtor = resolveAudioContextCtor();
  if (!AudioCtor) {
    return null;
  }
  ctx = new AudioCtor();
  masterGain = ctx.createGain();
  masterGain.gain.value = volume * SFX_OUTPUT_GAIN;
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  return ctx;
}

function playBasicAttackPatch(audio: AudioContext): void {
  playNoiseBurst(audio, 1600, 300, 0.09, SFX_BASIC_ATTACK_PEAK_GAIN);
  playTone(audio, 140, 90, 0.08, SFX_BASIC_ATTACK_PEAK_GAIN * 0.8, 'sine');
}

function flushPendingSfx(): void {
  if (!ctx || ctx.state !== 'running' || !enabled) {
    return;
  }
  const pending = pendingSfx;
  pendingSfx = null;
  if (!pending) {
    return;
  }
  if (pending.kind === 'cast') {
    playVariantPatch(ctx, pending.variant, pending.element);
    if (pending.tier === 'divine' || pending.tier === 'secret') {
      playBellPatch(ctx);
    }
    return;
  }
  playBasicAttackPatch(ctx);
}

function resumeContextThenFlush(audio: AudioContext): Promise<void> {
  return audio.resume().then(() => {
    flushPendingSfx();
  }).catch(() => undefined);
}

/** 预分配噪声缓冲（0.3 秒白噪声，所有噪声类 patch 复用）。 */
function getNoiseBuffer(audio: AudioContext): AudioBuffer {
  if (noiseBuffer) {
    return noiseBuffer;
  }
  const sampleCount = Math.floor(audio.sampleRate * 0.3);
  noiseBuffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
  const channel = noiseBuffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** 元素对应的基频（赫兹）。 */
function resolveElementBaseFreq(element: ElementKey | undefined): number {
  switch (element) {
    case 'metal': return 880;
    case 'wood': return 523;
    case 'water': return 659;
    case 'fire': return 440;
    case 'earth': return 196;
    default: return 587;
  }
}

/** 按 variant 派发合成 patch。 */
function playVariantPatch(audio: AudioContext, variant: CastBurstVariant, element?: ElementKey): void {
  const baseFreq = resolveElementBaseFreq(element);
  switch (variant) {
    case 'single':
      playNoiseBurst(audio, 1800, 400, 0.12, 0.5);
      playTone(audio, baseFreq, baseFreq, 0.16, 0.35, 'sine');
      break;
    case 'aoe':
      playTone(audio, 220, 60, 0.26, 0.4, 'sawtooth');
      playNoiseBurst(audio, 900, 200, 0.24, 0.18);
      break;
    case 'line':
      playNoiseBurst(audio, 2400, 500, 0.2, 0.45);
      break;
    case 'heal':
      playTone(audio, 523, 523, 0.28, 0.22, 'sine');
      playTone(audio, 659, 659, 0.28, 0.2, 'sine', 0.09);
      break;
    case 'buff_self':
      playTone(audio, 330, 520, 0.26, 0.25, 'sine');
      break;
    case 'buff_debuff':
      playTone(audio, 300, 220, 0.3, 0.25, 'triangle');
      break;
    case 'tile':
      playTone(audio, 90, 70, 0.18, 0.45, 'sine');
      break;
  }
}

/** 单音：起止频率（可滑音）、时长、音量、波形与可选延迟。 */
function playTone(
  audio: AudioContext,
  fromFreq: number,
  toFreq: number,
  durationSec: number,
  peakGain: number,
  type: OscillatorType,
  delaySec = 0,
): void {
  const startedAt = audio.currentTime + delaySec;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, fromFreq), startedAt);
  if (toFreq !== fromFreq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), startedAt + durationSec);
  }
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), startedAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + durationSec);
  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(startedAt);
  osc.stop(startedAt + durationSec + 0.02);
}

/** 噪声爆：带通滤波器中心频率从 fromHz 扫到 toHz。 */
function playNoiseBurst(
  audio: AudioContext,
  fromHz: number,
  toHz: number,
  durationSec: number,
  peakGain: number,
): void {
  const startedAt = audio.currentTime;
  const source = audio.createBufferSource();
  source.buffer = getNoiseBuffer(audio);
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(Math.max(40, fromHz), startedAt);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), startedAt + durationSec);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), startedAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + durationSec);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain!);
  source.start(startedAt);
  source.stop(startedAt + durationSec + 0.02);
}

/** 神通/秘法钟声：三个失谐正弦长衰减叠加。 */
function playBellPatch(audio: AudioContext): void {
  const base = 660;
  playTone(audio, base, base, 0.7, 0.22, 'sine');
  playTone(audio, base * 2.01, base * 2.01, 0.55, 0.1, 'sine', 0.02);
  playTone(audio, base * 2.99, base * 2.99, 0.4, 0.06, 'sine', 0.04);
}

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(SFX_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function persistEnabled(value: boolean): void {
  try {
    localStorage.setItem(SFX_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // 忽略：localStorage 不可用时仅本次会话生效
  }
}

function readStoredVolume(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(SFX_VOLUME_STORAGE_KEY) ?? '', 10);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return DEFAULT_SFX_VOLUME;
    }
    return raw / 100;
  } catch {
    return DEFAULT_SFX_VOLUME;
  }
}

function persistVolume(value: number): void {
  try {
    localStorage.setItem(SFX_VOLUME_STORAGE_KEY, `${Math.round(value * 100)}`);
  } catch {
    // 忽略：localStorage 不可用时仅本次会话生效
  }
}
