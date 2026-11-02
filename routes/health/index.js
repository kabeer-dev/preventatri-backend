const express = require('express');

const {healthController} = require('../../controllers');
const {catchAsyncMiddleware} = require('../../middleware');

const healthRoute = express.Router();

/**
 * GET /api/v1/health/database
 * Check database connection status
 */
healthRoute.get('/database', catchAsyncMiddleware(healthController.getHealth));

module.exports = healthRoute;
