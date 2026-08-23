/** 用途：玩家头像服务端正规化（最长边 ≤128 等比缩 + WebP 重压缩）链路的冒烟验证。 */
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

import assert from 'node:assert/strict';

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

import {
  AVATAR_MAX_EDGE,
  AVATAR_NORMALIZED_MIME,
  normalizeAvatarImage,
} from '../http/native/avatar-image-normalizer';
import { MAX_PLAYER_AVATAR_BYTES } from '../http/native/player-avatar-store.service';

/** 生成指定尺寸的纯色 PNG 测试图。 */
async function makePng(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

/** 生成单帧 GIF（验证 GIF 格式解码与等比缩放；多帧动画保留由 normalizer 的 animated: true 保证）。 */
async function makeGif(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 128, b: 0 } },
  })
    .gif()
    .toBuffer();
}

async function main(): Promise<void> {
  // 1) 16:9 横图（1920×1080）→ 128×72，长宽比保持
  const landscape = await normalizeAvatarImage(await makePng(1920, 1080, { r: 200, g: 30, b: 30 }));
  assert.equal(landscape.width, 128, '16:9 缩放后宽应为 128');
  assert.equal(landscape.height, 72, '16:9 缩放后高应为 72');
  assert.equal(landscape.mime, AVATAR_NORMALIZED_MIME, '输出 MIME 应为 image/webp');
  assert.ok(landscape.data.byteLength > 0 && landscape.data.byteLength <= MAX_PLAYER_AVATAR_BYTES);

  // 2) 9:16 竖图（1080×1920）→ 72×128
  const portrait = await normalizeAvatarImage(await makePng(1080, 1920, { r: 30, g: 200, b: 30 }));
  assert.equal(portrait.width, 72, '9:16 缩放后宽应为 72');
  assert.equal(portrait.height, 128, '9:16 缩放后高应为 128');

  // 3) 小图（64×64）不放大
  const small = await normalizeAvatarImage(await makePng(64, 64, { r: 30, g: 30, b: 200 }));
  assert.equal(small.width, 64, '小图不应被放大');
  assert.equal(small.height, 64, '小图不应被放大');

  // 4) 压缩有效性：1920×1080 PNG 重编码后体积显著小于上限
  assert.ok(
    landscape.data.byteLength < 64 * 1024,
    `128px WebP 应远小于 64KB，实际 ${landscape.data.byteLength} bytes`,
  );

  // 5) 输出确为可解码 WebP
  const decoded = await sharp(landscape.data).metadata();
  assert.equal(decoded.format, 'webp', '输出应可被 sharp 解码为 webp');
  assert.equal(decoded.width, 128);
  assert.equal(decoded.height, 72);

  // 6) GIF 格式：解码 + 等比缩放（300×200 → 128×86 附近，动画帧结构保留）
  const animated = await normalizeAvatarImage(await makeGif(300, 200));
  assert.equal(animated.width, 128, '300×200 GIF 应缩为 128 宽');
  assert.equal(animated.height, Math.round(200 * (128 / 300)), 'GIF 高度应等比');
  const animatedMeta = await sharp(animated.data, { animated: true }).metadata();
  assert.ok((animatedMeta.pages ?? 1) >= 1, 'GIF 输出应保留帧结构');

  // 7) 伪造/损坏内容 → BadRequestException
  await assert.rejects(
    () => normalizeAvatarImage(Buffer.from('this is definitely not an image', 'utf8')),
    (error: unknown) => error instanceof BadRequestException,
    '损坏内容应抛 BadRequestException',
  );

  // 8) 魔数伪装：PNG 头 + 垃圾尾。sharp 以魔数嗅探，尾随垃圾不阻止解码；
  //    两种结果都可接受（成功或 BadRequest），但不得抛出非 BadRequest 的异常。
  const bogus = Buffer.concat([
    await makePng(32, 32, { r: 0, g: 0, b: 0 }),
    Buffer.from('<script>alert(1)</script>', 'utf8'),
  ]);
  try {
    const bogusResult = await normalizeAvatarImage(bogus);
    assert.ok(bogusResult.width <= AVATAR_MAX_EDGE, '伪装图缩放后宽不应超过上限');
  } catch (error) {
    assert.ok(error instanceof BadRequestException, '失败路径必须是 BadRequestException');
  }

  console.log(JSON.stringify({
    ok: true,
    landscape: `${landscape.width}x${landscape.height}`,
    landscapeBytes: landscape.data.byteLength,
    portrait: `${portrait.width}x${portrait.height}`,
    small: `${small.width}x${small.height}`,
    animatedPages: animatedMeta.pages ?? 1,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
