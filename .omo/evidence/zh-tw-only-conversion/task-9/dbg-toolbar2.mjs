import { pathToFileURL } from 'node:url';
const rt = pathToFileURL('X:/workSpace/daojie-yusheng-fork/packages/client/scripts/browser-proof-runtime.mjs').href;
const m = await import(rt);
const { withClientBrowserProof } = m;
await withClientBrowserProof({ viewport: { width: 390, height: 844 }, profilePrefix: 'dbg5-' }, async (cdp) => {
  const expr = `(() => {
    const toolbar = document.getElementById('building-mode-toolbar');
    if (!toolbar) return { found: false };
    const rc = toolbar.getBoundingClientRect();
    return { found: true, top: rc.top, bottom: rc.bottom, height: rc.height, ih: window.innerHeight, ratio: rc.top / window.innerHeight };
  })()`;
  const r = await cdp.evaluate(expr);
  console.log('toolbar:', JSON.stringify(r));
});
