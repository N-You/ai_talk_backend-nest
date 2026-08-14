// 清理 tester 用户的残留 AI 自定义配置（DeepSeek base + 无 key），使其回落 .env 智谱配置
// 用法: node scripts/clear-settings.cjs [nickname]
const { Client } = require("pg");
const nickname = process.argv[2] || "tester";
const host = process.env.DB_HOST || "localhost";
const port = parseInt(process.env.DB_PORT || "5432");
const user = process.env.DB_USERNAME || "postgres";
const password = process.env.DB_PASSWORD || "postgres";
const db = process.env.DB_NAME || "english_tutor";
(async () => {
  const c = new Client({ host, port, user, password, database: db, connectionTimeoutMillis: 4000 });
  await c.connect();
  const r = await c.query(
    "UPDATE users SET settings = NULL WHERE nickname = $1 RETURNING id, nickname, settings",
    [nickname]
  );
  if (r.rows.length === 0) {
    console.log("未找到用户 [" + nickname + "]");
  } else {
    console.log("已清理 [" + nickname + "] 的自定义 AI 配置，将使用 .env 的智谱 glm-4.5-air");
  }
  await c.end();
})().catch(e => {
  console.error("清理失败:", e.message);
  process.exit(1);
});
