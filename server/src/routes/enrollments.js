const express = require('express');

const enrollmentService = require('../services/enrollmentService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// 학생만 신청할 수 있다. 대상 학생은 body 가 아니라 토큰에서 가져온다.
// body 로 받으면 남의 이름으로 신청하는 요청을 막을 수 없다.
router.post('/', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const result = await enrollmentService.enroll({
      courseId: Number(req.body?.courseId),
      studentId: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:courseId', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const result = await enrollmentService.cancel({
      courseId: Number(req.params.courseId),
      studentId: req.user.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    res.json(await enrollmentService.listByStudent(req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
