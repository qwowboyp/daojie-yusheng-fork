import { pathToFileURL } from 'node:url';
const rt = pathToFileURL('X:/workSpace/daojie-yusheng-fork/packages/client/scripts/browser-proof-runtime.mjs').href;
const m = await import(rt);
const { withClientBrowserProof } = m;
await withClientBrowserProof({ viewport: { width: 390, height: 844 }, profilePrefix: 'dbg4-' }, async (cdp) => {
  const expr = `(() => {
    const el = document.querySelector('[data-action="build-strength"]');
    const toolbar = el ? el.closest('[class*="building-mode"]') : null;
    if (!toolbar) return { found: false };
    const rc = toolbar.getBoundingClientRect();
    return { found: true, top: rc.top, height: rc.height, ih: window.innerHeight, ratio: rc.top / window.innerHeight };
  })()`;
  const r = await cdp.evaluate(expr);
  console.log('toolbar:', JSON.stringify(r));
});
