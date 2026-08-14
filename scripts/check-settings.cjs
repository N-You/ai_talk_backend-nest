const { Client } = require("pg");
const host = process.env.DB_HOST || "localhost";
const port = parseInt(process.env.DB_PORT || "5432");
const user = process.env.DB_USERNAME || "postgres";
const password = process.env.DB_PASSWORD || "postgres";
const db = process.env.DB_NAME || "english_tutor";
(async () => {
  const c = new Client({ host, port, user, password, database: db, connectionTimeoutMillis: 4000 });
  await c.connect();
  const r = await c.query("SELECT nickname, settings FROM users WHERE settings IS NOT NULL");
  if (r.rows.length === 0) {
    console.log("OK: 没有任何用户在库中配置过自定义 AI 设置，env 配置将全局生效");
  } else {
    for (const row of r.rows) {
      const s = row.settings || {};
      const key = s.apiKey ? s.apiKey.slice(0, 4) + "****(" + s.apiKey.length + "字符)" : "(未填)";
      console.log(
        "用户 [" + row.nickname + "] apiBase=" + (s.apiBase || "(空)") +
        " model=" + (s.model || "(空)") + " apiKey=" + key
      );
    }
  }
  await c.end();
})().catch(e => {
  console.error("查询失败（DB 可能未启动）:", e.message);
  process.exit(1);
});
