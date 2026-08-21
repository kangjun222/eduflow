const express = require('express');
const courseService = require('../services/courseService');
const timetableService = require('../services/timetableService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await timetableService.listCourses());
  } catch (err) {
    next(err);
  }
});

// 강좌 개설.
// 요일·시간 패턴을 받아 기간 전체의 수업 회차를 생성하고,
// 강사·강의실 시간 충돌이 있으면 409 로 거절한다.
router.post('/', async (req, res, next) => {
  try {
    const result = await courseService.createCourse(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'id는 정수여야 합니다.' } });
      return;
    }
    res.json(await courseService.getCourse(courseId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
