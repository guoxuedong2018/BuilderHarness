// A synthetic queue proves idempotency even if the client never receives the first reply.
import { createServer } from "node:http";

export default {
  variants: {
    normal: {},
    responseLost: { faults: [{ method: "POST", path: "/jobs", mode: "after" }] },
    requestLost: { faults: [{ method: "POST", path: "/jobs", mode: "before" }] },
  },
  async start() {
    const jobs = new Map();
    const server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/jobs") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const { key } = JSON.parse(Buffer.concat(chunks));
        if (!jobs.has(key)) jobs.set(key, { id: jobs.size + 1, state: "queued" });
        return res.end(JSON.stringify(jobs.get(key)));
      }
      if (req.method === "GET" && req.url === "/jobs") return res.end(JSON.stringify([...jobs.values()]));
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
  },
  cases: [{
    id: "one-job-after-retry",
    async run({ request, variant, assert }) {
      const enqueue = () => request("POST", "/jobs", { body: { key: "synthetic-job" } });
      if (variant.faults) await assert.rejects(enqueue, /Injected failure/);
      else assert.equal((await enqueue()).status, 200);
      assert.equal((await enqueue()).data.id, 1);
      assert.equal((await request("GET", "/jobs")).data.length, 1);
    },
  }],
};
