/** Local stand-in for Groq, used only to test the AI path without a key. Run: npx tsx scripts/mock-groq.ts */
import http from "node:http";
let calls = 0;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    if (calls % 4 === 0) { res.writeHead(429, { "retry-after": "2", "content-type": "application/json" }); res.end("{}"); return; }
    const user: string = JSON.parse(body).messages[1].content;
    const r = user.split("\n").map((l) => {
      const id = l.match(/^\[([^\]]+)\]/)?.[1];
      const t = l.toLowerCase();
      const c = /paid twice|two|debit/.test(t) ? "DUP-PAYMENT" : /dead|doa|kaput|faulty|ded /.test(t) ? "DOA-REPL" : /courier|parcel|arriv|deliver/.test(t) ? "LOST-TRANSIT" : "UNCLEAR";
      return { i: id, c, e: "mock" };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ r }) } }], usage: { total_tokens: 1234 } }));
  });
}).listen(4010, () => console.log("mock groq on 4010"));
