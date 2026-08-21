const express = require('express');
const timetableService = require('../services/timetableService');

const router = express.Router();

const toIntOrNull = (v) => (v === undefined || v === '' ? null : Number(v));

router.get('/timetable', async (req, res, next) => {
  try {
    const data = await timetableService.getTimetable({
      from: req.query.from,
      to: req.query.to,
      teacherId: toIntOrNull(req.query.teacherId),
      roomId: toIntOrNull(req.query.roomId),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/meta', async (req, res, next) => {
  try {
    res.json(await timetableService.getMeta());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
