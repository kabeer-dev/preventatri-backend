// middleware/maintenanceMiddleware.js
const config = require('config');

function maintenanceMiddleware(req, res, next) {
  const isMaintenanceMode = config.get('maintenanceMode');

  if (isMaintenanceMode) {
    // For APIs
    if (req.originalUrl.startsWith('/api')) {
      return res.status(503).json({
        success: false,
        message:
          'The service is temporarily unavailable due to maintenance. Please try again later.',
      });
    }

    // For everything else (e.g., browser hits root or docs)
    return res.status(503).setHeader('Content-Type', 'text/html').end(`
        <html>
          <head>
            <title>Site Under Maintenance</title>
            <style>
              body { display:flex; align-items:center; justify-content:center; height:100vh; margin:0; font-family:Arial,sans-serif; background:#f9f9f9; }
              .container { text-align:center; }
              h1 { font-size:2rem; color:#1F2559; margin-bottom:10px; }
              p { font-size:1rem; color:#555; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>We will be back soon!</h1>
              <p>Our platform is under maintenance. Please check back in a few minutes.</p>
            </div>
          </body>
        </html>
      `);
  }

  next();
}

module.exports = maintenanceMiddleware;
