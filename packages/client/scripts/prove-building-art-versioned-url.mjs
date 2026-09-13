import assert from 'node:assert/strict';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const buildingIds = [
  'stone_wall', 'wooden_door', 'wooden_window', 'plain_floor',
  'scripture_platform', 'treasure_vault', 'technique_refining_table',
  'technique_unification_platform', 'time_chamber', 'meditation_mat',
];

await withClientBrowserProof({
  viewport: { width: 960, height: 640 },
  profilePrefix: 'mud-building-art-url-',
  configureViteServer(server) {
    const buildId = JSON.parse(String(server.config.define.__APP_BUILD_ID__));
    server.middlewares.stack.unshift({ route: '', handle: (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://proof.local');
      if (!url.pathname.startsWith('/assets/building-art/')) return next();
      if (url.searchParams.get('v') === buildId) return next();
      response.statusCode = 404;
      response.end('building_art_snapshot_not_found');
    }});
  },
}, async (cdp) => {
  const result = await cdp.evaluate(`(async () => {
    const [{ resolveRuntimeImagePackAssetUrl }, manifest] = await Promise.all([
      import('/src/renderer/runtime-image-pack-url.ts'),
      fetch('/assets/runtime-image-packs/default/manifest.json', { cache: 'no-store' }).then((response) => response.json()),
    ]);
    const manifestUrl = '/assets/runtime-image-packs/default/manifest.json';
    const manifestVersion = String(manifest.version);
    const refs = { ...manifest.tiles, ...manifest.entities };
    const buildingUrls = ${JSON.stringify(buildingIds)}.map((id) => {
      const ref = refs['building:' + id];
      if (!ref?.src) throw new Error('manifest 缺少建築 key：' + id);
      return resolveRuntimeImagePackAssetUrl(manifestUrl, ref.src, manifestVersion);
    });
    const terrainUrl = resolveRuntimeImagePackAssetUrl(manifestUrl, refs['terrain:floor'].src, manifestVersion);
    const portalUrl = resolveRuntimeImagePackAssetUrl(manifestUrl, refs['interactable:portal'].src, manifestVersion);
    const buildingVersion = new URL(buildingUrls[0], location.href).searchParams.get('v');
    const oldBuildingUrl = new URL(buildingUrls[0], location.href);
    oldBuildingUrl.searchParams.set('v', manifestVersion);
    const oldBuildingStatus = (await fetch(oldBuildingUrl.toString())).status;
    const decoded = await Promise.all([...buildingUrls, terrainUrl, portalUrl].map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { url, width: image.naturalWidth, height: image.naturalHeight };
    }));
    return {
      manifestVersion,
      buildingUrls,
      buildingVersion,
      oldBuildingStatus,
      terrainVersion: new URL(terrainUrl, location.href).searchParams.get('v'),
      portalVersion: new URL(portalUrl, location.href).searchParams.get('v'),
      preserved: resolveRuntimeImagePackAssetUrl(manifestUrl, '/assets/building-art/v1/test.webp?source=proof#frame', manifestVersion),
      dataUrl: resolveRuntimeImagePackAssetUrl(manifestUrl, 'data:image/webp;base64,AA==', manifestVersion),
      externalUrl: resolveRuntimeImagePackAssetUrl(manifestUrl, 'https://example.invalid/art.webp?source=proof#frame', manifestVersion),
      decoded,
    };
  })()`);

  assert.equal(result.buildingUrls.length, buildingIds.length, '必須覆蓋正式 catalog 的十種可營造建築');
  assert.ok(result.buildingVersion && result.buildingVersion !== result.manifestVersion, '建築美術必須改用 client build 版本');
  assert.equal(result.oldBuildingStatus, 404, '舊 resolver 的 manifest v 必須命中不存在的建築 build snapshot');
  assert.ok(result.buildingUrls.every((url) => new URL(url, 'http://proof.local').searchParams.get('v') === result.buildingVersion), '十種建築必須共用當前 build snapshot 鍵');
  assert.equal(result.terrainVersion, result.manifestVersion, 'terrain 必須沿用 runtime image-pack manifest 版本');
  assert.equal(result.portalVersion, result.manifestVersion, 'portal 必須沿用 runtime image-pack manifest 版本');
  assert.match(result.preserved, /source=proof&v=[^#]+#frame$/, '建築 URL 必須保留既有 query 與 hash');
  assert.equal(result.dataUrl, 'data:image/webp;base64,AA==', 'data URL 不得附加版本 query');
  assert.equal(new URL(result.externalUrl, 'http://proof.local').searchParams.get('v'), result.manifestVersion, '非建築絕對 URL 不得改變版本來源');
  assert.equal(result.decoded.length, buildingIds.length + 2, 'Chrome 必須解碼十種建築、terrain 與 portal');
  assert.ok(result.decoded.every((entry) => entry.width > 0 && entry.height > 0), '所有版本化 URL 必須由 Chrome 成功解碼');
});

console.log('BUILDING_ART_VERSIONED_URL:PASS');
