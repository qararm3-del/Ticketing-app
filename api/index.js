const app = require("../server");

module.exports = async function handler(req, res) {
  try {
    await app.locals.dbReady;
    return app(req, res);
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Service temporarily unavailable. Please retry shortly." }));
  }
};
