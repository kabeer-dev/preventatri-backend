const express = require('express');

const {accessMiddleware} = require('../../middleware');

const router = express.Router();

const sampleAccessCustomFunction = ({req}) => {};

router.post(
  '/sample',
  accessMiddleware({customFn: sampleAccessCustomFunction}),
  (req, res, next) => res.status(200).json({message: 'Private Sample'})
);

module.exports = router;
