async function main(): Promise<void> {
  // 報告入口已安裝 60 秒逾時；避免外層再套用通用 10 秒限制。
  await import('./player-columnar-schema-report.js');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
